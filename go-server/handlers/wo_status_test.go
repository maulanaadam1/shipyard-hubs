package handlers

import (
	"fmt"
	"testing"

	"shipyard/db"
)

// detailWithLevels builds a SIAGA-shaped detail: one activity whose work items
// have the given approval levels; a level of -1 makes a rejected item.
func detailWithLevels(woID string, rootLevel int, levels ...int) string {
	items := ""
	for i, lvl := range levels {
		if i > 0 {
			items += ","
		}
		status, level := "waiting", lvl
		switch {
		case lvl < 0:
			status, level = "rejected", 0
		case lvl >= 5:
			status = "approved"
		}
		items += fmt.Sprintf(`{"id": "it-%d", "path": "1.%d", "label": "Item %d", "unit": "ls", "volume": 1, "volume_cost_final": 1000,
			"approved_level": %d, "status_approval": "%s", "date_approval": "2026-09-1%d 08:00:00"}`, i, i, i, level, status, i%10)
	}
	return fmt.Sprintf(`{"data": {"id": %s, "code": "WO-%s", "min_approval_level": %d, "updated_at": "2026-10-05 09:00:00",
		"repair_list": [{"id": "act-1", "path": "1", "parameter": {"path_name": "TEST > Activity"}, "material": [%s]}]}}`, woID, woID, rootLevel, items)
}

func TestStatusFromWorkItems(t *testing.T) {
	cases := []struct {
		name      string
		rootLevel int
		levels    []int
		want      string
	}{
		{"SIAGA says 0 but every item is approved", 0, []int{5, 5, 5}, "Approval Level 5"},
		{"rejected items do not hold the WO back", 0, []int{5, 5, -1}, "Approval Level 5"},
		{"some items still pending: lowest level", 0, []int{5, 5, 0}, "Waiting"},
		{"lowest of levels in progress", 0, []int{5, 3, 2}, "Approval Level 2"},
		{"globally approved WO with item levels unset", 5, []int{0, 0}, "Approval Level 5"},
		{"lowest item wins over a higher root level below 5", 3, []int{5, 2}, "Approval Level 2"},
		{"newly added item pulls an approved WO back", 0, []int{5, 5, 0}, "Waiting"},
	}
	for _, c := range cases {
		s := applyFinancialsFromDetail(workOrderSummary{WOID: "900"}, []byte(detailWithLevels("900", c.rootLevel, c.levels...)))
		if s.DerivedStatus != c.want || !s.StatusFromItems {
			t.Errorf("%s: status %q (from items %v), want %q", c.name, s.DerivedStatus, s.StatusFromItems, c.want)
		}
	}

	// The level only in the text status (approved_level still 0), as in WO21010040.
	textOnly := `{"data": {"id": 902, "min_approval_level": 1, "repair_list": [{"id": "act-1", "path": "1", "parameter": {"path_name": "TEST > A"}, "material": [
		{"id": "it-1", "path": "1.1", "label": "Bongkar pasang", "unit": "unit", "volume": 20, "volume_cost_final": 1000, "approved_level": 0, "status_approval": "approved level 1"},
		{"id": "it-2", "path": "1.2", "label": "Rewinding", "unit": "unit", "volume": 1, "volume_cost_final": 1000, "approved_level": 5, "status_approval": "approved"}]}]}}`
	if s := applyFinancialsFromDetail(workOrderSummary{WOID: "902"}, []byte(textOnly)); s.DerivedStatus != "Approval Level 1" || s.Items[0].Level != 1 {
		t.Errorf("level from status text: status %q, item level %d", s.DerivedStatus, s.Items[0].Level)
	}
	for in, want := range map[string]int{"approved": 5, "approved level 3": 3, "level 2": 2, "waiting": 0, "rejected": 0, "": 0} {
		if got := itemApprovalLevel(0, in); got != want {
			t.Errorf("itemApprovalLevel(0, %q) = %d, want %d", in, got, want)
		}
	}
	if got := itemApprovalLevel(4, "approved level 2"); got != 4 {
		t.Errorf("numeric level ahead of the text: %d", got)
	}

	// No work items: SIAGA's level is all there is.
	s := applyFinancialsFromDetail(workOrderSummary{WOID: "901"}, []byte(`{"data": {"id": 901, "min_approval_level": 3, "repair_list": []}}`))
	if s.DerivedStatus != "Approval Level 3" || s.StatusFromItems {
		t.Errorf("no items: %q (from items %v)", s.DerivedStatus, s.StatusFromItems)
	}
}

// End to end: the item-based status is saved, and later list syncs (which
// still carry min_approval_level 0) neither overwrite it nor count as changes.
func TestItemStatusSurvivesListSync(t *testing.T) {
	resetWorkOrderTables(t)
	list := []byte(`{"data": [{"id": 910, "code": "WO-910", "jo_code": "JO-1", "m_ship_name": "Kapal A", "m_vendor_name": "V", "min_approval_level": 0, "total_cost": 3000, "updated_at": "2026-10-05 09:00:00"}]}`)
	if err := ProcessWorkOrderList(list); err != nil {
		t.Fatal(err)
	}
	status := func() string {
		var s string
		db.QueryRow("SELECT COALESCE(derived_status, '') FROM work_order_summary WHERE wo_id = '910'").Scan(&s)
		return s
	}
	if got := status(); got != "Waiting" {
		t.Fatalf("from the list alone: %q", got)
	}

	if _, err := db.Exec("INSERT INTO work_order_details (wo_id, raw_json) VALUES (?, ?)", "910", detailWithLevels("910", 0, 5, 5, 5)); err != nil {
		t.Fatal(err)
	}
	if err := RebuildWorkOrderDerived(); err != nil {
		t.Fatal(err)
	}
	if got := status(); got != "Approval Level 5" {
		t.Fatalf("after the detail: %q, want Approval Level 5", got)
	}

	before := woDataVersion.Load()
	if err := ProcessWorkOrderList(list); err != nil {
		t.Fatal(err)
	}
	if got := status(); got != "Approval Level 5" {
		t.Errorf("list sync overwrote the item status: %q", got)
	}
	if woDataVersion.Load() != before {
		t.Error("an unchanged list must not count the item-status WO as changed")
	}

	// A real list change (new updated_at) is still written, status kept.
	changed := []byte(`{"data": [{"id": 910, "code": "WO-910", "jo_code": "JO-1", "m_ship_name": "Kapal A", "m_vendor_name": "V", "min_approval_level": 0, "total_cost": 3000, "updated_at": "2026-10-06 09:00:00"}]}`)
	if err := ProcessWorkOrderList(changed); err != nil {
		t.Fatal(err)
	}
	var updated string
	db.QueryRow("SELECT COALESCE(updated_source_at, '') FROM work_order_summary WHERE wo_id = '910'").Scan(&updated)
	if updated != "2026-10-06 09:00:00" || status() != "Approval Level 5" {
		t.Errorf("changed list: updated_source_at %q, status %q", updated, status())
	}
}
