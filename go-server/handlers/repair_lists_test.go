package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"shipyard/db"
)

// A two-page repair list for Job Order 77: act-1 and act-2 have WOs (see
// repairPriceDetail), act-3 has none yet.
func fakeRepairListServer(t *testing.T, requests *[]string) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*requests = append(*requests, r.URL.Path+"?"+r.URL.RawQuery)
		if r.Header.Get("X-Test-Auth") != "secret" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "/88/") {
			// A Job Order only in projects: versions 1 and 2 exist.
			if v := r.URL.Query().Get("version"); v == "1" || v == "2" {
				w.Write([]byte(`{"current_page": 1, "last_page": 1, "data": [{"uniqcode": "p88-` + v + `", "path": "1", "description": "Pekerjaan v` + v + `",
					"unit": "ls", "price": "100", "quantity": "1", "version": ` + v + `, "parameter": {"total_price": 100}, "children": []}]}`))
				return
			}
			w.Write([]byte(`{"current_page": 1, "last_page": 1, "data": []}`))
			return
		}
		if strings.Contains(r.URL.Path, "/99/") {
			w.Write([]byte(`{"current_page": 1, "last_page": 1, "data": []}`)) // no repair list
			return
		}
		if r.URL.Query().Get("version") == "2" {
			// Version 2 is an additional repair list, not yet priced.
			w.Write([]byte(`{"current_page": 1, "last_page": 1, "data": [
				{"uniqcode": "act-4", "path": "1", "description": "Bantalan shaft (tambahan)", "unit": "", "price": "0.00", "quantity": "0",
				 "version": 2, "children": []}]}`))
			return
		}
		if r.URL.Query().Get("page") == "1" {
			w.Write([]byte(`{"current_page": 1, "last_page": 2, "data": [
				{"uniqcode": "grp-1", "path": "1", "description": "Kontruksi", "price": "0.00", "quantity": "0", "version": 2, "children": [
					{"uniqcode": "act-1", "path": "1.1", "description": "Pembuatan manhole", "unit": "Unit", "price": "1000000.00", "quantity": "2",
					 "version": 2, "parameter": {"total_price": 2000000}, "children": []},
					{"uniqcode": "act-2", "path": "1.2", "description": "Tanda selar", "unit": "Unit", "price": "500000.00", "quantity": "1",
					 "version": 2, "parameter": {"total_price": 500000}, "children": []}
				]}]}`))
			return
		}
		w.Write([]byte(`{"current_page": 2, "last_page": 2, "data": [
			{"uniqcode": "grp-2", "path": "2", "description": "Perpipaan", "price": "0.00", "quantity": "0", "version": 2, "children": [
				{"uniqcode": "act-3", "path": "2.1", "description": "Ganti pipa", "unit": "m", "price": "250000.00", "quantity": "4",
				 "version": 2, "parameter": {"total_price": 1000000}, "children": []}
			]}]}`))
	}))
}

