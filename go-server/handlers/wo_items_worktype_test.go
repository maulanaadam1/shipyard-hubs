package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"shipyard/db"
)

// Two packing items of different sizes and one description the parser
// doesn't recognize.
const workTypeDetail = `{"data": {"id": 410, "code": "WO-410", "min_approval_level": 5, "updated_at": "2026-10-05 09:00:00",
	"repair_list": [{"id": "act-1", "path": "1", "parameter": {"path_name": "PERPIPAAN > Packing"}, "material": [
		{"id": "it-1", "path": "1.1", "label": "Ganti baru packing , bahan karet dia. 2\" x 3 mm, jumlah 4 unit (supply dock)", "unit": "Unit", "volume": 4, "volume_cost_final": 4000, "approved_level": 5, "status_approval": "approved", "date_approval": "2026-09-10 08:00:00"},
		{"id": "it-2", "path": "1.2", "label": "Ganti baru packing , bahan karet dia. 3\" x 3 mm, jumlah 2 unit (supply dock)", "unit": "Unit", "volume": 2, "volume_cost_final": 5000, "approved_level": 5, "status_approval": "approved", "date_approval": "2026-09-11 08:00:00"},
		{"id": "it-3", "path": "1.3", "label": "TANGGAL 5 JULI 2024, 1 kali", "unit": "Ls", "volume": 1, "volume_cost_final": 90000, "approved_level": 5, "status_approval": "approved", "date_approval": "2026-09-12 08:00:00"}
	]}]}}`

func TestWorkOrderItemsWorkType(t *testing.T) {
	resetWorkOrderTables(t)
	if err := ProcessWorkOrderList([]byte(`{"data": [{"id": 410, "code": "WO-410", "m_ship_name": "Kapal B", "min_approval_level": 5, "updated_at": "2026-10-05 09:00:00"}]}`)); err != nil {
		t.Fatal(err)
	}
	db.Exec("INSERT INTO work_order_details (wo_id, raw_json) VALUES (?, ?)", "410", workTypeDetail)
	if err := RebuildWorkOrderDerived(); err != nil {
		t.Fatal(err)
	}

	get := func(path string, q url.Values, out interface{}) {
		t.Helper()
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("GET", path+"?"+q.Encode(), nil)
		if strings.HasSuffix(path, "/summary") {
			GetWorkOrderItemSummary(rec, req)
		} else {
			GetWorkOrderItems(rec, req)
		}
		if rec.Code != 200 {
			t.Fatalf("%s %v -> %d %s", path, q, rec.Code, rec.Body.String())
		}
		json.Unmarshal(rec.Body.Bytes(), out)
	}
	type list struct {
		Data  []woItemRow `json:"data"`
		Total int         `json:"total"`
	}

	// The list carries the cleaned-up description of each item.
	var all list
	get("/api/wo-items", url.Values{"sort": {"label"}, "dir": {"asc"}}, &all)
	if all.Total != 3 {
		t.Fatalf("items = %d", all.Total)
	}
	byID := map[string]woItemRow{}
	for _, it := range all.Data {
		byID[it.ItemID] = it
	}
	if it := byID["it-1"]; !it.Recognized || it.WorkType != "Ganti baru packing karet" || it.Size == "" {
		t.Errorf("it-1 = %+v", it)
	}
	if it := byID["it-3"]; it.Recognized || it.WorkType != "" {
		t.Errorf("unrecognized it-3 = %+v", it)
	}

	var packing, unknown list
	get("/api/wo-items", url.Values{"work_type": {"Ganti baru packing karet"}}, &packing)
	get("/api/wo-items", url.Values{"parse": {"unrecognized"}}, &unknown)
	if packing.Total != 2 || unknown.Total != 1 || unknown.Data[0].ItemID != "it-3" {
		t.Errorf("work_type filter %d, unrecognized filter %d", packing.Total, unknown.Total)
	}

	// Per Jenis Pekerjaan: one packing group (volume per unit) and the
	// unrecognized bucket ('').
	var groups struct {
		Data  []map[string]interface{} `json:"data"`
		Total int                      `json:"total"`
	}
	get("/api/wo-items/summary", url.Values{"group": {"work_type"}, "sort": {"item_count"}}, &groups)
	if groups.Total != 2 || groups.Data[0]["work_type"] != "Ganti baru packing karet" || groups.Data[0]["item_count"].(float64) != 2 {
		t.Fatalf("work_type groups = %+v", groups)
	}
	if units, _ := groups.Data[0]["volume_by_unit"].([]interface{}); len(units) != 1 || units[0].(map[string]interface{})["volume"].(float64) != 6 {
		t.Errorf("volume by unit = %v", groups.Data[0]["volume_by_unit"])
	}
	if groups.Data[1]["work_type"] != "" {
		t.Errorf("unrecognized bucket = %v", groups.Data[1])
	}

	// Per Jenis Pekerjaan & Ukuran splits the sizes; a size filter (even an
	// empty one) narrows the items of one group.
	get("/api/wo-items/summary", url.Values{"group": {"work_type_size"}}, &groups)
	if groups.Total != 3 {
		t.Errorf("work_type_size groups = %d", groups.Total)
	}
	size := byID["it-1"].Size
	var one, noSize list
	get("/api/wo-items", url.Values{"work_type": {"Ganti baru packing karet"}, "size": {size}}, &one)
	get("/api/wo-items", url.Values{"parse": {"unrecognized"}, "size": {""}}, &noSize)
	if one.Total != 1 || one.Data[0].ItemID != "it-1" || noSize.Total != 1 {
		t.Errorf("size filter: %d (%q), empty size: %d", one.Total, size, noSize.Total)
	}
}
