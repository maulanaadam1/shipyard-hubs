package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"shipyard/db"
	"shipyard/middleware"
)

type sseEvent struct{ Event, Data string }

// streamChat posts a question with Accept: text/event-stream, through the
// Logger middleware (its writer must pass flushes through).
func streamChat(t *testing.T, user, question string) []sseEvent {
	t.Helper()
	router := chi.NewRouter()
	router.Use(middleware.Logger)
	router.Post("/api/ai/chat", PostAIChat)
	req := httptest.NewRequest("POST", "/api/ai/chat", strings.NewReader(`{"messages": [{"role": "user", "content": "`+question+`"}]}`)).WithContext(asUser(user))
	req.Header.Set("Accept", "text/event-stream")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if ct := rec.Header().Get("Content-Type"); ct != "text/event-stream" {
		t.Fatalf("content type %q: %s", ct, rec.Body.String())
	}
	var events []sseEvent
	readSSE(rec.Body, func(event, data string) error {
		events = append(events, sseEvent{event, data})
		return nil
	})
	return events
}

func streamText(events []sseEvent) (text string, tools []string, done map[string]interface{}) {
	for _, e := range events {
		switch e.Event {
		case "round":
			text = ""
		case "text":
			var d map[string]string
			json.Unmarshal([]byte(e.Data), &d)
			text += d["delta"]
		case "tool":
			var d map[string]interface{}
			json.Unmarshal([]byte(e.Data), &d)
			tools = append(tools, d["name"].(string))
		case "done":
			json.Unmarshal([]byte(e.Data), &done)
		}
	}
	return
}

func setupStreamTest(t *testing.T) {
	seedAIData(t)
	t.Setenv("NEXTAUTH_SECRET", "test-secret")
	db.Exec("DELETE FROM ai_chat_log")
	db.Exec("DELETE FROM ai_settings")
	t.Cleanup(func() { db.Exec("DELETE FROM ai_settings") })
	db.Exec("DELETE FROM profiles WHERE id IN ('ai-admin', 'ai-nobody')")
	db.Exec(`INSERT INTO profiles (id, email, username, name, role) VALUES ('ai-admin', 'ai-admin@example.test', 'aiadmin', 'AI Admin', 'Admin')`)
	db.Exec(`INSERT INTO profiles (id, email, username, name, role, roles) VALUES ('ai-nobody', 'ai-nobody@example.test', 'ainobody', 'No Rights', 'Staff', '')`)
	t.Cleanup(func() { db.Exec("DELETE FROM profiles WHERE id IN ('ai-admin', 'ai-nobody')") })
}

func writeSSE(w http.ResponseWriter, events ...string) {
	w.Header().Set("Content-Type", "text/event-stream")
	for _, e := range events {
		fmt.Fprintf(w, "%s\n\n", e)
	}
}

func TestAIChatStreamOpenAI(t *testing.T) {
	setupStreamTest(t)
	var requests []map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var req map[string]interface{}
		json.Unmarshal(raw, &req)
		requests = append(requests, req)
		if len(requests) == 1 {
			writeSSE(w,
				`data: {"choices":[{"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_9","type":"function","function":{"name":"search_work_items","arguments":""}}]}}]}`,
				`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"group_by\": \"work_type\","}}]}}]}`,
				`data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":" \"sort\": \"count\"}"}}]},"finish_reason":"tool_calls"}]}`,
				`data: {"choices":[],"usage":{"prompt_tokens":900,"completion_tokens":20}}`,
				`data: [DONE]`)
			return
		}
		writeSSE(w,
			`data: {"choices":[{"delta":{"content":"Terbanyak: "}}]}`,
			`data: {"choices":[{"delta":{"content":"Ganti baru packing karet."},"finish_reason":"stop"}]}`,
			`data: {"choices":[],"usage":{"prompt_tokens":1100,"completion_tokens":15}}`,
			`data: [DONE]`)
	}))
	defer server.Close()
	putSettings(t, "ai-admin", `{"provider": "openai", "base_url": "`+server.URL+`", "model": "m", "daily_limit": 5, "enabled": true}`)

	text, tools, done := streamText(streamChat(t, "ai-admin", "Jenis pekerjaan terbanyak?"))
	if text != "Terbanyak: Ganti baru packing karet." || len(tools) != 1 || tools[0] != "search_work_items" {
		t.Fatalf("streamed %q, tools %v", text, tools)
	}
	if done == nil || done["answer"] != text || done["id"] == "" {
		t.Fatalf("done: %v", done)
	}
	if requests[0]["stream"] != true || requests[0]["stream_options"] == nil {
		t.Errorf("not a streaming request: %v", requests[0]["stream"])
	}
	// The rebuilt assistant message and the tool result go back.
	second, _ := json.Marshal(requests[1]["messages"])
	if !strings.Contains(string(second), `"tool_calls":[{"function":{"arguments":"{\"group_by\": \"work_type\", \"sort\": \"count\"}","name":"search_work_items"},"id":"call_9","type":"function"}]`) ||
		!strings.Contains(string(second), `"tool_call_id":"call_9"`) || !strings.Contains(string(second), "Ganti baru packing karet") {
		t.Errorf("second request: %s", second)
	}
	var tokens, duration int64
	db.QueryRow(`SELECT input_tokens + output_tokens, duration_ms FROM ai_chat_log WHERE id = ?`, done["id"]).Scan(&tokens, &duration)
	if tokens != 2035 {
		t.Errorf("logged tokens %d", tokens)
	}
}

