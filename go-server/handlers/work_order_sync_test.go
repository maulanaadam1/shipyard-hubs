package handlers

import (
	"encoding/json"
	"io"
	"log"
	"math"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"shipyard/db"
)

// TestMain gives the package's DB-backed tests a throwaway SQLite database.
func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "wo-sync-test")
	if err != nil {
		panic(err)
	}
	os.Setenv("DB_CONNECTION", "sqlite")
	os.Setenv("DATABASE_PATH", filepath.Join(dir, "test.sqlite"))
	log.SetOutput(io.Discard) // db.Init seeds a lot of rows and logs each one
	db.Init()
	code := m.Run()
	db.DB.Close()
	os.RemoveAll(dir)
	os.Exit(code)
}

// resetWorkOrderTables empties the tables the WO sync tests touch.
func resetWorkOrderTables(t *testing.T) {
	t.Helper()
	for _, table := range []string{"work_order_summary", "work_order_details", "work_order_daily_costs", "wo_items", "app_meta"} {
		if _, err := db.Exec("DELETE FROM " + table); err != nil {
			t.Fatalf("clear %s: %v", table, err)
		}
	}
}

func TestApplyFinancialsDailyCostsSumToFinal(t *testing.T) {
	raw := []byte(`{"data": {"id": 7, "min_approval_level": 5, "updated_at": "2026-10-01 10:00:00", "total_cost": 900,
		"repair_list": [{"id": "act-test", "path": "1", "parameter": {"path_name": "TEST > Activity"}, "material": [
			{"price": "100", "volume": 2, "approved_level": 5, "date_approval": "2026-09-10 08:00:00"},
			{"price": "300", "volume": 1, "approved_level": 5, "date_approval": "2026-10-01 10:00:00"}
		]}]}}`)
	s := applyFinancialsFromDetail(workOrderSummary{WOID: "7"}, raw)
	var sum float64
	for _, c := range s.DailyCosts {
		sum += c
	}
	if math.Abs(sum-s.FinalCost) > 0.01 {
		t.Fatalf("daily costs sum %.2f != final cost %.2f (%v)", sum, s.FinalCost, s.DailyCosts)
	}
	if s.DailyCosts["2026-09-10"] != 200 || s.DailyCosts["2026-10-01"] != 300 {
		t.Errorf("unexpected per-day split: %v", s.DailyCosts)
	}
}

func TestTrendBucketClause(t *testing.T) {
	clause, args := trendBucketClause("cost_date", "2026-10-05", "week")
	if clause != "cost_date >= ? AND cost_date < ?" || args[0] != "2026-10-05" || args[1] != "2026-10-12" {
		t.Errorf("week: %q %v", clause, args)
	}
	clause, args = trendBucketClause("cost_date", "2026-10", "month")
	if clause != "cost_date LIKE ?" || args[0] != "2026-10%" {
		t.Errorf("month: %q %v", clause, args)
	}
}

