package handlers

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"shipyard/db"
)

func TestAILogsGuestsAndPaging(t *testing.T) {
	db.Exec("DELETE FROM ai_chat_log")
	db.Exec("DELETE FROM ai_share_guests WHERE id = 'guest-log-1'")
	db.Exec("DELETE FROM profiles WHERE id = 'log-staff'")
	t.Cleanup(func() {
		db.Exec("DELETE FROM ai_chat_log")
		db.Exec("DELETE FROM ai_share_guests WHERE id = 'guest-log-1'")
		db.Exec("DELETE FROM profiles WHERE id = 'log-staff'")
	})
	db.Exec(`INSERT INTO profiles (id, email, username, name, role) VALUES ('log-staff', 'staff@example.test', 'staff', 'Budi Staf', 'Staff')`)
	db.Exec(`INSERT INTO ai_share_guests (id, name, created_at, last_seen) VALUES ('guest-log-1', 'Sari Tamu', '2026-11-07', '2026-11-07')`)
	now := time.Now()
	// 60 staff questions and 3 from the demo guest, newest last.
	for i := 0; i < 63; i++ {
		user, email := "log-staff", "staff@example.test"
		if i >= 60 {
			user, email = "guest-log-1", "guest-log-1@tamu.invalid"
		}
		db.Exec(`INSERT INTO ai_chat_log (id, user_id, user_email, question, answer, tools, created_at) VALUES (?, ?, ?, ?, 'jawaban', ?, ?)`,
			fmt.Sprintf("log-%02d", i), user, email, fmt.Sprintf("pertanyaan %d", i), `[{"name":"repair_list","input":{}}]`,
			now.Add(time.Duration(i-63)*time.Minute).Format("2006-01-02 15:04:05.000"))
	}
	get := func(query string) map[string]interface{} {
		rec := httptest.NewRecorder()
		GetAILogs(rec, httptest.NewRequest("GET", "/api/ai/logs?"+query, nil))
		var out map[string]interface{}
		json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}

	first := get("")
	entries := first["entries"].([]interface{})
	if first["total"] != float64(63) || len(entries) != 50 || first["page"] != float64(1) {
		t.Fatalf("page 1: total %v, %d entries", first["total"], len(entries))
	}
	newest := entries[0].(map[string]interface{})
	if newest["user_name"] != "Sari Tamu" || newest["guest"] != true {
		t.Errorf("guest entry: %v", newest)
	}
	if staff := entries[5].(map[string]interface{}); staff["user_name"] != "Budi Staf" || staff["guest"] != false {
		t.Errorf("staff entry: %v", staff)
	}
	// Data used counts the whole period, not only the page.
	if tools := first["tool_use"].(map[string]interface{}); tools["repair_list"] != float64(63) {
		t.Errorf("tool use: %v", tools)
	}
	if second := get("page=2"); len(second["entries"].([]interface{})) != 13 {
		t.Errorf("page 2: %v entries", len(second["entries"].([]interface{})))
	}
	guests := get("who=guest")
	if guests["total"] != float64(3) || guests["summary"].(map[string]interface{})["questions"] != float64(3) {
		t.Errorf("guests only: total %v, summary %v", guests["total"], guests["summary"])
	}
	users := guests["per_user"].([]interface{})
	if len(users) != 1 || users[0].(map[string]interface{})["name"] != "Sari Tamu" || users[0].(map[string]interface{})["guest"] != true {
		t.Errorf("guest per user: %v", users)
	}
	if staff := get("who=staff"); staff["total"] != float64(60) {
		t.Errorf("staff only: %v", staff["total"])
	}
}
