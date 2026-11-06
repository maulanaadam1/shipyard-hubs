package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"shipyard/db"
)

func TestAISettingsSecretHandling(t *testing.T) {
	t.Setenv("NEXTAUTH_SECRET", "test-secret")
	db.Exec("DELETE FROM ai_settings")
	defer db.Exec("DELETE FROM ai_settings")
	db.Exec("DELETE FROM profiles WHERE id IN ('ai-admin', 'ai-nobody')")
	db.Exec(`INSERT INTO profiles (id, email, username, name, role) VALUES ('ai-admin', 'ai-admin@example.test', 'aiadmin', 'AI Admin', 'Admin')`)
	db.Exec(`INSERT INTO profiles (id, email, username, name, role, roles) VALUES ('ai-nobody', 'ai-nobody@example.test', 'ainobody', 'No Rights', 'Staff', '')`)
	defer db.Exec("DELETE FROM profiles WHERE id IN ('ai-admin', 'ai-nobody')")

	router := chi.NewRouter()
	router.With(RequireAdmin).Get("/api/ai/settings", GetAISettings)
	router.With(RequireAdmin).Put("/api/ai/settings", PutAISettings)
	call := func(user, method, body string) (int, string) {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(method, "/api/ai/settings", strings.NewReader(body)).WithContext(asUser(user)))
		return rec.Code, rec.Body.String()
	}

	if code, _ := call("ai-nobody", "GET", ""); code != http.StatusForbidden {
		t.Errorf("non-admin read: %d", code)
	}
	if code, _ := call("ai-nobody", "PUT", `{"provider": "openai", "model": "x", "daily_limit": 5}`); code != http.StatusForbidden {
		t.Errorf("non-admin write: %d", code)
	}

	const key = "sk-secret-value-9876"
	code, body := call("ai-admin", "PUT", `{"provider": "anthropic", "api_key": "`+key+`", "daily_limit": 50, "enabled": true}`)
	if code != 200 || strings.Contains(body, key) || !strings.Contains(body, `"api_key_hint":"…9876"`) || !strings.Contains(body, `"active":true`) {
		t.Fatalf("save: %d %s", code, body)
	}
	var stored string
	db.QueryRow(`SELECT api_key_enc FROM ai_settings WHERE id = 'default'`).Scan(&stored)
	if stored == "" || strings.Contains(stored, key) {
		t.Errorf("key not encrypted at rest: %q", stored)
	}
	if _, body := call("ai-admin", "GET", ""); strings.Contains(body, key) || !strings.Contains(body, `"api_key_set":true`) {
		t.Errorf("read leaks or loses the key: %s", body)
	}

	// An empty key keeps the stored one; the model changes.
	call("ai-admin", "PUT", `{"provider": "anthropic", "model": "claude-sonnet-5-5", "daily_limit": 50, "enabled": true}`)
	if cfg, on := aiConfig(); !on || cfg.APIKey != key || cfg.Model != "claude-sonnet-5-5" {
		t.Errorf("after update: %+v %v", cfg, on)
	}

	// Validation.
	for _, bad := range []string{
		`{"provider": "gemini", "daily_limit": 5}`,
		`{"provider": "openai", "base_url": "ftp://x", "model": "m", "daily_limit": 5}`,
		`{"provider": "openai", "enabled": true, "daily_limit": 5}`,
		`{"provider": "anthropic", "daily_limit": -1}`,
	} {
		if code, _ := call("ai-admin", "PUT", bad); code != http.StatusBadRequest {
			t.Errorf("accepted %s: %d", bad, code)
		}
	}

	// A changed server secret: the key can't be opened, the assistant is off.
	t.Setenv("NEXTAUTH_SECRET", "another-secret")
	if _, on := aiConfig(); on {
		t.Error("on with an undecryptable key")
	}
	if _, body := call("ai-admin", "GET", ""); !strings.Contains(body, `"api_key_broken":true`) {
		t.Errorf("broken key not reported: %s", body)
	}
	t.Setenv("NEXTAUTH_SECRET", "test-secret")

	// Clearing the key switches the assistant off.
	call("ai-admin", "PUT", `{"provider": "anthropic", "clear_api_key": true, "daily_limit": 50, "enabled": true}`)
	if _, on := aiConfig(); on {
		t.Error("on after clearing the key")
	}
}