// End to end on SQLite: list sync -> stored (stale) detail -> local rebuild ->
// summary financials, daily ledger, change detection and the trend timeline.
func TestRebuildFromStoredDetailsAndTimeline(t *testing.T) {
	resetWorkOrderTables(t)

	// The WO list says WO 100 was updated on 2026-10-05.
	list := []byte(`{"data": [{"id": 100, "code": "WO-100", "jo_code": "JO-1", "m_ship_name": "Kapal A", "m_vendor_name": "Vendor X",
		"min_approval_level": 5, "total_cost": 500, "created_at": "2025-01-10 08:00:00", "updated_at": "2026-10-05 09:00:00"}]}`)
	if err := ProcessWorkOrderList(list); err != nil {
		t.Fatal(err)
	}
	// A second identical sync must be a no-op diff.
	if err := ProcessWorkOrderList(list); err != nil {
		t.Fatal(err)
	}

	// The stored detail is older (updated 2026-09-20) and has approvals on two days in different months.
	detail := `{"data": {"id": 100, "code": "WO-100", "min_approval_level": 5, "updated_at": "2026-09-20 10:00:00",
		"repair_list": [{"id": "act-test", "path": "1", "parameter": {"path_name": "TEST > Activity"}, "material": [
			{"price": "200", "volume": 1, "approved_level": 5, "date_approval": "2026-08-15 08:00:00"},
			{"price": "300", "volume": 1, "approved_level": 5, "date_approval": "2026-09-20 10:00:00"}
		]}]}}`
	if _, err := db.Exec("INSERT INTO work_order_details (wo_id, raw_json) VALUES (?, ?)", "100", detail); err != nil {
		t.Fatal(err)
	}
	// An error body stored by an old sync must be skipped, not crash the rebuild.
	if _, err := db.Exec("INSERT INTO work_order_details (wo_id, raw_json) VALUES (?, ?)", "101", `{"message":"Unauthenticated."}`); err != nil {
		t.Fatal(err)
	}

	if err := RebuildWorkOrderDerived(); err != nil {
		t.Fatal(err)
	}

	var vendor, updatedSource, detailUpdated, latestDate string
	var final, latest float64
	if err := db.QueryRow(`SELECT vendor_name, updated_source_at, detail_updated_at, latest_date, final_cost, latest_cost
		FROM work_order_summary WHERE wo_id = '100'`).Scan(&vendor, &updatedSource, &detailUpdated, &latestDate, &final, &latest); err != nil {
		t.Fatal(err)
	}
	if vendor != "Vendor X" {
		t.Errorf("list-owned vendor overwritten: %q", vendor)
	}
	if updatedSource != "2026-10-05 09:00:00" || detailUpdated != "2026-09-20 10:00:00" {
		t.Errorf("change detection broken: updated_source_at=%q detail_updated_at=%q", updatedSource, detailUpdated)
	}
	if final != 500 || latest != 300 || latestDate != "2026-09-20" {
		t.Errorf("financials: final=%v latest=%v latest_date=%q", final, latest, latestDate)
	}

	var ledgerRows int
	var ledgerSum float64
	db.QueryRow("SELECT COUNT(*), COALESCE(SUM(approved_cost), 0) FROM work_order_daily_costs WHERE wo_id = '100'").Scan(&ledgerRows, &ledgerSum)
	if ledgerRows != 2 || ledgerSum != 500 {
		t.Errorf("ledger: rows=%d sum=%v, want 2 rows summing to 500", ledgerRows, ledgerSum)
	}

	var version string
	db.QueryRow("SELECT value FROM app_meta WHERE key = 'wo_derived_version'").Scan(&version)
	if version != derivedDataVersion {
		t.Errorf("derived version = %q", version)
	}

	// The stale detail is queued for a re-fetch because the list is newer.
	var queued int
	db.QueryRow(`SELECT COUNT(*) FROM work_order_summary s WHERE ` + detailChangedClause).Scan(&queued)
	if queued != 1 {
		t.Errorf("changed-detail queue = %d, want 1", queued)
	}

	// Monthly trend shows both approval months, not just the latest one.
	rec := httptest.NewRecorder()
	GetWorkOrderTimeline(rec, httptest.NewRequest("GET", "/api/work-orders/timeline?group=month", nil))
	var buckets []struct {
		Period string  `json:"period"`
		Cost   float64 `json:"cost"`
		Count  int     `json:"count"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &buckets); err != nil {
		t.Fatalf("timeline response %q: %v", rec.Body.String(), err)
	}
	got := map[string]float64{}
	for _, b := range buckets {
		got[b.Period] = b.Cost
	}
	if len(buckets) != 2 || got["2026-08"] != 200 || got["2026-09"] != 300 {
		t.Errorf("timeline = %+v, want 2026-08=200 and 2026-09=300", buckets)
	}

	// Clicking the August bucket selects the WO through the ledger even though
	// its latest approval is in September.
	rec = httptest.NewRecorder()
	GetWorkOrderStats(rec, httptest.NewRequest("GET", "/api/work-orders/stats?trend_date=2026-08&group=month", nil))
	var stats map[string]interface{}
	json.Unmarshal(rec.Body.Bytes(), &stats)
	if stats["totalWOs"] != float64(1) {
		t.Errorf("stats for 2026-08 bucket: %v", stats)
	}
}

func TestInternalProjectTypeAndFilter(t *testing.T) {
	resetWorkOrderTables(t)
	list := []byte(`{"data": [
		{"id": 200, "code": "WO-EXT", "jo_code": "DRP26X/YWTS", "m_ship_name": "Kapal A", "m_vendor_name": "V1", "min_approval_level": 5, "total_cost": 1000, "project": "external", "updated_at": "2026-10-05 09:00:00"},
		{"id": 201, "code": "WO-INT", "jo_code": "FSP21FS/YWTS", "m_ship_name": "PERAWATAN SLIPWAY", "m_vendor_name": "V2", "min_approval_level": 5, "total_cost": 300, "project": "external", "_project_scope": "internal", "updated_at": "2026-10-05 09:00:00"}
	]}`)
	if err := ProcessWorkOrderList(list); err != nil {
		t.Fatal(err)
	}
	var pt string
	db.QueryRow("SELECT COALESCE(project_type, '') FROM work_order_summary WHERE wo_id = '201'").Scan(&pt)
	if pt != "internal" {
		t.Fatalf("WO from the internal list stored as %q", pt)
	}

	// A later list without the internal URL (e.g. an older server) must not flip it back.
	older := []byte(`{"data": [{"id": 201, "code": "WO-INT", "jo_code": "FSP21FS/YWTS", "m_ship_name": "PERAWATAN SLIPWAY", "m_vendor_name": "V2", "min_approval_level": 5, "total_cost": 300, "project": "external", "updated_at": "2026-10-06 09:00:00"}]}`)
	if err := ProcessWorkOrderList(older); err != nil {
		t.Fatal(err)
	}
	db.QueryRow("SELECT COALESCE(project_type, '') FROM work_order_summary WHERE wo_id = '201'").Scan(&pt)
	if pt != "internal" {
		t.Errorf("internal flag lost after a list without scope: %q", pt)
	}

	stats := func(query string) map[string]interface{} {
		rec := httptest.NewRecorder()
		GetWorkOrderStats(rec, httptest.NewRequest("GET", "/api/work-orders/stats"+query, nil))
		var out map[string]interface{}
		json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}
	if s := stats(""); s["totalWOs"] != float64(2) || s["sumTotal"] != float64(1300) {
		t.Errorf("all: %v", s)
	}
	if s := stats("?project_type=internal"); s["totalWOs"] != float64(1) || s["sumTotal"] != float64(300) {
		t.Errorf("internal: %v", s)
	}
	if s := stats("?project_type=external"); s["totalWOs"] != float64(1) || s["sumTotal"] != float64(1000) {
		t.Errorf("external: %v", s)
	}

	rec := httptest.NewRecorder()
	GetWorkOrders(rec, httptest.NewRequest("GET", "/api/work-orders?project_type=internal", nil))
	var page struct {
		Data []map[string]interface{} `json:"data"`
	}
	json.Unmarshal(rec.Body.Bytes(), &page)
	if len(page.Data) != 1 || page.Data[0]["project_type"] != "internal" {
		t.Errorf("list filtered by internal: %v", page.Data)
	}
}
