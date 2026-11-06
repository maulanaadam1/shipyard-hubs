package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"shipyard/db"
	"shipyard/middleware"
)

func TestBuildReferencesWindow(t *testing.T) {
	var items []pricedItem
	add := func(work string, n int, cost float64, date string) {
		for i := 0; i < n; i++ {
			items = append(items, pricedItem{workType: work, unit: "pcs", unitCost: cost, status: "approved", approvalDate: date})
		}
	}
	add("recent", 12, 200, "2026-10-01") // enough within 24 months
	add("recent", 12, 50, "2022-01-01")  // older price level, left out
	add("old", 15, 80, "2021-05-01")     // only older items: falls back to all years
	add("few", 9, 10, "2026-10-01")      // too few for a reference
	items = append(items, pricedItem{workType: "recent", unit: "pcs", unitCost: 999, status: "pending"})

	refs := buildReferences(items)
	if r := refs[referenceKey{"recent", "", "pcs"}]; r.N != 12 || r.Median != 200 || r.Basis != "24 bulan" {
		t.Errorf("recent = %+v", r)
	}
	if r := refs[referenceKey{"old", "", "pcs"}]; r.N != 15 || r.Median != 80 || r.Basis != "semua" {
		t.Errorf("old = %+v", r)
	}
	if _, ok := refs[referenceKey{"few", "", "pcs"}]; ok {
		t.Error("a reference from 9 items")
	}
}

func TestEvaluateFindings(t *testing.T) {
	ref := map[referenceKey]itemReference{{"pipa", `2"`, "m"}: {N: 20, P25: 90, Median: 100, P75: 110, Basis: "24 bulan"}}
	long := 3200100.0
	items := []pricedItem{
		{woID: "1", itemID: "a", workType: "pipa", size: `2"`, unit: "m", unitCost: 130, volume: 4},  // within range
		{woID: "1", itemID: "b", workType: "pipa", size: `2"`, unit: "m", unitCost: 400, volume: 3},  // far above
		{woID: "1", itemID: "c", workType: "pipa", size: `3"`, unit: "m", unitCost: 9999, volume: 1}, // no reference
		{woID: "1", itemID: "d", workType: "pipa", size: `2"`, unit: "m", pipeMM: &long},
		{woID: "1", itemID: "e", workType: "pipa", size: `2"`, unit: "m", unitCost: 900, volume: 1, bundle: true, pipeMM: &long},
	}
	got := map[string]itemFinding{}
	for _, f := range evaluateFindings(items, ref) {
		got[f.itemID+"/"+f.rule] = f
	}
	if len(got) != 2 {
		t.Fatalf("findings = %+v", got)
	}
	if f := got["b/"+RulePriceHigh]; f.excess != 900 || f.reference != 100 || !strings.Contains(f.detail, "4.0x median Rp 100") {
		t.Errorf("price finding = %+v", f)
	}
	if f := got["d/"+RulePipeLength]; !strings.Contains(f.detail, "3.200.100 mm") {
		t.Errorf("pipe finding = %+v", f)
	}
}

// seedFindingItems stores 12 approved items of one work type at Rp 100 and
// one more item (it-x) at cost.
func seedFindingItems(t *testing.T, cost float64) {
	t.Helper()
	db.Exec("DELETE FROM wo_items")
	db.Exec("DELETE FROM wo_item_parsed")
	put := func(id string, c float64, status string) {
		if _, err := db.Exec(`INSERT INTO wo_items (wo_id, item_id, label, unit, volume, unit_cost, total_cost, status, approval_date)
			VALUES ('500', ?, 'Ganti baru packing karet', 'Pcs', 2, ?, ?, ?, '2026-10-01')`, id, c, c*2, status); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`INSERT INTO wo_item_parsed (wo_id, item_id, work_type, size, recognized, parser_version)
			VALUES ('500', ?, 'Ganti baru packing karet', '', true, 'test')`, id); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 12; i++ {
		put(fmt.Sprintf("it-%d", i), 100, "approved")
	}
	put("it-x", cost, "pending")
}

func findingStatus(t *testing.T) string {
	t.Helper()
	var s string
	db.QueryRow(`SELECT COALESCE(status, '') FROM wo_item_findings WHERE wo_id = '500' AND item_id = 'it-x' AND rule = ?`, RulePriceHigh).Scan(&s)
	return s
}

