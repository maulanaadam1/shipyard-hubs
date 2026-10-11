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
		sums[it.Status] += it.TotalCost
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
		TotalCost  float64                  `json:"totalCost"`
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
	// Opening a per-item group lists items by their exact label.
	get("/api/wo-items?label=Kuras%20air%20tanki%203P&vendor=Vendor%20X", &list)
	if list.Total != 1 || list.Data[0]["item_id"] != "it-2" {
		t.Errorf("exact label filter: total=%d data=%v", list.Total, list.Data)
	}
	get("/api/wo-items?status=approved", &list)
	if list.Total != 1 || list.TotalCost != 1500000 {
		t.Errorf("approved items: total=%d value=%v", list.Total, list.TotalCost)
	}

	var sum struct {
		Data []map[string]interface{} `json:"data"`
	}
	get("/api/wo-items/summary?group=project_item&sort=total_cost", &sum)
	if len(sum.Data) != 3 || sum.Data[0]["label"] != "Cleaning lumpur tanki 3P" || sum.Data[0]["avg_cost"] != float64(500000) {
		t.Errorf("project_item summary: %v", sum.Data)
	}
	get("/api/wo-items/summary?group=category", &sum)
	if len(sum.Data) != 1 || sum.Data[0]["category"] != "TANKI-TANKI" || sum.Data[0]["total_cost"] != float64(1750000) {
		t.Errorf("category summary: %v", sum.Data)
	}
}

func TestActivityWithoutItemsIsNotACost(t *testing.T) {
	// A newbuilding activity carries the project contract value in "price" and
	// has no work items; it must not count as WO cost (it repeats across WOs).
	raw := []byte(`{"data": {"id": 500, "min_approval_level": 0, "updated_at": "2026-10-05 09:00:00", "total_cost": 0,
		"repair_list": [
			{"id": "act-nb", "path": "1", "parameter": {"path_name": "PEMBANGUNAN 1 UNIT KAPAL BARU"}, "unit": "Ls", "price": "73290000000.00", "material": []},
			{"id": "act-2", "path": "2", "parameter": {"path_name": "LAMBUNG > Plat"}, "price": "999", "material": [
				{"id": "it-9", "path": "2.1", "label": "Ganti plat", "unit": "kg", "volume": 10, "volume_cost_final": 15000, "approved_level": 0, "status_approval": "waiting"}
			]}
		]}}`)
	s := applyFinancialsFromDetail(workOrderSummary{WOID: "500"}, raw)
	if s.PendingCost != 150000 || s.FinalCost != 0 {
		t.Errorf("pending=%v final=%v, want pending 150000 from the work item only", s.PendingCost, s.FinalCost)
	}
	if len(s.Items) != 1 || s.Items[0].Label != "Ganti plat" {
		t.Errorf("items = %+v, want only the work item", s.Items)
	}
}

func TestCostUsesVolumeCostFinalOnly(t *testing.T) {
	raw := []byte(`{"data": {"id": 600, "updated_at": "2026-10-05 09:00:00", "repair_list": [
		{"id": "act", "path": "1", "parameter": {"path_name": "A"}, "price": "31500000000.00", "act_price": "31500000000", "material": [
			{"id": "a", "path": "1.1", "label": "price only", "volume": 2, "price": "1000", "approved_level": 5, "status_approval": "approved", "date_approval": "2026-10-01 08:00:00"},
			{"id": "b", "path": "1.2", "label": "total_price only", "volume": 1, "total_price": 5000, "approved_level": 5, "status_approval": "approved", "date_approval": "2026-10-01 08:00:00"},
			{"id": "c", "path": "1.3", "label": "zero volume", "volume": 0, "volume_cost_final": 7000, "approved_level": 5, "status_approval": "approved", "date_approval": "2026-10-01 08:00:00"},
			{"id": "d", "path": "1.4", "label": "real", "volume": 3, "volume_cost_final": 250, "approved_level": 5, "status_approval": "approved", "date_approval": "2026-10-01 08:00:00"}
		]}]}}`)
	s := applyFinancialsFromDetail(workOrderSummary{WOID: "600"}, raw)
	if s.FinalCost != 750 {
		t.Errorf("FinalCost = %v, want 750 (only volume_cost_final x volume)", s.FinalCost)
	}
}
