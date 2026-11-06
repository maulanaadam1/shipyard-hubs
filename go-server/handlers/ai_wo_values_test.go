package handlers

import (
	"encoding/json"
	"strings"
	"testing"

	"shipyard/db"
)

// SIAGA's WO header total stays at the value the WO was created with; added
// work makes the items worth more. The tools report item values as the WO
// value and the header separately, so approved can exceed the header
// without looking like a contradiction.
func TestAIWorkOrderValues(t *testing.T) {
	resetWorkOrderTables(t)
	for _, row := range []string{
		// header 8.9M, approved 35.4M over two approval dates
		`('901', 'WO-901', 'Vendor A', 'Approval Level 5', '2026-10-30', 35400000, 9500000, 25900000, 0, 0, 8900000)`,
		// header equals items: 10M approved + 2M pending + 1M rejected
		`('902', 'WO-902', 'Vendor B', 'Approval Level 3', '2026-10-20', 10000000, 10000000, 0, 2000000, 1000000, 13000000)`,
	} {
		if _, err := db.Exec(`INSERT INTO work_order_summary (wo_id, wo_code, vendor_name, derived_status, latest_date,
			final_cost, latest_cost, previous_cost, pending_cost, rejected_cost, total_cost) VALUES ` + row); err != nil {
			t.Fatal(err)
		}
		// Text columns as the sync writes them (never NULL).
		if _, err := db.Exec(`UPDATE work_order_summary SET jo_code = 'JO-9', project_name = 'JO-9 - KAPAL', ship_name = 'KAPAL',
			status_approval = '' WHERE jo_code IS NULL`); err != nil {
			t.Fatal(err)
		}
	}
	InvalidateWorkOrderCache()

	res, err := runSearchWorkOrders(aiRequest("ai-admin"), json.RawMessage(`{"date_from": "2026-10-01", "date_to": "2026-10-31"}`))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(res)
	var out struct {
		Summary map[string]interface{} `json:"summary"`
		Notes   []string               `json:"notes"`
	}
	json.Unmarshal(b, &out)
	s := out.Summary
	want := map[string]float64{
		"approved_value": 45400000, "approved_at_latest_approval": 19500000, "approved_before_latest_approval": 25900000,
		"pending_value": 2000000, "rejected_value": 1000000, "items_value": 48400000, "siaga_header_value": 21900000, "wo_count": 2,
	}
	for k, v := range want {
		if s[k] != v {
			t.Errorf("summary %s = %v, want %v", k, s[k], v)
		}
	}
	for _, old := range []string{"total_value", "value_previous_approvals", "value_latest_approval"} {
		if _, has := s[old]; has {
			t.Errorf("ambiguous field %s still returned", old)
		}
	}
	notes := strings.Join(out.Notes, " ")
	if !strings.Contains(notes, "siaga_header_value") || !strings.Contains(notes, "billing_summary") {
		t.Errorf("notes: %s", notes)
	}

	wo, err := runGetWorkOrder(aiRequest("ai-admin"), json.RawMessage(`{"wo_code": "WO-901"}`))
	if err != nil {
		t.Fatal(err)
	}
	w := wo.(map[string]interface{})
	if w["approved_value"] != float64(35400000) || w["items_value"] != float64(35400000) || w["siaga_header_value"] != float64(8900000) || w["total_value"] != nil {
		t.Errorf("get_work_order values: %v", w)
	}
}
