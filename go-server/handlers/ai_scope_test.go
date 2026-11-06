package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"shipyard/db"
)

func TestAIPeriod(t *testing.T) {
	now := time.Date(2026, 11, 6, 10, 0, 0, 0, time.UTC) // Friday
	cases := map[string][2]string{
		"today":         {"2026-11-06", "2026-11-06"},
		"this_week":     {"2026-11-02", "2026-11-08"},
		"this_month":    {"2026-11-01", "2026-11-30"},
		"last_month":    {"2026-10-01", "2026-10-31"},
		"last_3_months": {"2026-09-01", "2026-11-30"},
		"this_year":     {"2026-01-01", "2026-12-31"},
	}
	for key, want := range cases {
		_, from, to, ok := aiPeriod(key, now)
		if !ok || from != want[0] || to != want[1] {
			t.Errorf("%s: %s..%s", key, from, to)
		}
	}
	if _, _, _, ok := aiPeriod("forever", now); ok {
		t.Error("unknown period accepted")
	}
	note := aiFocusNote(findAIScope("material"), "this_month", now)
	if !strings.Contains(note, "Material") || !strings.Contains(note, "2026-11-01 s.d. 2026-11-30") {
		t.Errorf("note: %s", note)
	}
	if aiFocusNote(nil, "", now) != "" {
		t.Error("note without a focus")
	}
}

// A chosen scope narrows the tools sent to the model, and the period goes
// next to the question.
func TestAIChatScope(t *testing.T) {
	setupStreamTest(t)
	var requests []map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var req map[string]interface{}
		json.Unmarshal(raw, &req)
		requests = append(requests, req)
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"choices": [{"finish_reason": "stop", "message": {"role": "assistant", "content": "OK."}}]}`)
	}))
	defer server.Close()
	putSettings(t, "ai-admin", `{"provider": "openai", "base_url": "`+server.URL+`", "model": "m", "daily_limit": 10, "enabled": true}`)

	rec := httptest.NewRecorder()
	PostAIChat(rec, httptest.NewRequest("POST", "/api/ai/chat", strings.NewReader(
		`{"scope": "hse", "period": "this_month", "messages": [{"role": "user", "content": "Izin kerja aktif?"}]}`)).WithContext(asUser("ai-admin")))
	if rec.Code != 200 || len(requests) != 1 {
		t.Fatalf("chat: %d %s", rec.Code, rec.Body.String())
	}
	tools, _ := requests[0]["tools"].([]interface{})
	if len(tools) != 1 || tools[0].(map[string]interface{})["function"].(map[string]interface{})["name"] != "query_app_data" {
		t.Errorf("hse tools: %v", tools)
	}
	msgs, _ := json.Marshal(requests[0]["messages"])
	if !strings.Contains(string(msgs), "Cakupan dipilih pengguna: HSE") || !strings.Contains(string(msgs), "Periode dipilih pengguna: Bulan ini") {
		t.Errorf("focus note missing: %s", msgs)
	}
	// The stored question is the user's own text.
	var question string
	db.QueryRow(`SELECT question FROM ai_chat_log WHERE user_id = 'ai-admin'`).Scan(&question)
	if question != "Izin kerja aktif?" {
		t.Errorf("stored question %q", question)
	}
}

func TestAIInsights(t *testing.T) {
	setupStreamTest(t)
	now := time.Now()
	if loc, err := time.LoadLocation("Asia/Jakarta"); err == nil {
		now = now.In(loc)
	}
	tomorrow := now.AddDate(0, 0, 1).Format("2006-01-02")

	db.Exec("DELETE FROM wo_item_findings")
	db.Exec(`INSERT INTO wo_item_findings (wo_id, item_id, rule, status) VALUES ('w1', 'i1', 'price', 'open'), ('w1', 'i2', 'price', 'open'), ('w1', 'i3', 'price', 'ignored')`)
	db.Exec("DELETE FROM inv_stock")
	db.Exec(`INSERT INTO inv_stock (nama, status) VALUES ('Cat', 'PESAN ULANG'), ('Pipa', 'STOK NEGATIF'), ('Plat', 'AMAN')`)
	db.Exec("DELETE FROM external_records WHERE source_id = 'ai-test'")
	defer db.Exec("DELETE FROM external_records WHERE source_id = 'ai-test'")
	db.Exec(`INSERT INTO external_records (source_id, record_key, data) VALUES ('ai-test', 'wp1', ?), ('ai-test', 'wp2', ?)`,
		`{"_key":"wp1","_sheet":"workpermit","date_finish":"`+tomorrow+`","vendor":"Vendor A"}`,
		`{"_key":"wp2","_sheet":"workpermit","date_finish":"2020-01-01","vendor":"Vendor B"}`)
	defer db.Exec("DELETE FROM wo_item_findings")
	defer db.Exec("DELETE FROM inv_stock")

	router := chi.NewRouter()
	router.Get("/api/ai/insights", GetAIInsights)
	get := func(user string) map[string]int {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("GET", "/api/ai/insights", nil).WithContext(asUser(user)))
		var out struct {
			Insights []aiInsight `json:"insights"`
			Latest   []aiInsight `json:"latest"`
		}
		json.Unmarshal(rec.Body.Bytes(), &out)
		counts := map[string]int{}
		for _, i := range out.Latest {
			counts["latest:"+i.Key] = i.Count
			if i.Key == "approved_today" && i.Value != 1500000 {
				t.Errorf("approved today value %v", i.Value)
			}
		}
		for _, i := range out.Insights {
			if i.Question == "" {
				t.Errorf("%s has no question", i.Key)
			}
			counts[i.Key] = i.Count
		}
		return counts
	}
	today := now.Format("2006-01-02")
	db.Exec("DELETE FROM work_order_daily_costs WHERE wo_id = 'ai-latest'")
	defer db.Exec("DELETE FROM work_order_daily_costs WHERE wo_id = 'ai-latest'")
	db.Exec(`INSERT INTO work_order_daily_costs (wo_id, cost_date, approved_cost) VALUES ('ai-latest', ?, 1500000)`, today)
	db.Exec(`UPDATE wo_item_findings SET first_seen = ? WHERE item_id = 'i1'`, today+" 08:00:00")
	db.Exec("DELETE FROM projects WHERE id = 'ai-latest'")
	defer db.Exec("DELETE FROM projects WHERE id = 'ai-latest'")
	db.Exec(`INSERT INTO projects (id, shipname, est_docking_date) VALUES ('ai-latest', 'KM Uji', ?)`, today)

	admin := get("ai-admin")
	if admin["latest:approved_today"] != 1 || admin["latest:new_findings"] != 1 {
		t.Errorf("latest: %v", admin)
	}
	// Ship Docking data isn't used yet.
	if _, ok := admin["latest:docking_today"]; ok {
		t.Error("docking still in latest")
	}
	if _, ok := admin["docking"]; ok {
		t.Error("docking still in insights")
	}
	if admin["findings"] != 2 || admin["stock"] != 2 || admin["permits"] != 1 {
		t.Errorf("admin insights: %v", admin)
	}
	if nobody := get("ai-nobody"); len(nobody) != 0 {
		t.Errorf("insights without access: %v", nobody)
	}
}
