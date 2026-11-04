package handlers

import (
	"encoding/json"
	"math"
	"net/http/httptest"
	"net/url"
	"testing"

	"shipyard/db"
)

type financeResponse struct {
	LatestDate string              `json:"latest_date"`
	Range      map[string]string   `json:"range"`
	Options    map[string][]string `json:"options"`
	Totals     map[string]float64  `json:"totals"`
	Trend      []financeTrendPoint `json:"trend"`
	Vendors    []financeAmount     `json:"vendors"`
	Ships      []financeAmount     `json:"ships"`
	Rows       []financeRow        `json:"rows"`
	Total      int                 `json:"total"`
}

func getFinance(t *testing.T, query string) financeResponse {
	t.Helper()
	rec := httptest.NewRecorder()
	GetFinanceSummary(rec, httptest.NewRequest("GET", "/api/finance/summary?"+query, nil))
	if rec.Code != 200 {
		t.Fatalf("%s: status %d: %s", query, rec.Code, rec.Body.String())
	}
	var res financeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	return res
}

// seedFinance: WO 1 (vendor A, ship X) approved on three days, WO 2 (no vendor,
// ship Y) on one day, WO 3 with no approvals at all.
func seedFinance(t *testing.T) {
	t.Helper()
	resetWorkOrderTables(t)
	for _, s := range []struct{ id, code, jo, ship, vendor, status string }{
		{"1", "WO-1", "JO-1", "X", "Vendor A", "Approval Level 5"},
		{"2", "WO-2", "JO-2", "Y", "", "Approval Level 2"},
		{"3", "WO-3", "JO-2", "Y", "Vendor A", "Waiting"},
	} {
		if _, err := db.Exec(`INSERT INTO work_order_summary (wo_id, wo_code, jo_code, project_name, ship_name, vendor_name, derived_status)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, s.id, s.code, s.jo, s.jo+" - "+s.ship, s.ship, s.vendor, s.status); err != nil {
			t.Fatal(err)
		}
	}
	for _, c := range []struct {
		wo, date string
		cost     float64
	}{
		{"1", "2026-09-01", 100}, // a Tuesday, long before the others
		{"1", "2026-10-24", 200}, // Saturday
		{"1", "2026-10-30", 300}, // Friday, same Saturday-week as the 24th
		{"2", "2026-10-25", 50},
	} {
		if _, err := db.Exec(`INSERT INTO work_order_daily_costs (wo_id, cost_date, approved_cost) VALUES (?, ?, ?)`, c.wo, c.date, c.cost); err != nil {
			t.Fatal(err)
		}
	}
}

func TestFinanceSummaryFromLedger(t *testing.T) {
	seedFinance(t)

	all := getFinance(t, "preset=all&group=day")
	if all.Totals["cost"] != 650 || all.Total != 4 || all.Totals["wo_count"] != 2 || all.Totals["jo_count"] != 2 {
		t.Fatalf("totals = %v, rows %d", all.Totals, all.Total)
	}
	if all.LatestDate != "2026-10-30" {
		t.Errorf("latest date = %q", all.LatestDate)
	}
	// Default sort: newest first; previous cost is the WO's approvals before that day.
	if r := all.Rows[0]; r.Date != "2026-10-30" || r.Cost != 300 || r.PreviousCost != 300 {
		t.Errorf("first row = %+v", r)
	}
	if v := all.Vendors; len(v) != 2 || v[0].Label != "Vendor A" || v[0].Cost != 600 || v[1].Label != noVendorLabel {
		t.Errorf("vendors = %+v", v)
	}
	if s := all.Ships; len(s) != 2 || s[0].Label != "X" || math.Abs(s[0].Percentage-600.0/650*100) > 0.001 {
		t.Errorf("ships = %+v", s)
	}
	if got := all.Options["statuses"]; len(got) != 2 {
		t.Errorf("status options = %v (WO-3 has no approvals and is left out)", got)
	}

	// 1 week back from the newest approval: 24 Oct .. 30 Oct.
	week := getFinance(t, "preset=1week&group=week")
	if week.Range["start"] != "2026-10-24" || week.Totals["cost"] != 550 {
		t.Errorf("1week: range %v, cost %v", week.Range, week.Totals["cost"])
	}
	if len(week.Trend) != 1 || week.Trend[0].Period != "2026-10-24" || week.Trend[0].Cost != 550 {
		t.Errorf("Saturday weeks: trend = %+v", week.Trend)
	}

	picked := getFinance(t, "preset=all&group=month&pick_period=2026-10-01&pick_vendor=Vendor+A")
	if picked.Totals["cost"] != 500 || picked.Total != 2 {
		t.Errorf("cross-filtered: %v, %d rows", picked.Totals, picked.Total)
	}
	noVendor := getFinance(t, "preset=all&vendor="+url.QueryEscape(noVendorLabel))
	if noVendor.Totals["cost"] != 50 {
		t.Errorf("no-vendor filter: %v", noVendor.Totals)
	}
	byCost := getFinance(t, "preset=all&sort=finalCost&dir=asc&limit=1&page=2")
	if len(byCost.Rows) != 1 || byCost.Rows[0].Cost != 100 {
		t.Errorf("sorted page 2 = %+v", byCost.Rows)
	}
}

func TestFinanceBucket(t *testing.T) {
	for _, c := range []struct{ date, group, want string }{
		{"2026-10-24", "week", "2026-10-24"}, // Saturday
		{"2026-10-30", "week", "2026-10-24"}, // Friday
		{"2026-10-31 08:00:00", "week", "2026-10-31"},
		{"2026-10-30", "month", "2026-10-01"},
		{"2026-10-30", "day", "2026-10-30"},
		{"", "day", ""},
	} {
		if got := financeBucket(c.date, c.group); got != c.want {
			t.Errorf("financeBucket(%q, %s) = %q, want %q", c.date, c.group, got, c.want)
		}
	}
}
