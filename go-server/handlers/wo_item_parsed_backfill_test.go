package handlers

import (
	"fmt"
	"testing"

	"shipyard/db"
	"shipyard/itemparse"
)

// detailWithItems is a SIAGA-shaped detail with n approved work items.
func detailWithItems(woID string, n int) string {
	items := ""
	for i := 0; i < n; i++ {
		if i > 0 {
			items += ","
		}
		items += fmt.Sprintf(`{"id": "it-%d", "path": "1.%d", "label": "Ganti baru klem %d\", 4 pcs", "unit": "Pcs", "volume": 1,
			"volume_cost_final": 1000, "approved_level": 5, "status_approval": "approved"}`, i, i, i+1)
	}
	return fmt.Sprintf(`{"data": {"id": %s, "min_approval_level": 5, "updated_at": "2026-10-05 09:00:00",
		"repair_list": [{"id": "act-1", "path": "1", "parameter": {"path_name": "TEST > A"}, "material": [%s]}]}}`, woID, items)
}

func derivedVersion() string {
	var v string
	db.QueryRow("SELECT COALESCE(value, '') FROM app_meta WHERE key = 'wo_derived_version'").Scan(&v)
	return v
}

// A stored version whose data already matches only gets the new marker: no
// full rebuild (which rewrites four tables and once took production down).
func TestEquivalentDerivedVersionSkipsRebuild(t *testing.T) {
	resetWorkOrderTables(t)
	if err := ProcessWorkOrderList([]byte(`{"data": [{"id": 970, "code": "WO-970", "min_approval_level": 5, "updated_at": "2026-10-05 09:00:00"}]}`)); err != nil {
		t.Fatal(err)
	}
	db.Exec("INSERT INTO work_order_details (wo_id, raw_json) VALUES (?, ?)", "970", detailWithItems("970", 3))
	db.Exec("INSERT INTO app_meta (key, value) VALUES ('wo_derived_version', '2026-10-12.status-from-items')")

	maybeRebuildDerived()

	if v := derivedVersion(); v != derivedDataVersion {
		t.Fatalf("marker = %q, want %q", v, derivedDataVersion)
	}
	var items int
	db.QueryRow("SELECT COUNT(*) FROM wo_items WHERE wo_id = '970'").Scan(&items)
	if items != 0 {
		t.Errorf("a rebuild ran (%d items written) for an equivalent version", items)
	}

	// An unknown older version still rebuilds, in small batches.
	t.Setenv("WO_REBUILD_BATCH", "1")
	db.Exec("DELETE FROM app_meta WHERE key = 'wo_derived_version'")
	db.Exec("INSERT INTO app_meta (key, value) VALUES ('wo_derived_version', '2026-01-01.something-old')")
	if err := ProcessWorkOrderList([]byte(`{"data": [{"id": 971, "code": "WO-971", "min_approval_level": 5, "updated_at": "2026-10-05 09:00:00"}]}`)); err != nil {
		t.Fatal(err)
	}
	db.Exec("INSERT INTO work_order_details (wo_id, raw_json) VALUES (?, ?)", "971", detailWithItems("971", 2))
	maybeRebuildDerived()
	db.QueryRow("SELECT COUNT(*) FROM wo_items WHERE wo_id IN ('970', '971')").Scan(&items)
	if items != 5 || derivedVersion() != derivedDataVersion {
		t.Errorf("batched rebuild: %d items (want 5), marker %q", items, derivedVersion())
	}
}

func TestBackfillParsedItems(t *testing.T) {
	resetWorkOrderTables(t)
	t.Setenv("WO_PARSE_BATCH", "2") // several batches for 5 items
	t.Setenv("WO_PARSE_PAUSE_MS", "1")
	labels := []string{
		`Ganti baru packing , bahan karet dia. 2" x 3 mm, jumlah 4 unit (supply dock)`,
		`Replating bilge kanan , Fr. 0 -1/2 <br> Uk. 2000 mm x 820 mm x 12 mm x 1 lbr = 154.49 Kg`,
		`Dilaksanakan press test gate valve uk. 6"- 10k, 2 unit (material lama)`,
		`Ganti baru mur dan baut steel uk. 5/8" x 2", 16 pcs (supply dock)`,
		`TANGGAL 5 JULI 2024, 1 kali`,
	}
	for i, l := range labels {
		if _, err := db.Exec("INSERT INTO wo_items (wo_id, item_id, label) VALUES (?, ?, ?)", "980", fmt.Sprintf("it-%d", i), l); err != nil {
			t.Fatal(err)
		}
	}
	// it-0: parsed by an older parser; it-1: already current (left alone, even
	// though its work type is made up here); the rest: no parsed row.
	db.Exec(`INSERT INTO wo_item_parsed (wo_id, item_id, work_type, parser_version) VALUES ('980', 'it-0', 'old', '2020-01-01.0')`)
	db.Exec(`INSERT INTO wo_item_parsed (wo_id, item_id, work_type, parser_version) VALUES ('980', 'it-1', 'kept', ?)`, itemparse.Version)

	n, err := backfillParsedItems()
	if err != nil {
		t.Fatal(err)
	}
	if n != 4 {
		t.Errorf("rows written = %d, want 4 (all but the current one)", n)
	}
	work := func(id string) (string, string) {
		var w, v string
		db.QueryRow("SELECT COALESCE(work_type, ''), COALESCE(parser_version, '') FROM wo_item_parsed WHERE wo_id = '980' AND item_id = ?", id).Scan(&w, &v)
		return w, v
	}
	if w, v := work("it-0"); w != "Ganti baru packing karet" || v != itemparse.Version {
		t.Errorf("older version not re-parsed: %q %q", w, v)
	}
	if w, _ := work("it-1"); w != "kept" {
		t.Errorf("current row overwritten: %q", w)
	}
	if w, _ := work("it-2"); w != "Press test gate valve" {
		t.Errorf("missing row not filled: %q", w)
	}
	var total int
	db.QueryRow("SELECT COUNT(*) FROM wo_item_parsed WHERE wo_id = '980'").Scan(&total)
	if total != 5 {
		t.Errorf("parsed rows = %d, want 5", total)
	}

	// Nothing left: a second run only reads.
	if n, err := backfillParsedItems(); err != nil || n != 0 {
		t.Errorf("second run wrote %d rows (err %v)", n, err)
	}
}