func TestRepairLists(t *testing.T) {
	t.Setenv("REPAIR_LIST_PAUSE_MS", "0")
	resetWorkOrderTables(t)
	for _, table := range []string{"wo_repair_activities", "jo_repair_lists", "jo_repair_items"} {
		db.Exec("DELETE FROM " + table)
	}
	t.Cleanup(func() {
		for _, table := range []string{"wo_repair_activities", "jo_repair_lists", "jo_repair_items"} {
			db.Exec("DELETE FROM " + table)
		}
		db.Exec("DELETE FROM sync_configs WHERE id = 'WorkOrderDetails'")
		db.Exec("DELETE FROM profiles WHERE id IN ('rl-admin', 'rl-viewer')")
	})
	// Two WOs of Job Order 77 (repair_prices_test.go); the Job Order is at version 2.
	for id, body := range map[string]string{
		"501": strings.Replace(repairPriceDetail("501", "WO-A/T", "Vendor A", 300000, `{"id": "x1", "path": "1.2.1", "label": "Cat", "unit": "Unit", "volume": 1, "volume_cost_final": 0, "approved_level": 5, "status_approval": "approved", "date_approval": "2026-10-01 08:00:00"}`), `"code_project": "JO-77/T - KM UJI"`, `"code_project": "JO-77/T - KM UJI", "latest_version": 2`, 1),
		"502": repairPriceDetail("502", "WO-B/T", "Vendor B", 50000, `{"id": "x2", "path": "1.2.1", "label": "Cat", "unit": "Unit", "volume": 1, "volume_cost_final": 0, "approved_level": 5, "status_approval": "approved", "date_approval": "2026-10-01 08:00:00"}`),
	} {
		if err := storeWorkOrderDetail(id, []byte(body)); err != nil {
			t.Fatal(err)
		}
	}

	var requests []string
	server := fakeRepairListServer(t, &requests)
	defer server.Close()
	db.Exec("DELETE FROM sync_configs WHERE id = 'WorkOrderDetails'")
	db.Exec(`INSERT INTO sync_configs (id, name, url, headers, is_active) VALUES ('WorkOrderDetails', 'WorkOrderDetails', ?, '{"X-Test-Auth": "secret"}', true)`,
		server.URL+"/api/v1/work-orders/{{id}}")

	// Job Orders only in the Job Order menu (projects): 88 has a repair list
	// at version 2, 99 has none.
	db.Exec("DELETE FROM projects WHERE id IN ('rl-p88', 'rl-p99')")
	t.Cleanup(func() { db.Exec("DELETE FROM projects WHERE id IN ('rl-p88', 'rl-p99')") })
	db.Exec(`INSERT INTO projects (id, id_siaga, idproject, shipname) VALUES ('rl-p88', 88, 'JO-88/T', 'KM DELAPAN'), ('rl-p99', 99, 'JO-99/T', 'KM SEMBILAN')`)

	n, err := syncRepairLists()
	if err != nil || n != 2 {
		t.Fatalf("sync: %d, %v (requests %v)", n, err, requests)
	}
	var jo77 []string
	for _, r := range requests {
		if strings.Contains(r, "/77/") {
			jo77 = append(jo77, r)
		}
	}
	// Every version: 1 (two pages) and the additional version 2.
	if len(jo77) != 3 || !strings.Contains(jo77[0], "version=1&page=1") || !strings.Contains(jo77[2], "version=2&page=1") {
		t.Errorf("Job Order 77 requests: %v", jo77)
	}
	var v88, items88 int
	db.QueryRow(`SELECT version, items FROM jo_repair_lists WHERE jo_id = '88'`).Scan(&v88, &items88)
	if v88 != 2 || items88 != 4 { // two version groups, one activity each
		t.Errorf("Job Order 88: version %d, items %d", v88, items88)
	}
	var failure99 string
	db.QueryRow(`SELECT COALESCE(error, '') FROM jo_repair_lists WHERE jo_id = '99'`).Scan(&failure99)
	if failure99 != "tidak ada repair list di SIAGA" {
		t.Errorf("Job Order 99: %q", failure99)
	}
	// Up to date: nothing fetched again.
	if n, _ := syncRepairLists(); n != 0 {
		t.Errorf("second sync fetched %d", n)
	}

	db.Exec(`INSERT INTO profiles (id, email, username, name, role) VALUES ('rl-admin', 'rl-admin@example.test', 'rladmin', 'Admin', 'Admin')`)
	db.Exec(`INSERT INTO profiles (id, email, username, name, role, roles, extra_roles) VALUES ('rl-viewer', 'rl-viewer@example.test', 'rlviewer', 'Viewer', 'Staff', '', ?)`, ResourceRepairList)
	router := chi.NewRouter()
	router.Get("/api/repair-lists", GetRepairLists)
	router.Get("/api/repair-lists/{id}", GetRepairList)
	get := func(user, path string) map[string]interface{} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest("GET", path, nil).WithContext(asUser(user)))
		var out map[string]interface{}
		json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}

	detail := get("rl-admin", "/api/repair-lists/77")
	sum := detail["summary"].(map[string]interface{})
	want := map[string]float64{"items": 4, "items_in_wo": 2, "total_price": 3500000, "price_in_wo": 2500000, "price_without_wo": 1000000, "cost": 700000, "margin": 2800000}
	for k, v := range want {
		if sum[k] != v {
			t.Errorf("summary %s = %v, want %v", k, sum[k], v)
		}
	}
	items := detail["items"].([]interface{})
	// Version groups first: "Repair list versi 1" > Kontruksi > activities, then the additional version 2.
	if len(items) != 8 || items[0].(map[string]interface{})["description"] != "Repair list versi 1" ||
		items[1].(map[string]interface{})["description"] != "Kontruksi" || items[2].(map[string]interface{})["depth"] != float64(2) ||
		items[6].(map[string]interface{})["description"] != "Repair list tambahan versi 2" {
		t.Fatalf("items: %v", items)
	}
	if wos := items[2].(map[string]interface{})["wos"].([]interface{}); len(wos) != 2 {
		t.Errorf("act-1 WOs: %v", wos)
	}
	if wos := items[5].(map[string]interface{})["wos"].([]interface{}); len(wos) != 0 {
		t.Errorf("act-3 should have no WO: %v", wos)
	}

	// Without the Harga Penawaran permission: the list, no prices.
	viewer := get("rl-viewer", "/api/repair-lists/77")
	if _, ok := viewer["summary"].(map[string]interface{})["total_price"]; ok {
		t.Error("prices shown without Harga Penawaran")
	}
	if _, ok := viewer["items"].([]interface{})[2].(map[string]interface{})["total_price"]; ok {
		t.Error("item price shown without Harga Penawaran")
	}
	list := get("rl-admin", "/api/repair-lists?q=uji")
	if jos := list["job_orders"].([]interface{}); len(jos) != 1 || jos[0].(map[string]interface{})["total_price"] != float64(3500000) {
		t.Errorf("list: %v", list)
	}
	// The projects-only Job Order shows with its code; the one without a repair list doesn't.
	all := get("rl-admin", "/api/repair-lists")
	codes := []string{}
	for _, j := range all["job_orders"].([]interface{}) {
		codes = append(codes, j.(map[string]interface{})["jo_code"].(string))
	}
	if len(codes) != 2 || !strings.Contains(strings.Join(codes, "|"), "JO-88/T - KM DELAPAN") {
		t.Errorf("list codes: %v", codes)
	}

	// Job Order margins now use the whole repair list.
	rec := httptest.NewRecorder()
	GetJobMargins(rec, httptest.NewRequest("GET", "/api/job-margins?q=uji", nil))
	var margins map[string]interface{}
	json.Unmarshal(rec.Body.Bytes(), &margins)
	jo := margins["job_orders"].([]interface{})[0].(map[string]interface{})
	if jo["price"] != float64(3500000) || jo["price_in_wo"] != float64(2500000) || jo["from_repair_list"] != true || jo["margin"] != float64(2800000) {
		t.Errorf("margin: %v", jo)
	}

	// A RepairLists config: its URL template and headers are used.
	db.Exec("DELETE FROM sync_configs WHERE id = 'RepairLists'")
	t.Cleanup(func() { db.Exec("DELETE FROM sync_configs WHERE id = 'RepairLists'") })
	db.Exec(`UPDATE sync_configs SET headers = '{}' WHERE id = 'WorkOrderDetails'`)
	db.Exec(`INSERT INTO sync_configs (id, name, url, headers, is_active) VALUES ('RepairLists', 'RepairLists', ?, '{"X-Test-Auth": "secret"}', true)`,
		server.URL+"/custom/{{id}}/activities?version={{version}}&page={{page}}")
	db.Exec("DELETE FROM jo_repair_lists WHERE jo_id = '77'")
	requests = nil
	if n, err := syncRepairLists(); err != nil || n != 1 || !strings.HasPrefix(requests[0], "/custom/77/activities") {
		t.Fatalf("override: %d, %v, %v", n, err, requests)
	}
	db.Exec("DELETE FROM sync_configs WHERE id = 'RepairLists'")

	// Credentials refused: the sync stops with a clear error.
	db.Exec(`UPDATE sync_configs SET headers = '{}' WHERE id = 'WorkOrderDetails'`)
	db.Exec("DELETE FROM jo_repair_lists")
	if _, err := syncRepairLists(); err == nil || !strings.Contains(err.Error(), "API Sync Config") {
		t.Errorf("auth error: %v", err)
	}
}