// An OpenAI-compatible provider runs the same tool loop.
func TestAIChatOpenAICompatible(t *testing.T) {
	seedAIData(t)
	t.Setenv("NEXTAUTH_SECRET", "test-secret")
	db.Exec("DELETE FROM ai_chat_log")
	db.Exec("DELETE FROM ai_settings")
	defer db.Exec("DELETE FROM ai_settings")
	db.Exec("DELETE FROM profiles WHERE id = 'ai-admin'")
	db.Exec(`INSERT INTO profiles (id, email, username, name, role) VALUES ('ai-admin', 'ai-admin@example.test', 'aiadmin', 'AI Admin', 'Admin')`)
	defer db.Exec("DELETE FROM profiles WHERE id = 'ai-admin'")

	var requests []map[string]interface{}
	var auth []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		auth = append(auth, r.Header.Get("Authorization"))
		raw, _ := io.ReadAll(r.Body)
		var req map[string]interface{}
		json.Unmarshal(raw, &req)
		requests = append(requests, req)
		w.Header().Set("Content-Type", "application/json")
		if len(requests) == 1 {
			io.WriteString(w, `{"choices": [{"finish_reason": "tool_calls", "message": {"role": "assistant", "content": null,
				"tool_calls": [{"id": "call_1", "type": "function", "function": {"name": "search_work_items", "arguments": "{\"group_by\": \"work_type\", \"sort\": \"count\"}"}}]}}],
				"usage": {"prompt_tokens": 900, "completion_tokens": 20}}`)
			return
		}
		io.WriteString(w, `{"choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": "Terbanyak: Ganti baru packing karet."}}],
			"usage": {"prompt_tokens": 1100, "completion_tokens": 15, "prompt_tokens_details": {"cached_tokens": 800}}}`)
	}))
	defer server.Close()
	putSettings(t, "ai-admin", `{"provider": "openai", "base_url": "`+server.URL+`/v1", "model": "local-model", "api_key": "or-key-12345678", "max_tokens": 2000, "daily_limit": 5, "enabled": true}`)

	rec := httptest.NewRecorder()
	PostAIChat(rec, httptest.NewRequest("POST", "/api/ai/chat", strings.NewReader(`{"messages": [{"role": "user", "content": "Jenis pekerjaan terbanyak?"}]}`)).WithContext(asUser("ai-admin")))
	var out map[string]interface{}
	json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != 200 || out["answer"] != "Terbanyak: Ganti baru packing karet." {
		t.Fatalf("answer: %d %v", rec.Code, out)
	}
	if len(requests) != 2 || auth[0] != "Bearer or-key-12345678" {
		t.Fatalf("requests %d, auth %v", len(requests), auth)
	}
	first := requests[0]
	tools, _ := first["tools"].([]interface{})
	if first["model"] != "local-model" || first["max_tokens"] != float64(2000) || len(tools) != len(aiTools()) {
		t.Errorf("first request: %v %v %d tools", first["model"], first["max_tokens"], len(tools))
	}
	msgs, _ := json.Marshal(requests[1]["messages"])
	if !strings.Contains(string(msgs), `"role":"tool"`) || !strings.Contains(string(msgs), `call_1`) || !strings.Contains(string(msgs), `Ganti baru packing karet`) {
		t.Errorf("tool result not sent back: %s", msgs)
	}
	var model string
	var tokens int
	db.QueryRow(`SELECT model, input_tokens + output_tokens FROM ai_chat_log WHERE user_id = 'ai-admin'`).Scan(&model, &tokens)
	if model != "openai/local-model" || tokens != 2035 {
		t.Errorf("log: %s %d", model, tokens)
	}
}

// daily_limit 0: no limit on questions per day.
func TestAIUnlimitedQuestions(t *testing.T) {
	setupStreamTest(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": "OK."}}]}`)
	}))
	defer server.Close()
	putSettings(t, "ai-admin", `{"provider": "openai", "base_url": "`+server.URL+`", "model": "m", "daily_limit": 0, "enabled": true}`)
	for i := 0; i < 3; i++ {
		rec := httptest.NewRecorder()
		PostAIChat(rec, httptest.NewRequest("POST", "/api/ai/chat", strings.NewReader(`{"messages": [{"role": "user", "content": "Halo?"}]}`)).WithContext(asUser("ai-admin")))
		if rec.Code != 200 {
			t.Fatalf("question %d: %d %s", i+1, rec.Code, rec.Body.String())
		}
	}
}
