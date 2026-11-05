package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"shipyard/db"
)

func TestSplitSuggestions(t *testing.T) {
	cases := []struct {
		in, answer string
		want       []string
	}{
		{"Ada 12 WO.\n\nLANJUT: Rincian per vendor | Yang lebih dari 30 hari | Bandingkan bulan lalu", "Ada 12 WO.", []string{"Rincian per vendor", "Yang lebih dari 30 hari", "Bandingkan bulan lalu"}},
		{"Ada 12 WO.\n**LANJUT:** \"satu\" | <dua>\n", "Ada 12 WO.", []string{"satu", "dua"}},
		{"Tanpa saran.", "Tanpa saran.", []string{}},
		{"Lanjut: a | b | c | d", "", []string{"a", "b", "c"}},
	}
	for _, c := range cases {
		answer, got := splitSuggestions(c.in)
		if answer != c.answer || !reflect.DeepEqual(got, c.want) {
			t.Errorf("%q: %q %v", c.in, answer, got)
		}
	}
}

func TestAIConversations(t *testing.T) {
	setupStreamTest(t)
	db.Exec("DELETE FROM ai_conversations")
	n := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.ReadAll(r.Body)
		n++
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": "Jawaban `+string(rune('0'+n))+`.\nLANJUT: Rincian per vendor | Bulan lalu"}}]}`)
	}))
	defer server.Close()
	putSettings(t, "ai-admin", `{"provider": "openai", "base_url": "`+server.URL+`", "model": "m", "daily_limit": 10, "enabled": true}`)

	router := chi.NewRouter()
	router.Post("/api/ai/chat", PostAIChat)
	router.Get("/api/ai/conversations", GetAIConversations)
	router.Get("/api/ai/conversations/{id}", GetAIConversation)
	router.Delete("/api/ai/conversations/{id}", DeleteAIConversation)
	call := func(user, method, path, body string) (int, map[string]interface{}) {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)).WithContext(asUser(user)))
		var out map[string]interface{}
		json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}

	code, first := call("ai-admin", "POST", "/api/ai/chat", `{"messages": [{"role": "user", "content": "Berapa WO yang masih Waiting?"}]}`)
	conv, _ := first["conversation_id"].(string)
	if code != 200 || conv == "" || first["answer"] != "Jawaban 1." || !reflect.DeepEqual(first["suggestions"], []interface{}{"Rincian per vendor", "Bulan lalu"}) {
		t.Fatalf("first answer: %d %v", code, first)
	}
	code, second := call("ai-admin", "POST", "/api/ai/chat", `{"conversation_id": "`+conv+`", "messages": [
		{"role": "user", "content": "Berapa WO yang masih Waiting?"}, {"role": "assistant", "content": "Jawaban 1."},
		{"role": "user", "content": "Rincian per vendor"}]}`)
	if code != 200 || second["conversation_id"] != conv {
		t.Fatalf("second answer: %d %v", code, second)
	}
	// Someone else can't add to, read or delete it.
	if code, _ := call("ai-nobody", "POST", "/api/ai/chat", `{"conversation_id": "`+conv+`", "messages": [{"role": "user", "content": "x"}]}`); code != http.StatusNotFound {
		t.Errorf("other user's conversation accepted: %d", code)
	}
	if code, _ := call("ai-nobody", "GET", "/api/ai/conversations/"+conv, ""); code != http.StatusNotFound {
		t.Errorf("other user read: %d", code)
	}
	if code, _ := call("ai-nobody", "DELETE", "/api/ai/conversations/"+conv, ""); code != http.StatusNotFound {
		t.Errorf("other user delete: %d", code)
	}

	_, list := call("ai-admin", "GET", "/api/ai/conversations", "")
	convs, _ := list["conversations"].([]interface{})
	if len(convs) != 1 || convs[0].(map[string]interface{})["title"] != "Berapa WO yang masih Waiting?" || convs[0].(map[string]interface{})["questions"] != float64(2) {
		t.Fatalf("list: %v", list)
	}
	_, detail := call("ai-admin", "GET", "/api/ai/conversations/"+conv, "")
	turns, _ := detail["turns"].([]interface{})
	if len(turns) != 2 || turns[1].(map[string]interface{})["question"] != "Rincian per vendor" || turns[0].(map[string]interface{})["answer"] != "Jawaban 1." {
		t.Fatalf("detail: %v", detail)
	}
	if code, _ := call("ai-admin", "DELETE", "/api/ai/conversations/"+conv, ""); code != 200 {
		t.Fatalf("delete: %d", code)
	}
	if _, list := call("ai-admin", "GET", "/api/ai/conversations", ""); len(list["conversations"].([]interface{})) != 0 {
		t.Error("deleted conversation still listed")
	}
	// The Admin log keeps the questions.
	var logged int
	db.QueryRow(`SELECT COUNT(*) FROM ai_chat_log WHERE conversation_id = ?`, conv).Scan(&logged)
	if logged != 2 {
		t.Errorf("log rows: %d", logged)
	}
}
