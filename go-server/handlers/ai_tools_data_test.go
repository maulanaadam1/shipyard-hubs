package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"shipyard/db"
)

func aiRequest(user string) *http.Request {
	return httptest.NewRequest("POST", "/api/ai/chat", nil).WithContext(asUser(user))
}

func TestQueryAppData(t *testing.T) {
	db.Exec("DELETE FROM vendors WHERE id LIKE 'aiv-%'")
	defer db.Exec("DELETE FROM vendors WHERE id LIKE 'aiv-%'")
	for _, v := range [][]interface{}{
		{"aiv-1", "PT Las Jaya", "Las", "08123", 12, "Active"},
		{"aiv-2", "CV Cat Prima", "Cat", "08124", 5, "Active"},
		{"aiv-3", "PT Las Mandiri", "Las", "08125", 7, "Inactive"},
	} {
		db.Exec(`INSERT INTO vendors (id, vendor, category, whatapps, jumlah_anggota, status) VALUES (?, ?, ?, ?, ?, ?)`, v...)
	}
	db.Exec("DELETE FROM sync_configs WHERE id = 'MaterialRequisitions'")
	defer db.Exec("DELETE FROM sync_configs WHERE id = 'MaterialRequisitions'")
	db.Exec(`INSERT INTO sync_configs (id, name, url, headers, last_response) VALUES ('MaterialRequisitions', 'MaterialRequisitions', 'https://x', '{"Cookie": "rahasia"}', ?)`,
		`{"data": [{"code": "MR-1", "jo_code": "JO-9", "description": "Plat baja 10mm", "quantity": 4, "flag_delivered": false, "api_token": "x"},
			{"code": "MR-2", "jo_code": "JO-9", "description": "Cat epoxy", "quantity": 20, "flag_delivered": true}]}`)
	db.Exec("DELETE FROM profiles WHERE id IN ('ai-admin', 'ai-nobody')")
	db.Exec(`INSERT INTO profiles (id, email, username, name, role) VALUES ('ai-admin', 'ai-admin@example.test', 'aiadmin', 'AI Admin', 'Admin')`)
	db.Exec(`INSERT INTO profiles (id, email, username, name, role, roles) VALUES ('ai-nobody', 'ai-nobody@example.test', 'ainobody', 'No Rights', 'Staff', '')`)
	defer db.Exec("DELETE FROM profiles WHERE id IN ('ai-admin', 'ai-nobody')")

	run := func(user, input string) (map[string]interface{}, error) {
		req := aiRequest(user)
		res, err := runQueryAppData(req, json.RawMessage(input))
		if err != nil {
			return nil, err
		}
		b, _ := json.Marshal(res)
		var out map[string]interface{}
		json.Unmarshal(b, &out)
		return out, nil
	}

	out, err := run("ai-admin", `{"source": "vendors", "describe": true}`)
	if err != nil || out["rows"].(float64) < 3 {
		t.Fatalf("describe: %v %v", out, err)
	}
	out, err = run("ai-admin", `{"source": "vendors", "search": "las", "filters": {"STATUS": "active"}}`)
	rows, _ := out["rows"].([]interface{})
	if err != nil || len(rows) != 1 || rows[0].(map[string]interface{})["vendor"] != "PT Las Jaya" {
		t.Fatalf("search+filter: %v %v", out, err)
	}
	out, _ = run("ai-admin", `{"source": "vendors", "search": "aiv-", "group_by": "category", "sum_column": "jumlah_anggota"}`)
	groups, _ := out["groups"].([]interface{})
	if len(groups) != 2 || groups[0].(map[string]interface{})["value"] != "Las" || groups[0].(map[string]interface{})["sum"] != float64(19) {
		t.Fatalf("group: %v", out)
	}
	out, _ = run("ai-admin", `{"source": "vendors", "search": "aiv-", "sort_by": "jumlah_anggota", "sort_desc": true, "columns": ["vendor"], "limit": 1}`)
	rows, _ = out["rows"].([]interface{})
	if len(rows) != 1 || rows[0].(map[string]interface{})["vendor"] != "PT Las Jaya" || out["note"] == nil {
		t.Fatalf("sort: %v", out)
	}
	if _, err := run("ai-admin", `{"source": "vendors", "filters": {"nope": "x"}}`); err == nil || !strings.Contains(err.Error(), "kolom") {
		t.Errorf("unknown column: %v", err)
	}

	// Request Material from the synced SIAGA list; secret-like keys are dropped.
	out, err = run("ai-admin", `{"source": "material_requests", "filters": {"jo_code": "JO-9"}, "sum_column": "quantity"}`)
	if err != nil || out["matched"] != float64(2) || out["sum"] != float64(24) {
		t.Fatalf("material: %v %v", out, err)
	}
	if b, _ := json.Marshal(out); strings.Contains(string(b), "api_token") {
		t.Errorf("secret column returned: %s", b)
	}

	// A Job Order's location id gets the location's name.
	db.Exec("DELETE FROM master_locations WHERE id = 'ailoc-1'")
	db.Exec("DELETE FROM projects WHERE id = 'aijo-1'")
	defer db.Exec("DELETE FROM master_locations WHERE id = 'ailoc-1'")
	defer db.Exec("DELETE FROM projects WHERE id = 'aijo-1'")
	db.Exec(`INSERT INTO master_locations (id, name) VALUES ('ailoc-1', 'Slipway Uji')`)
	db.Exec(`INSERT INTO projects (id, shipname, location) VALUES ('aijo-1', 'KM Uji Lokasi', 'ailoc-1')`)
	out, err = run("ai-admin", `{"source": "job_orders", "search": "slipway uji", "columns": ["shipname", "location_name"]}`)
	rows, _ = out["rows"].([]interface{})
	if err != nil || len(rows) != 1 || rows[0].(map[string]interface{})["location_name"] != "Slipway Uji" {
		t.Fatalf("location name: %v %v", out, err)
	}

	// Ship Docking fields are left out of Job Orders, and its tables aren't sources.
	db.Exec(`UPDATE projects SET status_dock = 'Docking', docking = '2026-11-01' WHERE id = 'aijo-1'`)
	out, _ = run("ai-admin", `{"source": "job_orders", "search": "KM Uji Lokasi"}`)
	if b, _ := json.Marshal(out); strings.Contains(string(b), "status_dock") || strings.Contains(string(b), `"docking"`) {
		t.Errorf("docking columns returned: %s", b)
	}
	for _, src := range []string{"ship_movements", "dock_statuses"} {
		if _, err := run("ai-admin", `{"source": "`+src+`"}`); err == nil {
			t.Errorf("source %s accepted", src)
		}
	}

	// Users, roles, permissions and credentials are not sources.
	for _, src := range []string{"profiles", "users", "roles_master", "role_permissions", "sync_configs", "ai_settings", "ai_chat_log"} {
		if _, err := run("ai-admin", `{"source": "`+src+`"}`); err == nil {
			t.Errorf("source %s accepted", src)
		}
	}
	// A user without the page's view right can't read it, nor see the tool.
	if _, err := run("ai-nobody", `{"source": "vendors"}`); err == nil {
		t.Error("vendors readable without Master Vendor access")
	}
	for _, tool := range availableAITools(aiRequest("ai-nobody")) {
		if tool.Name == "query_app_data" {
			t.Error("tool offered to a user without any access")
		}
	}
}
