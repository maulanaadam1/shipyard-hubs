package handlers

import (
	"testing"

	"shipyard/db"
)

// The index's Status Approval follows min_approval_level from the SIAGA work
// order list API, whatever the stored detail's items say.
func TestStatusFollowsListMinApprovalLevel(t *testing.T) {
	resetWorkOrderTables(t)
	status := func(id string) string {
		var s string
		db.QueryRow("SELECT COALESCE(derived_status, '') FROM work_order_summary WHERE wo_id = ?", id).Scan(&s)
		return s
	}

	// WO23030229-like: the list says 5, one item still at level 0.
	list := []byte(`{"data": [
		{"id": 6129, "code": "WO23030229/YWTS", "jo_code": "JO-1", "m_ship_name": "SINAR MARATUA", "m_vendor_name": "PT ERARI ABADI TEKNIK", "min_approval_level": 5, "total_cost": 51441937, "updated_at": "2023-05-24 10:50:59"},
		{"id": 6130, "code": "WO-ZERO", "jo_code": "JO-1", "m_ship_name": "KAPAL", "m_vendor_name": "V", "min_approval_level": 0, "total_cost": 1000, "updated_at": "2023-05-24 10:50:59"}
	]}`)
	if err := ProcessWorkOrderList(list); err != nil {
		t.Fatal(err)
	}
	pending := `{"data": {"id": 6129, "min_approval_level": 0, "updated_at": "2023-05-24 10:50:59",
		"repair_list": [{"id": "act-1", "path": "1", "parameter": {"path_name": "TEST > A"}, "material": [
			{"id": "a", "path": "1.1", "label": "Approved", "unit": "ls", "volume": 1, "volume_cost_final": 1000, "approved_level": 5, "status_approval": "approved"},
			{"id": "b", "path": "1.2", "label": "Pending", "unit": "ls", "volume": 1, "volume_cost_final": 1000, "approved_level": 0, "status_approval": "waiting"}]}]}}`
	allApproved := `{"data": {"id": 6130, "min_approval_level": 0, "updated_at": "2023-05-24 10:50:59",
		"repair_list": [{"id": "act-1", "path": "1", "parameter": {"path_name": "TEST > A"}, "material": [
			{"id": "c", "path": "1.1", "label": "Approved", "unit": "ls", "volume": 1, "volume_cost_final": 1000, "approved_level": 5, "status_approval": "approved"}]}]}}`
	db.Exec("INSERT INTO work_order_details (wo_id, raw_json) VALUES (?, ?)", "6129", pending)
	db.Exec("INSERT INTO work_order_details (wo_id, raw_json) VALUES (?, ?)", "6130", allApproved)
	if err := RebuildWorkOrderDerived(); err != nil {
		t.Fatal(err)
	}

	if got := status("6129"); got != "Approval Level 5" {
		t.Errorf("min_approval_level 5: status %q, want Approval Level 5", got)
	}
	if got := status("6130"); got != "Waiting" {
		t.Errorf("min_approval_level 0: status %q, want Waiting", got)
	}

	// A status written by another rule (e.g. the reverted item-based one) goes
	// back to the API value on the next list pass.
	db.Exec("UPDATE work_order_summary SET derived_status = 'Waiting' WHERE wo_id = '6129'")
	if err := ProcessWorkOrderList(list); err != nil {
		t.Fatal(err)
	}
	if got := status("6129"); got != "Approval Level 5" {
		t.Errorf("after the list pass: %q, want Approval Level 5", got)
	}
}
