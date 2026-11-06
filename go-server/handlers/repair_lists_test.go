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

	n, err := syncRepairLists()
	if err != nil || n != 1 {
		t.Fatalf("sync: %d, %v (requests %v)", n, err, requests)
	}
	if len(requests) != 2 || !strings.Contains(requests[0], "/api/v2/repair-lists/77/activities") || !strings.Contains(requests[0], "version=2") {
		t.Errorf("requests: %v", requests)
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
	want := map[string]float64{"items": 3, "items_in_wo": 2, "total_price": 3500000, "price_in_wo": 2500000, "price_without_wo": 1000000, "cost": 700000, "margin": 2800000}
	for k, v := range want {
		if sum[k] != v {
			t.Errorf("summary %s = %v, want %v", k, sum[k], v)
		}
	}
	items := detail["items"].([]interface{})
	if len(items) != 5 || items[0].(map[string]interface{})["description"] != "Kontruksi" || items[1].(map[string]interface{})["depth"] != float64(1) {
		t.Fatalf("items: %v", items)
	}
	if wos := items[1].(map[string]interface{})["wos"].([]interface{}); len(wos) != 2 {
		t.Errorf("act-1 WOs: %v", wos)
	}
	if wos := items[4].(map[string]interface{})["wos"].([]interface{}); len(wos) != 0 {
		t.Errorf("act-3 should have no WO: %v", wos)
	}

	// Without the Harga Penawaran permission: the list, no prices.
	viewer := get("rl-viewer", "/api/repair-lists/77")
	if _, ok := viewer["summary"].(map[string]interface{})["total_price"]; ok {
		t.Error("prices shown without Harga Penawaran")
	}
	if _, ok := viewer["items"].([]interface{})[1].(map[string]interface{})["total_price"]; ok {
		t.Error("item price shown without Harga Penawaran")
	}
	list := get("rl-admin", "/api/repair-lists?q=uji")
	if jos := list["job_orders"].([]interface{}); len(jos) != 1 || jos[0].(map[string]interface{})["total_price"] != float64(3500000) {
		t.Errorf("list: %v", list)
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

	// Credentials refused: the sync stops with a clear error.
	db.Exec(`UPDATE sync_configs SET headers = '{}' WHERE id = 'WorkOrderDetails'`)
	db.Exec("DELETE FROM jo_repair_lists")
	if _, err := syncRepairLists(); err == nil || !strings.Contains(err.Error(), "API Sync Config") {
		t.Errorf("auth error: %v", err)
	}
}
