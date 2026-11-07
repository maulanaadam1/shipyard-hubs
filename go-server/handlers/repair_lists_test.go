package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"shipyard/db"
	"shipyard/itemparse"
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
		if strings.Contains(r.URL.Path, "/55/") {
			// A wrong answer: another Job Order's repair list.
			w.Write([]byte(`{"current_page": 1, "last_page": 1, "data": [{"uniqcode": "x", "t_job_order_id": 77, "description": "Lain", "children": []}]}`))
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
	// Activities are split like WO items as they are stored; groups give the work.
	var work, parsedWith string
	db.QueryRow(`SELECT COALESCE(work_type, ''), COALESCE(parser_version, '') FROM jo_repair_items WHERE jo_id = '77' AND uniqcode = 'act-3'`).Scan(&work, &parsedWith)
	if work != "Ganti baru pipa" || parsedWith != itemparse.RepairVersion {
		t.Errorf("act-3 parsed as %q with %q", work, parsedWith)
	}
	// Older rules: parsed again in the background, groups untouched.
	db.Exec(`UPDATE jo_repair_items SET work_type = '', parser_version = 'old' WHERE jo_id = '77'`)
	if n, err := backfillRepairParsed(); err != nil || n != 4 {
		t.Errorf("backfill: %d, %v", n, err)
	}
	db.QueryRow(`SELECT COALESCE(work_type, '') FROM jo_repair_items WHERE jo_id = '77' AND uniqcode = 'act-3'`).Scan(&work)
	var groupsParsed int
	db.QueryRow(`SELECT COUNT(*) FROM jo_repair_items WHERE jo_id = '77' AND NOT is_leaf AND COALESCE(parser_version, '') = ?`, itemparse.RepairVersion).Scan(&groupsParsed)
	if work != "Ganti baru pipa" || groupsParsed != 0 {
		t.Errorf("after backfill: %q, %d groups parsed", work, groupsParsed)
	}
	if n, _ := backfillRepairParsed(); n != 0 {
		t.Errorf("second backfill parsed %d", n)
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
	// The list: every Job Order of the Job Order menu, and others with a repair list.
	byID := func(user string) map[string]map[string]interface{} {
		out := map[string]map[string]interface{}{}
		for _, j := range get(user, "/api/repair-lists")["job_orders"].([]interface{}) {
			row := j.(map[string]interface{})
			out[row["jo_id"].(string)] = row
		}
		return out
	}
	all := byID("rl-admin")
	if j := all["77"]; j == nil || j["state"] != "ok" || j["total_price"] != float64(3500000) || j["items_in_wo"] != float64(2) {
		t.Errorf("Job Order 77 in the list: %v", j)
	}
	if j := all["88"]; j == nil || j["state"] != "ok" || j["jo_code"] != "JO-88/T" || j["ship"] != "KM DELAPAN" || j["version"] != float64(2) {
		t.Errorf("Job Order 88 in the list: %v", j)
	}
	if j := all["99"]; j == nil || j["state"] != "none" || j["items"] != float64(0) {
		t.Errorf("Job Order 99 (no repair list) in the list: %v", j)
	}
	if _, ok := byID("rl-viewer")["77"]["total_price"]; ok {
		t.Error("list price shown without Harga Penawaran")
	}
	if s := get("rl-admin", "/api/repair-lists/88")["summary"].(map[string]interface{}); s["ship"] != "KM DELAPAN" || s["state"] != "ok" {
		t.Errorf("Job Order 88 summary: %v", s)
	}
	// A Job Order not fetched yet: listed as pending, an empty detail.
	db.Exec(`INSERT INTO projects (id, id_siaga, idproject, shipname) VALUES ('rl-p66', 66, 'JO-66/T', 'KM ENAM')`)
	t.Cleanup(func() { db.Exec("DELETE FROM projects WHERE id = 'rl-p66'") })
	if j := byID("rl-admin")["66"]; j == nil || j["state"] != "pending" {
		t.Errorf("Job Order 66 (not fetched): %v", j)
	}
	if d := get("rl-admin", "/api/repair-lists/66"); d["summary"].(map[string]interface{})["state"] != "pending" || len(d["items"].([]interface{})) != 0 {
		t.Errorf("Job Order 66 detail: %v", d)
	}
	db.Exec("DELETE FROM projects WHERE id = 'rl-p66'")

	// The AI tool reads the same data.
	runTool := func(user, input string) map[string]interface{} {
		t.Helper()
		out, err := runRepairList(aiRequest(user), json.RawMessage(input))
		if err != nil {
			t.Fatalf("repair_list %s: %v", input, err)
		}
		return out.(map[string]interface{})
	}
	toolList := runTool("rl-admin", `{"state": "ok"}`)
	if toolList["matched"] != 2 { // 77 and 88
		t.Errorf("repair_list ok list: %v", toolList)
	}
	// One match gives the detail: version totals and the activities without a WO.
	without := runTool("rl-admin", `{"query": "delapan"}`)
	if without["job_order"].(map[string]interface{})["jo_id"] != "88" {
		t.Errorf("repair_list single match: %v", without)
	}
	without = runTool("rl-admin", `{"jo_id": "77", "wo": "without"}`)
	acts := without["activities"].([]map[string]interface{})
	if without["matching_activities"] != 2 || len(acts) != 2 || acts[0]["activity"] != "Ganti pipa" || acts[0]["group"] != "Perpipaan" ||
		acts[1]["version"] != 2 || without["matching_total_price"] != float64(1000000) {
		t.Errorf("repair_list without WO: %v", without)
	}
	if v, _ := json.Marshal(without["versions"]); !strings.Contains(string(v), `{"version":1,"activities":3,"activities_with_wo":2,"total_price":3500000,"price_without_wo":1000000}`) ||
		!strings.Contains(string(v), `{"version":2,"activities":1,"activities_with_wo":0}`) {
		t.Errorf("repair_list versions: %s", v)
	}
	withWO := runTool("rl-admin", `{"jo_id": "77", "wo": "with", "activity": "manhole"}`)
	if a := withWO["activities"].([]map[string]interface{}); len(a) != 1 || len(a[0]["wo"].([]string)) != 2 || a[0]["total_price"] != float64(2000000) {
		t.Errorf("repair_list with WO: %v", withWO)
	}
	if v2 := runTool("rl-admin", `{"jo_id": "77", "version": 2}`); v2["matching_activities"] != 1 {
		t.Errorf("repair_list version 2: %v", v2)
	}
	if noPrice := runTool("rl-viewer", `{"jo_id": "77"}`); noPrice["activities"].([]map[string]interface{})[0]["total_price"] != nil || noPrice["matching_total_price"] != nil {
		t.Errorf("repair_list prices without Harga Penawaran: %v", noPrice)
	}
	if none := runTool("rl-admin", `{"jo_id": "99"}`); !strings.Contains(none["note"].(string), "tidak punya repair list") {
		t.Errorf("repair_list none: %v", none)
	}

	// Item Repair List: every activity of every repair list.
	router.Get("/api/repair-items", GetRepairItems)
	router.Get("/api/repair-items/summary", GetRepairItemSummary)
	router.Get("/api/repair-items/facets", GetRepairItemFacets)
	itemsAll := get("rl-admin", "/api/repair-items?limit=100")
	if itemsAll["total"] != float64(6) || itemsAll["total_price"] != float64(3500200) { // 77: 4, 88: 2
		t.Errorf("repair items: total %v, price %v", itemsAll["total"], itemsAll["total_price"])
	}
	without77 := get("rl-admin", "/api/repair-items?jo_id=77&wo=without")["items"].([]interface{})
	if len(without77) != 2 {
		t.Fatalf("repair items without WO: %v", without77)
	}
	pipe := without77[0].(map[string]interface{})
	if pipe["activity"] != "Ganti pipa" || pipe["group"] != "Perpipaan" || pipe["work_type"] != "Ganti baru pipa" || pipe["version"] != float64(1) {
		t.Errorf("repair item: %v", pipe)
	}
	if extra := without77[1].(map[string]interface{}); extra["version"] != float64(2) {
		t.Errorf("additional activity: %v", extra)
	}
	with77 := get("rl-admin", "/api/repair-items?jo_id=77&wo=with&q=manhole")["items"].([]interface{})
	if len(with77) != 1 || len(with77[0].(map[string]interface{})["wos"].([]interface{})) != 2 {
		t.Errorf("repair items with WO: %v", with77)
	}
	if n := get("rl-admin", "/api/repair-items?version=tambahan")["total"]; n != float64(2) { // 77 v2, 88 v2
		t.Errorf("additional activities: %v", n)
	}
	byWork := get("rl-admin", "/api/repair-items/summary?by=work_type_size&jo_id=77&version=utama")
	found := false
	for _, row := range byWork["rows"].([]interface{}) {
		m := row.(map[string]interface{})
		if m["work_type"] == "Ganti baru pipa" {
			found = m["unit_price_median"] == float64(250000) && m["activities"] == float64(1) && m["unit"] == "m"
		}
	}
	if !found {
		t.Errorf("summary by work type & size: %v", byWork)
	}
	byJO := get("rl-admin", "/api/repair-items/summary?by=job_order")["rows"].([]interface{})
	if len(byJO) != 2 || byJO[0].(map[string]interface{})["jo_id"] != "77" {
		t.Errorf("summary by Job Order: %v", byJO)
	}
	if s := get("rl-viewer", "/api/repair-items/summary?by=work_type_size")["rows"].([]interface{}); len(s) == 0 || s[0].(map[string]interface{})["unit_price_median"] != nil {
		t.Errorf("summary prices without Harga Penawaran: %v", s)
	}
	if it := get("rl-viewer", "/api/repair-items")["items"].([]interface{}); it[0].(map[string]interface{})["total_price"] != nil {
		t.Error("item prices without Harga Penawaran")
	}
	if f := get("rl-admin", "/api/repair-items/facets"); len(f["work_types"].([]interface{})) == 0 {
		t.Errorf("facets: %v", f)
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

	// A RepairLists URL without placeholders (one fixed Job Order) is ignored.
	db.Exec(`INSERT INTO sync_configs (id, name, url, headers, is_active) VALUES ('RepairLists', 'RepairLists', ?, '{}', true)`,
		server.URL+"/api/v2/repair-lists/1200/activities?modul_id=t_job_orders&version=1&page=1")
	db.Exec(`UPDATE sync_configs SET headers = '{"X-Test-Auth": "secret"}' WHERE id = 'WorkOrderDetails'`)
	db.Exec("DELETE FROM jo_repair_lists WHERE jo_id = '77'")
	requests = nil
	if n, err := syncRepairLists(); err != nil || n != 1 || !strings.Contains(requests[0], "/repair-lists/77/") {
		t.Fatalf("fixed URL not ignored: %d, %v, %v", n, err, requests)
	}
	db.Exec("DELETE FROM sync_configs WHERE id = 'RepairLists'")

	// SIAGA answering with another Job Order's list: refused, nothing kept.
	db.Exec(`INSERT INTO jo_repair_items (jo_id, uniqcode, description, is_leaf, total_price) VALUES ('55', 'old', 'lama', true, 999)`)
	db.Exec(`INSERT INTO jo_repair_lists (jo_id, version, items, total_price, fetched_at, error, format) VALUES ('55', 1, 1, 999, '2000-01-01 00:00:00', '', 0)`)
	db.Exec(`INSERT INTO projects (id, id_siaga, idproject) VALUES ('rl-p55', 55, 'JO-55/T')`)
	t.Cleanup(func() { db.Exec("DELETE FROM projects WHERE id = 'rl-p55'") })
	syncRepairLists()
	var failure55 string
	var items55 int
	db.QueryRow(`SELECT COALESCE(error, '') FROM jo_repair_lists WHERE jo_id = '55'`).Scan(&failure55)
	db.QueryRow(`SELECT COUNT(*) FROM jo_repair_items WHERE jo_id = '55'`).Scan(&items55)
	if !strings.Contains(failure55, "Job Order 77") || items55 != 0 {
		t.Errorf("mismatch: %q, %d items kept", failure55, items55)
	}

	// Credentials refused: the sync stops with a clear error.
	db.Exec(`UPDATE sync_configs SET headers = '{}' WHERE id = 'WorkOrderDetails'`)
	db.Exec("DELETE FROM jo_repair_lists")
	if _, err := syncRepairLists(); err == nil || !strings.Contains(err.Error(), "API Sync Config") {
		t.Errorf("auth error: %v", err)
	}
}
