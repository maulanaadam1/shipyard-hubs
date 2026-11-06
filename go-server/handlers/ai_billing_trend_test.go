package handlers

import (
	"encoding/json"
	"testing"

	"shipyard/db"
)

func trendRows(t *testing.T, v []interface{}) []map[string]interface{} {
	t.Helper()
	b, _ := json.Marshal(v)
	var out []map[string]interface{}
	json.Unmarshal(b, &out)
	return out
}

// Weeks that only partly fall in the period are kept, clipped and marked,
// and weeks without approvals show 0, so the chart adds up to the period.
func TestBillingTrendCoversWholePeriod(t *testing.T) {
	raw := []interface{}{
		map[string]interface{}{"period": "2026-09-26", "cost": 38890094.0}, // only Oct 1-2 are in the period
		map[string]interface{}{"period": "2026-10-03", "cost": 359156584.0},
		map[string]interface{}{"period": "2026-10-17", "cost": 132019247.0},
	}
	rows := trendRows(t, billingTrend(raw, "2026-10-01", "2026-10-31", "week"))
	want := []struct {
		label, from, to string
		partial         bool
		cost            float64
	}{
		{"1–2 Okt (sebagian)", "2026-10-01", "2026-10-02", true, 38890094},
		{"3–9 Okt", "2026-10-03", "2026-10-09", false, 359156584},
		{"10–16 Okt", "2026-10-10", "2026-10-16", false, 0},
		{"17–23 Okt", "2026-10-17", "2026-10-23", false, 132019247},
		{"24–30 Okt", "2026-10-24", "2026-10-30", false, 0},
		{"31 Okt (sebagian)", "2026-10-31", "2026-10-31", true, 0},
	}
	if len(rows) != len(want) {
		t.Fatalf("got %d weeks: %v", len(rows), rows)
	}
	var sum float64
	for i, w := range want {
		r := rows[i]
		if r["label"] != w.label || r["from"] != w.from || r["to"] != w.to || r["partial"] != w.partial || r["cost"] != w.cost {
			t.Errorf("week %d: got %v, want %+v", i, r, w)
		}
		sum += r["cost"].(float64)
	}
	if sum != 38890094+359156584+132019247 {
		t.Errorf("weeks add up to %v", sum)
	}

	months := trendRows(t, billingTrend([]interface{}{map[string]interface{}{"period": "2026-10-01", "cost": 5.0}}, "2026-09-15", "2026-11-10", "month"))
	if len(months) != 3 || months[0]["label"] != "15–30 Sep (sebagian)" || months[1]["label"] != "Okt 2026" || months[1]["cost"] != 5.0 ||
		months[2]["label"] != "1–10 Nov (sebagian)" {
		t.Errorf("months: %v", months)
	}
	days := trendRows(t, billingTrend(nil, "2026-10-30", "2026-11-01", "day"))
	if len(days) != 3 || days[2]["label"] != "1 Nov" || days[0]["partial"] != false {
		t.Errorf("days: %v", days)
	}
	// No closed range: the trend passes through, labelled.
	open := trendRows(t, billingTrend([]interface{}{map[string]interface{}{"period": "2026-10-03", "cost": 1.0}}, "", "", "week"))
	if len(open) != 1 || open[0]["label"] != "3–9 Okt" {
		t.Errorf("open range: %v", open)
	}
}

// Through the tool: an approval on the 1st of the month is in the trend.
func TestBillingSummaryKeepsEdgeWeeks(t *testing.T) {
	resetWorkOrderTables(t)
	db.Exec(`INSERT INTO work_order_summary (wo_id, wo_code, jo_code, project_name, vendor_name, ship_name, derived_status, final_cost)
		VALUES ('950', 'WO-950', 'JO-1', 'JO-1 - KAPAL', 'Vendor A', 'KAPAL', 'Approval Level 5', 300)`)
	db.Exec(`INSERT INTO work_order_daily_costs (wo_id, cost_date, approved_cost) VALUES ('950', '2026-10-01', 100), ('950', '2026-10-05', 200)`)
	res, err := runBillingSummary(aiRequest("ai-admin"), json.RawMessage(`{"date_from": "2026-10-01", "date_to": "2026-10-31", "group": "week"}`))
	if err != nil {
		t.Fatal(err)
	}
	m := res.(map[string]interface{})
	rows := trendRows(t, m["trend"].([]interface{}))
	if len(rows) != 6 || rows[0]["cost"] != 100.0 || rows[0]["partial"] != true || rows[1]["cost"] != 200.0 || m["trend_note"] == "" {
		t.Errorf("billing trend: %v", rows)
	}
}