func postFindingStatus(t *testing.T, body string) int {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/wo-findings/status", strings.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), middleware.UserClaimsKey, middleware.UserClaims{Name: "Tester"}))
	UpdateItemFindingStatus(rec, req)
	return rec.Code
}

// A finding opens, can be ignored with a note, stays ignored on the next run,
// resolves once the item is fixed and reopens if the price comes back.
func TestItemFindingsLifecycle(t *testing.T) {
	resetWorkOrderTables(t)
	t.Setenv("WO_FINDINGS_PAUSE_MS", "1")
	db.Exec(`INSERT INTO work_order_summary (wo_id, wo_code, project_name, vendor_name) VALUES ('500', 'WO-500', 'JO-1 - KAPAL', 'Vendor A')`)

	seedFindingItems(t, 450)
	if res, err := RunItemFindings(); err != nil || res.Opened != 1 {
		t.Fatalf("first run: %+v, %v", res, err)
	}
	if s := findingStatus(t); s != "open" {
		t.Fatalf("status = %q", s)
	}

	rec := httptest.NewRecorder()
	GetItemFindings(rec, httptest.NewRequest("GET", "/api/wo-findings", nil))
	var list struct {
		Data  []findingRow `json:"data"`
		Total int          `json:"total"`
	}
	json.Unmarshal(rec.Body.Bytes(), &list)
	if list.Total != 1 || list.Data[0].WOCode != "WO-500" || list.Data[0].Excess != 700 || list.Data[0].RefN != 12 || list.Data[0].ItemStatus != "pending" {
		t.Fatalf("list = %+v", list)
	}

	key := `"wo_id": "500", "item_id": "it-x", "rule": "price_high"`
	if code := postFindingStatus(t, `{`+key+`, "status": "ignored"}`); code != 400 {
		t.Errorf("ignore without a note: %d", code)
	}
	if code := postFindingStatus(t, `{`+key+`, "status": "ignored", "note": "Harga khusus, sudah dikonfirmasi"}`); code != 200 {
		t.Fatalf("ignore: %d", code)
	}
	var by string
	db.QueryRow(`SELECT COALESCE(ignored_by, '') FROM wo_item_findings WHERE item_id = 'it-x'`).Scan(&by)
	if s := findingStatus(t); s != "ignored" || by != "Tester" {
		t.Errorf("after ignore: %q by %q", s, by)
	}
	RunItemFindings()
	if s := findingStatus(t); s != "ignored" {
		t.Errorf("rerun changed an ignored finding to %q", s)
	}

	seedFindingItems(t, 110) // fixed in SIAGA
	if res, _ := RunItemFindings(); res.Resolved != 1 || findingStatus(t) != "resolved" {
		t.Errorf("after fix: %+v, status %q", res, findingStatus(t))
	}
	seedFindingItems(t, 500) // wrong again
	if res, _ := RunItemFindings(); res.Opened != 1 || findingStatus(t) != "open" {
		t.Errorf("after relapse: %+v, status %q", res, findingStatus(t))
	}

	var refs int
	db.QueryRow(`SELECT COUNT(*) FROM wo_item_reference`).Scan(&refs)
	if refs != 1 {
		t.Errorf("references = %d", refs)
	}
}

