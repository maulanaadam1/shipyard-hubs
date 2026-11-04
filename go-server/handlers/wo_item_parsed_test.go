package handlers

import (
	"testing"

	"shipyard/db"
	"shipyard/itemparse"
)

// Every stored work item gets its parsed description in the same write, and a
// rebuild replaces it (no stale rows, current parser version).
func TestParsedItemsStoredWithItems(t *testing.T) {
	resetWorkOrderTables(t)
	if err := ProcessWorkOrderList([]byte(`{"data": [{"id": 960, "code": "WO-960", "jo_code": "JO-1", "m_ship_name": "Kapal A", "m_vendor_name": "V", "min_approval_level": 5, "total_cost": 0, "updated_at": "2026-10-05 09:00:00"}]}`)); err != nil {
		t.Fatal(err)
	}
	detail := `{"data": {"id": 960, "min_approval_level": 5, "updated_at": "2026-10-05 09:00:00",
		"repair_list": [{"id": "act-1", "path": "1", "parameter": {"path_name": "SEA CHEST & SEA VALVE > Sea Valve"}, "material": [
			{"id": "a", "path": "1.1", "label": "Ganti baru packing , bahan karet dia. 2\" x 3 mm, jumlah 4 unit (supply dock)", "unit": "Unit", "volume": 4, "volume_cost_final": 4000, "approved_level": 5, "status_approval": "approved"},
			{"id": "b", "path": "1.2", "label": "Replating bilge kanan , Fr. 0 -1/2 <br> Uk. 2000 mm x 820 mm x 12 mm x 1 lbr = 154.49 Kg, (supply dock)", "unit": "Kg", "volume": 154.49, "volume_cost_final": 3500, "approved_level": 5, "status_approval": "approved"},
			{"id": "c", "path": "1.3", "label": "Ganti baru pipa seamless sch. 40, Dia. 2\", 300 mm (supply dock) Elbow, 1 unit (supply dock) Flange, 2 unit (supply dock)", "unit": "Set", "volume": 1, "volume_cost_final": 50000, "approved_level": 5, "status_approval": "approved"},
			{"id": "d", "path": "1.4", "label": "TANGGAL 5 JULI 2024, 1 kali", "unit": "Titik", "volume": 1, "volume_cost_final": 1000, "approved_level": 5, "status_approval": "approved"}
		]}]}}`
	if _, err := db.Exec("INSERT INTO work_order_details (wo_id, raw_json) VALUES (?, ?)", "960", detail); err != nil {
		t.Fatal(err)
	}
	if err := RebuildWorkOrderDerived(); err != nil {
		t.Fatal(err)
	}

	var items, parsed int
	db.QueryRow("SELECT COUNT(*) FROM wo_items WHERE wo_id = '960'").Scan(&items)
	db.QueryRow("SELECT COUNT(*) FROM wo_item_parsed WHERE wo_id = '960'").Scan(&parsed)
	if items != 4 || parsed != 4 {
		t.Fatalf("wo_items %d, wo_item_parsed %d; want 4 and 4", items, parsed)
	}

	type row struct {
		rules, work, size, version, frame, side string
		recognized                              bool
		pipeMM, weight                          *float64
		elbows, flanges                         *int
	}
	get := func(id string) row {
		var r row
		if err := db.QueryRow(`SELECT COALESCE(rules, ''), COALESCE(work_type, ''), COALESCE(size, ''), COALESCE(parser_version, ''),
			COALESCE(frame, ''), COALESCE(side, ''), recognized, pipe_mm, weight_kg, elbows, flanges
			FROM wo_item_parsed WHERE wo_id = '960' AND item_id = ?`, id).
			Scan(&r.rules, &r.work, &r.size, &r.version, &r.frame, &r.side, &r.recognized, &r.pipeMM, &r.weight, &r.elbows, &r.flanges); err != nil {
			t.Fatalf("item %s: %v", id, err)
		}
		return r
	}

	if r := get("a"); r.rules != "umum" || r.work != "Ganti baru packing karet" || r.size != `Ø 2" x 3 mm` || !r.recognized || r.version != itemparse.Version {
		t.Errorf("packing: %+v", r)
	}
	if r := get("b"); r.rules != "lambung" || r.work != "Replating bilga" || r.size != "plat 12 mm" || r.frame != "0-1/2" || r.side != "kanan" ||
		r.weight == nil || *r.weight != 154.49 {
		t.Errorf("hull plate: %+v", r)
	}
	if r := get("c"); r.work != "Ganti baru pipa seamless" || r.pipeMM == nil || *r.pipeMM != 300 ||
		r.elbows == nil || *r.elbows != 1 || r.flanges == nil || *r.flanges != 2 {
		t.Errorf("pipe: %+v", r)
	}
	if r := get("d"); r.recognized || r.pipeMM != nil || r.weight != nil {
		t.Errorf("unrecognized item: %+v", r)
	}

	// A rebuild rewrites the rows rather than adding to them.
	if err := RebuildWorkOrderDerived(); err != nil {
		t.Fatal(err)
	}
	db.QueryRow("SELECT COUNT(*) FROM wo_item_parsed WHERE wo_id = '960'").Scan(&parsed)
	if parsed != 4 {
		t.Errorf("after a second rebuild: %d parsed rows", parsed)
	}
}
