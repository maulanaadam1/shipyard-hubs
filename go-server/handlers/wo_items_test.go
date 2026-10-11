package handlers

import (
	"encoding/json"
	"math"
	"net/http/httptest"
	"testing"

	"shipyard/db"
)

// A detail shaped like SIAGA's: activity -> group -> leaf items.
const nestedDetail = `{"data": {"id": 400, "code": "WO-400", "min_approval_level": 2, "updated_at": "2026-10-05 09:00:00",
	"repair_list": [{
		"id": "act-1", "path": "4.2", "parameter": {"path_name": "TANKI-TANKI > Cleaning > Buang lumpur"},
		"material": [
			{"id": "grp-1", "label": "grup", "group_flag": true, "volume": 0, "volume_cost_final": 0, "material": [
				{"id": "it-1", "path": "4.2.1.1", "label": "Cleaning lumpur tanki 3P", "unit": "m3", "volume": 3, "volume_cost_final": 500000, "approved_level": 5, "status_approval": "approved", "date_approval": "2026-09-10 08:00:00"},
				{"id": "it-2", "path": "4.2.1.2", "label": "Kuras air tanki 3P", "unit": "m3", "volume": 2, "volume_cost_final": 100000, "approved_level": 0, "status_approval": "waiting"}
			]},
			{"id": "it-3", "path": "4.2.2", "label": "Buang lumpur ekstra", "unit": "m3", "volume": 1, "volume_cost_final": 50000, "approved_level": 0, "status_approval": "rejected"}
		]
	}]}}`

func TestFlattenItemsMatchFinancials(t *testing.T) {
	s := applyFinancialsFromDetail(workOrderSummary{WOID: "400"}, []byte(nestedDetail))
	if len(s.Items) != 3 {
		t.Fatalf("want 3 leaf items (empty group skipped), got %d: %+v", len(s.Items), s.Items)
	}
	sums := map[string]float64{}
	for _, it := range s.Items {
		sums[it.Status] += it.TotalPrice
		if it.Category != "TANKI-TANKI" || it.ActivityName != "TANKI-TANKI > Cleaning > Buang lumpur" || it.ActivityPath != "4.2" {
			t.Errorf("activity context missing on %+v", it)
		}
	}
	if math.Abs(sums["approved"]-s.FinalCost) > 0.01 || math.Abs(sums["pending"]-s.PendingCost) > 0.01 || math.Abs(sums["rejected"]-s.RejectedCost) > 0.01 {
		t.Errorf("item sums %v don't match summary final=%v pending=%v rejected=%v", sums, s.FinalCost, s.PendingCost, s.RejectedCost)
	}
	if s.Items[0].ApprovalDate != "2026-09-10" || s.Items[1].ApprovalDate != "" {
		t.Errorf("approval dates: %q / %q", s.Items[0].ApprovalDate, s.Items[1].ApprovalDate)
	}
}

func TestWorkOrderItemsAPI(t *testing.T) {
	resetWorkOrderTables(t)
	if err := ProcessWorkOrderList([]byte(`{"data": [{"id": 400, "code": "WO-400", "jo_code": "DRP26X/YWTS", "m_ship_name": "Kapal A", "m_vendor_name": "Vendor X", "min_approval_level": 2, "total_cost": 1750000, "updated_at": "2026-10-05 09:00:00"}]}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO work_order_details (wo_id, raw_json) VALUES (?, ?)", "400", nestedDetail); err != nil {
		t.Fatal(err)
	}
	if err := RebuildWorkOrderDerived(); err != nil {
		t.Fatal(err)
	}
	var n int
	db.QueryRow("SELECT COUNT(*) FROM wo_items WHERE wo_id = '400'").Scan(&n)
	if n != 3 {
		t.Fatalf("wo_items rows = %d, want 3", n)
	}

	get := func(url string, out interface{}) {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("GET", url, nil)
		switch {
		case len(url) >= len("/api/wo-items/summary") && url[:len("/api/wo-items/summary")] == "/api/wo-items/summary":
			GetWorkOrderItemSummary(rec, req)
		default:
			GetWorkOrderItems(rec, req)
		}
		if rec.Code != 200 {
			t.Fatalf("%s -> %d %s", url, rec.Code, rec.Body.String())
		}
		json.Unmarshal(rec.Body.Bytes(), out)
	}

	var list struct {
		Data       []map[string]interface{} `json:"data"`
		Total      int                      `json:"total"`
		TotalValue float64                  `json:"totalValue"`
	}
	// Search matches the item label or its activity name.
	get("/api/wo-items?search=lumpur", &list)
	if list.Total != 3 {
		t.Errorf("search 'lumpur' (activity name) total=%d, want 3", list.Total)
	}
	get("/api/wo-items?search=kuras", &list)
	if list.Total != 1 || list.Data[0]["label"] != "Kuras air tanki 3P" || list.Data[0]["project_name"] != "DRP26X/YWTS - KAPAL A" || list.Data[0]["vendor_name"] != "Vendor X" {
		t.Errorf("search 'kuras': total=%d first=%v", list.Total, list.Data)
	}
	get("/api/wo-items?status=approved", &list)
	if list.Total != 1 || list.TotalValue != 1500000 {
		t.Errorf("approved items: total=%d value=%v", list.Total, list.TotalValue)
	}

	var sum struct {
		Data []map[string]interface{} `json:"data"`
	}
	get("/api/wo-items/summary?group=project_item&sort=total_value", &sum)
	if len(sum.Data) != 3 || sum.Data[0]["label"] != "Cleaning lumpur tanki 3P" || sum.Data[0]["avg_price"] != float64(500000) {
		t.Errorf("project_item summary: %v", sum.Data)
	}
	get("/api/wo-items/summary?group=category", &sum)
	if len(sum.Data) != 1 || sum.Data[0]["category"] != "TANKI-TANKI" || sum.Data[0]["total_value"] != float64(1750000) {
		t.Errorf("category summary: %v", sum.Data)
	}
}