func TestUnitPriceComparable(t *testing.T) {
	for _, c := range []struct {
		object, label string
		want          bool
	}{
		{"Paket pekerjaan", "Termin 4 Progres 55%, 1", false},
		{"Packing", `Ganti baru packing , bahan karet dia. 2" x 3 mm, jumlah 4 unit`, true},
		{"Tenaga kerja", "Lembur 5 orang x 4 jam", false},
		{"Crane / hoist", "buat baru crane store, 1 unit <br>-pipa tiang d 3 inch<br>-plat 10 mm", true},
		{"Kampas rem", "Kampas rem rampdoor haluan kanan, 1 unit <br>-bongkar servis ganti baru<br>-kampas uk. 2400 x 100 x 10 mm", true},
		{"Valve (lain)", "ENGINE DEPARTMENT, 1 unit <br>-OH PV VALVE (10 Unit)<br>-OH A/E Fuel Injection Pump", false},
		{"Kapal", "Jasa Turun Kapal Tongkang 180 Feet Ruang Lingkup Perkerjaan: 1. Mobilisasi", false},
		{"Blasting", "Pekerjaan Blasting dan Painting 2 Kapal Tongkang, Pembayaran Termin X 10%, 1", false},
		{"Pipa", "Pekerjaan sistem pipa, ventilasi, electrical (DP 40%), 1", false},
		{"Pipa", "Pekerjaan sistem pipa, ventilasi (TERM II 30%), 1", false},
		{"Plat", "Potong Tekuk Plat 8 mm dan Laser, 1", true},
		{"Tangki", "Cleaning minyak , kapasitas 4 m3 (BORONGAN)", false},
		{"Plat", "Additional Work dan Rework Elektrik, Pipa, Interior, Tonase & Reward", false},
		{"Cat", "Pengecatan lambung, thinner 10%", true}, // a percentage alone is fine
		{"Plat", strings.Repeat("Replating plat lambung kanan ", 8), false},
	} {
		action := ""
		if c.object == "Paket pekerjaan" {
			action = "Pembayaran termin / progres"
		}
		if got := unitPriceComparable(action, c.object, c.label); got != c.want {
			t.Errorf("unitPriceComparable(%q, %.40q) = %v, want %v", c.object, c.label, got, c.want)
		}
	}
}

// A finding on an item the rules no longer cover is removed, not shown as solved.
func TestFindingOutOfScopeRemoved(t *testing.T) {
	resetWorkOrderTables(t)
	t.Setenv("WO_FINDINGS_PAUSE_MS", "1")
	seedFindingItems(t, 450)
	RunItemFindings()
	if findingStatus(t) != "open" {
		t.Fatal("no finding to start with")
	}
	db.Exec(`UPDATE wo_item_parsed SET object = 'Tenaga kerja' WHERE item_id = 'it-x'`)
	if res, _ := RunItemFindings(); res.Removed != 1 || res.Resolved != 0 {
		t.Errorf("run: %+v", res)
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM wo_item_findings`).Scan(&n)
	if n != 0 {
		t.Errorf("%d findings left", n)
	}
}

// Findings by the day they were found or by the item's approval date, so
// "temuan minggu ini" gets a precise period.
func TestItemFindingsDateFilter(t *testing.T) {
	resetWorkOrderTables(t)
	t.Setenv("WO_FINDINGS_PAUSE_MS", "1")
	db.Exec(`INSERT INTO work_order_summary (wo_id, wo_code, project_name, vendor_name) VALUES ('500', 'WO-500', 'JO-1 - KAPAL', 'Vendor A')`)
	seedFindingItems(t, 450) // the pending item, approval_date 2026-10-01, is flagged
	if _, err := RunItemFindings(); err != nil {
		t.Fatal(err)
	}
	today := time.Now().Format("2006-01-02")
	yesterday := time.Now().AddDate(0, 0, -1).Format("2006-01-02")
	count := func(q string) float64 {
		t.Helper()
		rec := httptest.NewRecorder()
		GetItemFindings(rec, httptest.NewRequest("GET", "/api/wo-findings?"+q, nil))
		var out struct{ Total float64 }
		json.Unmarshal(rec.Body.Bytes(), &out)
		return out.Total
	}
	for q, want := range map[string]float64{
		"date_from=" + today + "&date_to=" + today:                    1,
		"date_to=" + yesterday:                                        0,
		"date_field=approval&date_from=2026-10-01&date_to=2026-10-01": 1,
		"date_field=approval&date_from=2026-10-02":                    0,
		"date_field=approval&date_from=2026-09-01&date_to=2026-09-30": 0,
	} {
		if got := count(q); got != want {
			t.Errorf("%s: %v findings, want %v", q, got, want)
		}
	}
	// Through the AI tool too.
	res, err := runDataFindings(aiRequest("ai-admin"), json.RawMessage(`{"date_from": "`+today+`", "date_to": "`+today+`"}`))
	if err != nil || res.(map[string]interface{})["matching"] != float64(1) {
		t.Errorf("data_findings with dates: %v %v", res, err)
	}
	if _, err := runDataFindings(aiRequest("ai-admin"), json.RawMessage(`{"date_field": "kemarin"}`)); err == nil {
		t.Error("bad date_field accepted")
	}
}
