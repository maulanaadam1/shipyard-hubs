package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"shipyard/db"
)

// One activity with items in Kg (two spellings), Unit, and punctuation-only units.
const mixedUnitDetail = `{"data": {"id": 950, "code": "WO-950", "min_approval_level": 5, "updated_at": "2026-10-05 09:00:00",
	"repair_list": [{"id": "act-1", "path": "1", "parameter": {"path_name": "FASILITAS > Perawatan"}, "material": [
		{"id": "a", "path": "1.1", "label": "Plat besi", "unit": "Kg", "volume": 1000.5, "volume_cost_final": 10, "approved_level": 5, "status_approval": "approved"},
		{"id": "b", "path": "1.2", "label": "Plat besi tipis", "unit": " kg ", "volume": 200, "volume_cost_final": 10, "approved_level": 5, "status_approval": "approved"},
		{"id": "c", "path": "1.3", "label": "Pompa", "unit": "Unit", "volume": 3, "volume_cost_final": 10, "approved_level": 5, "status_approval": "approved"},
		{"id": "d", "path": "1.4", "label": "Lain-lain", "unit": "'", "volume": 7, "volume_cost_final": 10, "approved_level": 5, "status_approval": "approved"},
		{"id": "e", "path": "1.5", "label": "Lain-lain 2", "unit": ".", "volume": 1, "volume_cost_final": 10, "approved_level": 5, "status_approval": "approved"}
	]}]}}`

func seedMixedUnits(t *testing.T) {
	t.Helper()
	resetWorkOrderTables(t)
	if err := ProcessWorkOrderList([]byte(`{"data": [{"id": 950, "code": "WO-950", "jo_code": "JO-9", "m_ship_name": "Kapal B", "m_vendor_name": "V9", "min_approval_level": 5, "total_cost": 0, "updated_at": "2026-10-05 09:00:00"}]}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO work_order_details (wo_id, raw_json) VALUES (?, ?)", "950", mixedUnitDetail); err != nil {
		t.Fatal(err)
	}
	if err := RebuildWorkOrderDerived(); err != nil {
		t.Fatal(err)
	}
}

func TestVolumeByUnitInSummary(t *testing.T) {
	seedMixedUnits(t)
	get := func(group string) []map[string]interface{} {
		rec := httptest.NewRecorder()
		GetWorkOrderItemSummary(rec, httptest.NewRequest("GET", "/api/wo-items/summary?group="+group, nil))
		var out struct {
			Data []map[string]interface{} `json:"data"`
		}
		json.Unmarshal(rec.Body.Bytes(), &out)
		return out.Data
	}

	rows := get("activity")
	if len(rows) != 1 {
		t.Fatalf("activity rows: %v", rows)
	}
	units, _ := rows[0]["volume_by_unit"].([]interface{})
	got := map[string]float64{}
	order := []string{}
	for _, u := range units {
		m := u.(map[string]interface{})
		got[m["unit"].(string)] = m["volume"].(float64)
		order = append(order, m["unit"].(string))
	}
	if len(got) != 3 || got["Kg"] != 1200.5 || got["Unit"] != 3 || got[noUnitLabel] != 8 {
		t.Errorf("volume per unit = %v (Kg and kg merged, ' and . as %q)", got, noUnitLabel)
	}
	if len(order) != 3 || order[0] != "Kg" || order[1] != noUnitLabel || order[2] != "Unit" {
		t.Errorf("most items first, then by name: %v", order)
	}

	// Per Item is already split by unit: no breakdown, the plain total stays.
	for _, r := range get("item") {
		if _, ok := r["volume_by_unit"]; ok {
			t.Errorf("item view should not carry volume_by_unit: %v", r)
		}
	}
}

func TestVolumeByUnitInExport(t *testing.T) {
	seedMixedUnits(t)
	f, rows := exportSheet(t, "view=activity")
	defer f.Close()
	if rows[0][4] != "Volume per Satuan" {
		t.Fatalf("header: %v", rows[0])
	}
	// Kg and "tanpa satuan" have 2 items each (then by name), Unit 1.
	if want := "1.200,5 Kg; 8 " + noUnitLabel + "; 3 Unit"; rows[1][4] != want {
		t.Errorf("volume per unit cell = %q, want %q", rows[1][4], want)
	}
}

func TestUnitHelpers(t *testing.T) {
	for in, want := range map[string]string{"Kg": "Kg", " m3 ": "m3", "'": noUnitLabel, ".": noUnitLabel, "": noUnitLabel, "-": noUnitLabel} {
		if got := unitLabel(in); got != want {
			t.Errorf("unitLabel(%q) = %q, want %q", in, got, want)
		}
	}
	for in, want := range map[float64]string{116766.78: "116.766,78", 2524: "2.524", 0.5: "0,5", 1000000: "1.000.000", -1234.5: "-1.234,5"} {
		if got := formatIDNumber(in); got != want {
			t.Errorf("formatIDNumber(%v) = %q, want %q", in, got, want)
		}
	}
}