func TestAIChatStreamAnthropic(t *testing.T) {
	setupStreamTest(t)
	var requests []map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var req map[string]interface{}
		json.Unmarshal(raw, &req)
		requests = append(requests, req)
		if len(requests) == 1 {
			writeSSE(w,
				"event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":1200,\"cache_read_input_tokens\":1000,\"output_tokens\":1}}}",
				"event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}",
				"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"cek data\"}}",
				"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"signature_delta\",\"signature\":\"sig1\"}}",
				"event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}",
				"event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}",
				"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"text_delta\",\"text\":\"Saya cek dulu.\"}}",
				"event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":1}",
				"event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":2,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_7\",\"name\":\"search_work_items\",\"input\":{}}}",
				"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":2,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"group_by\\\": \\\"work_type\\\", \"}}",
				"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":2,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"\\\"sort\\\": \\\"count\\\"}\"}}",
				"event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":2}",
				"event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":40}}",
				"event: message_stop\ndata: {\"type\":\"message_stop\"}")
			return
		}
		writeSSE(w,
			"event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":1500,\"output_tokens\":1}}}",
			"event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}",
			"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Ada 2 jenis; \"}}",
			"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"terbanyak Ganti baru packing karet.\"}}",
			"event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}",
			"event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":30}}",
			"event: message_stop\ndata: {\"type\":\"message_stop\"}")
	}))
	defer server.Close()
	putSettings(t, "ai-admin", `{"provider": "anthropic", "base_url": "`+server.URL+`", "api_key": "sk-ant-test-1234", "daily_limit": 5, "enabled": true}`)

	text, tools, done := streamText(streamChat(t, "ai-admin", "Jenis pekerjaan terbanyak?"))
	if text != "Ada 2 jenis; terbanyak Ganti baru packing karet." || len(tools) != 1 {
		t.Fatalf("streamed %q, tools %v", text, tools)
	}
	if done == nil || done["answer"] != text {
		t.Fatalf("done: %v", done)
	}
	if requests[0]["stream"] != true {
		t.Error("not a streaming request")
	}
	// Thinking (with signature) and tool_use (with parsed input) go back whole.
	second, _ := json.Marshal(requests[1]["messages"])
	for _, want := range []string{`"signature":"sig1"`, `"thinking":"cek data"`, `"input":{"group_by":"work_type","sort":"count"}`, `"tool_use_id":"toolu_7"`} {
		if !strings.Contains(string(second), want) {
			t.Errorf("second request lacks %s: %s", want, second)
		}
	}
	var tokens int64
	db.QueryRow(`SELECT input_tokens + output_tokens FROM ai_chat_log WHERE id = ?`, done["id"]).Scan(&tokens)
	if tokens != 2770 {
		t.Errorf("logged tokens %d", tokens)
	}
}

func TestAIStreamErrorAndLogs(t *testing.T) {
	setupStreamTest(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		io.WriteString(w, `{"error": {"message": "boom"}}`)
	}))
	defer server.Close()
	putSettings(t, "ai-admin", `{"provider": "openai", "base_url": "`+server.URL+`", "model": "m", "daily_limit": 5, "enabled": true}`)
	events := streamChat(t, "ai-admin", "Halo?")
	if last := events[len(events)-1]; last.Event != "error" || !strings.Contains(last.Data, "tidak bisa dihubungi") {
		t.Fatalf("last event: %v", last)
	}

	// Feedback only on one's own answers.
	var id string
	db.QueryRow(`SELECT id FROM ai_chat_log WHERE user_id = 'ai-admin'`).Scan(&id)
	feedback := func(user, body string) int {
		rec := httptest.NewRecorder()
		PostAIFeedback(rec, httptest.NewRequest("POST", "/api/ai/feedback", strings.NewReader(body)).WithContext(asUser(user)))
		return rec.Code
	}
	if code := feedback("ai-nobody", `{"id": "`+id+`", "rating": "down"}`); code != http.StatusNotFound {
		t.Errorf("feedback on someone else's answer: %d", code)
	}
	if code := feedback("ai-admin", `{"id": "`+id+`", "rating": "meh"}`); code != http.StatusBadRequest {
		t.Errorf("bad rating: %d", code)
	}
	if code := feedback("ai-admin", `{"id": "`+id+`", "rating": "down"}`); code != 200 {
		t.Errorf("feedback: %d", code)
	}

	router := chi.NewRouter()
	router.With(RequireAdmin).Get("/api/ai/logs", GetAILogs)
	get := func(user, query string) (int, map[string]interface{}) {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/ai/logs"+query, nil).WithContext(asUser(user)))
		var out map[string]interface{}
		json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}
	if code, _ := get("ai-nobody", ""); code != http.StatusForbidden {
		t.Errorf("non-admin logs: %d", code)
	}
	code, out := get("ai-admin", "?filter=down")
	summary, _ := out["summary"].(map[string]interface{})
	entries, _ := out["entries"].([]interface{})
	if code != 200 || summary["questions"] != float64(1) || summary["errors"] != float64(1) || summary["down"] != float64(1) || len(entries) != 1 {
		t.Fatalf("logs: %d %v", code, out)
	}
	if _, out := get("ai-admin", "?filter=up"); len(out["entries"].([]interface{})) != 0 {
		t.Error("up filter")
	}
}
