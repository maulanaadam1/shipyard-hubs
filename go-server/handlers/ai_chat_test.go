package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"shipyard/db"
)

// putSettings saves AI settings through the Admin endpoint.
func putSettings(t *testing.T, user, body string) map[string]interface{} {
	t.Helper()
	rec := httptest.NewRecorder()
	PutAISettings(rec, httptest.NewRequest("PUT", "/api/ai/settings", strings.NewReader(body)).WithContext(asUser(user)))
	var out map[string]interface{}
	json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != 200 {
		t.Fatalf("save settings: %d %v", rec.Code, out)
	}
	return out
}

// fakeAnthropic answers the first request with a tool call and the second
// with text, recording what it was sent.
func fakeAnthropic(t *testing.T, requests *[]map[string]interface{}) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var req map[string]interface{}
		json.Unmarshal(body, &req)
		*requests = append(*requests, req)
		w.Header().Set("Content-Type", "application/json")
		if len(*requests) == 1 {
			io.WriteString(w, `{"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
				"content": [{"type": "text", "text": "Saya cek dulu."},
					{"type": "tool_use", "id": "toolu_1", "name": "search_work_items", "input": {"group_by": "work_type", "sort": "count"}}],
				"stop_reason": "tool_use", "stop_sequence": null,
				"usage": {"input_tokens": 1200, "output_tokens": 40, "cache_read_input_tokens": 1000, "cache_creation_input_tokens": 0}}`)
			return
		}
		io.WriteString(w, `{"id": "msg_2", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
			"content": [{"type": "text", "text": "Ada 2 jenis pekerjaan; terbanyak Ganti baru packing karet (2 item)."}],
			"stop_reason": "end_turn", "stop_sequence": null,
			"usage": {"input_tokens": 1500, "output_tokens": 30, "cache_read_input_tokens": 1000, "cache_creation_input_tokens": 0}}`)
	}))
}

func TestAIChat(t *testing.T) {
	seedAIData(t)
	db.Exec("DELETE FROM ai_chat_log")
	db.Exec("DELETE FROM profiles WHERE id = 'ai-admin'")
	db.Exec(`INSERT INTO profiles (id, email, username, name, role) VALUES ('ai-admin', 'ai-admin@example.test', 'aiadmin', 'AI Admin', 'Admin')`)
	defer db.Exec("DELETE FROM profiles WHERE id = 'ai-admin'")
	post := func(body string) (int, map[string]interface{}) {
		rec := httptest.NewRecorder()
		PostAIChat(rec, httptest.NewRequest("POST", "/api/ai/chat", strings.NewReader(body)).WithContext(asUser("ai-admin")))
		var out map[string]interface{}
		json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	question := `{"messages": [{"role": "user", "content": "Jenis pekerjaan apa yang paling banyak?"}]}`

	t.Setenv("NEXTAUTH_SECRET", "test-secret")
	// Off until an Admin switches it on: nothing is sent anywhere.
	db.Exec("DELETE FROM ai_settings")
	defer db.Exec("DELETE FROM ai_settings")
	if code, _ := post(question); code != http.StatusServiceUnavailable {
		t.Fatalf("without settings: %d", code)
	}

	var requests []map[string]interface{}
	server := fakeAnthropic(t, &requests)
	defer server.Close()
	putSettings(t, "ai-admin", `{"provider": "anthropic", "base_url": "`+server.URL+`", "api_key": "sk-ant-test-1234", "daily_limit": 1, "enabled": true}`)

	code, out := post(question)
	if code != 200 || !strings.Contains(out["answer"].(string), "Ganti baru packing karet") {
		t.Fatalf("answer: %d %v", code, out)
	}
	calls := out["tool_calls"].([]interface{})
	if len(calls) != 1 || calls[0].(map[string]interface{})["name"] != "search_work_items" || calls[0].(map[string]interface{})["is_error"] != false {
		t.Errorf("tool calls: %v", calls)
	}
	if len(requests) != 2 {
		t.Fatalf("requests to the API: %d", len(requests))
	}
	first := requests[0]
	tools, _ := first["tools"].([]interface{})
	system, _ := json.Marshal(first["system"])
	if first["model"] != "claude-opus-5-5" || len(tools) != len(aiTools()) || first["fallbacks"] != "default" || !strings.Contains(string(system), "Harga acuan") {
		t.Errorf("first request: model %v, %d tools, fallbacks %v", first["model"], len(tools), first["fallbacks"])
	}
	// The second request carries the tool result, computed from the database.
	second, _ := json.Marshal(requests[1]["messages"])
	if !strings.Contains(string(second), `tool_result`) || !strings.Contains(string(second), `Ganti baru packing karet`) {
		t.Errorf("tool result not sent back: %s", second)
	}

	var logged, tokens int
	db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(input_tokens + output_tokens), 0) FROM ai_chat_log WHERE user_id = 'ai-admin'`).Scan(&logged, &tokens)
	if logged != 1 || tokens != 2770 {
		t.Errorf("log: %d rows, %d tokens", logged, tokens)
	}
	// The daily limit (1) is reached.
	if code, _ := post(question); code != http.StatusTooManyRequests {
		t.Errorf("over the daily limit: %d", code)
	}
}
