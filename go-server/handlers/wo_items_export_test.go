package handlers

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/xuri/excelize/v2"

	"shipyard/db"
	"shipyard/middleware"
)

func withUser(r *http.Request, id, email, role string) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), middleware.UserClaimsKey, middleware.UserClaims{ID: id, Email: email, Role: role}))
}

// seedItemsForExport loads WO-400 (nestedDetail: 3 items) through the normal sync path.
func seedItemsForExport(t *testing.T) {
	t.Helper()
	resetWorkOrderTables(t)
	if err := ProcessWorkOrderList([]byte(`{"data": [{"id": 400, "code": "WO-400", "jo_code": "DRP26X/YWTS", "m_ship_name": "Kapal A", "m_vendor_name": "", "min_approval_level": 2, "total_cost": 1750000, "updated_at": "2026-10-05 09:00:00"}]}`)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec("INSERT INTO work_order_details (wo_id, raw_json) VALUES (?, ?)", "400", nestedDetail); err != nil {
		t.Fatal(err)
	}
	if err := RebuildWorkOrderDerived(); err != nil {
		t.Fatal(err)
	}
}

func exportSheet(t *testing.T, query string) (*excelize.File, [][]string) {
	t.Helper()
	rec := httptest.NewRecorder()
	ExportWorkOrderItems(rec, httptest.NewRequest("GET", "/api/wo-items/export?"+query, nil))
	if rec.Code != 200 {
		t.Fatalf("export %q -> %d %s", query, rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" {
		t.Fatalf("content type %q", ct)
	}
	f, err := excelize.OpenReader(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatalf("not a valid xlsx: %v", err)
	}
	rows, err := f.GetRows("Item Pekerjaan")
	if err != nil {
		t.Fatal(err)
	}
	return f, rows
}

func TestExportWorkOrderItemsList(t *testing.T) {
	seedItemsForExport(t)

	f, rows := exportSheet(t, "view=list")
	defer f.Close()
	if len(rows) != 4 {
		t.Fatalf("want header + 3 items, got %d rows: %v", len(rows), rows)
	}
	if rows[0][0] != "No" || rows[0][13] != "Item Pekerjaan" || rows[0][17] != "Total Biaya" {
		t.Errorf("header: %v", rows[0])
	}
	// Same order as the page: newest first, so the approved item (2026-09-10) is last.
	last := rows[3]
	if last[1] != "2026-09-10" || last[3] != "Approved" || last[9] != noVendorLabel || last[13] != "Cleaning lumpur tanki 3P" {
		t.Errorf("last row: %v", last)
	}
	// Costs are numeric cells, not text.
	if v, _ := f.GetCellValue("Item Pekerjaan", "R4", excelize.Options{RawCellValue: true}); v != "1500000" {
		t.Errorf("total cost cell raw value = %q", v)
	}

	// Filters apply, and the Filter sheet records them.
	f2, rows := exportSheet(t, "view=list&status=pending")
	defer f2.Close()
	if len(rows) != 2 || rows[1][13] != "Kuras air tanki 3P" {
		t.Errorf("pending only: %v", rows)
	}
	meta, _ := f2.GetRows("Filter")
	found := map[string]string{}
	for _, m := range meta {
		if len(m) == 2 {
			found[m[0]] = m[1]
		}
	}
	if found["Tampilan"] != "Daftar Item" || found["Status Approval"] != "Pending" || found["Jumlah Baris"] != "1" {
		t.Errorf("filter sheet: %v", found)
	}
}

func TestExportWorkOrderItemsSummary(t *testing.T) {
	seedItemsForExport(t)

	f, rows := exportSheet(t, "view=vendor_activity")
	defer f.Close()
	if len(rows) != 2 {
		t.Fatalf("want header + 1 group, got %v", rows)
	}
	if rows[0][1] != "Vendor" || rows[0][2] != "Aktivitas" || rows[0][10] != "Total Biaya" {
		t.Errorf("header: %v", rows[0])
	}
	if rows[1][1] != noVendorLabel || rows[1][3] != "3" || rows[1][9] != "2026-10-05" {
		t.Errorf("group row: %v", rows[1])
	}
	if v, _ := f.GetCellValue("Item Pekerjaan", "K2", excelize.Options{RawCellValue: true}); v != "1750000" {
		t.Errorf("group total cost = %q", v)
	}

	rec := httptest.NewRecorder()
	ExportWorkOrderItems(rec, httptest.NewRequest("GET", "/api/wo-items/export?view=bogus", nil))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("unknown view -> %d", rec.Code)
	}
}

func TestWorkOrderItemsPermission(t *testing.T) {
	for _, q := range []string{
		"DELETE FROM role_permissions WHERE role_id = 'role-qc-test'",
		"DELETE FROM roles_master WHERE id = 'role-qc-test'",
		"DELETE FROM profiles WHERE id LIKE 'perm-test-%'",
	} {
		db.Exec(q)
	}
	mustExec := func(q string, args ...interface{}) {
		if _, err := db.Exec(q, args...); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	mustExec("INSERT INTO roles_master (id, name, description) VALUES ('role-qc-test', 'QC Test', '')")
	mustExec("INSERT INTO role_permissions (id, role_id, resource, action, is_allowed) VALUES ('perm-qc-view', 'role-qc-test', ?, 'view', ?)", ResourceWorkOrderItems, true)
	mustExec("INSERT INTO role_permissions (id, role_id, resource, action, is_allowed) VALUES ('perm-qc-export', 'role-qc-test', ?, 'export', ?)", ResourceWorkOrderItems, false)
	mustExec("INSERT INTO profiles (id, email, role, roles, extra_roles) VALUES ('perm-test-qc', 'qc@test.local', 'Staff', 'QC Test', NULL)")
	mustExec("INSERT INTO profiles (id, email, role, roles, extra_roles) VALUES ('perm-test-none', 'none@test.local', 'Staff', NULL, NULL)")
	mustExec("INSERT INTO profiles (id, email, role, roles, extra_roles) VALUES ('perm-test-extra', 'extra@test.local', 'Staff', '', 'Item Pekerjaan WO:export')")
	mustExec("INSERT INTO profiles (id, email, role, roles, extra_roles) VALUES ('perm-test-admin', 'admin@test.local', 'Admin', '', '')")

	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) })
	cases := []struct {
		user, email, action string
		want                int
	}{
		{"perm-test-qc", "qc@test.local", "view", 200},
		{"perm-test-qc", "qc@test.local", "export", 403}, // role row exists but is_allowed = false
		{"perm-test-none", "none@test.local", "view", 403},
		{"perm-test-extra", "extra@test.local", "export", 200},
		{"perm-test-extra", "extra@test.local", "view", 403}, // the override names export only
		{"perm-test-admin", "admin@test.local", "export", 200},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		RequirePermission(ResourceWorkOrderItems, c.action)(ok).ServeHTTP(rec, withUser(httptest.NewRequest("GET", "/", nil), c.user, c.email, "Staff"))
		if rec.Code != c.want {
			t.Errorf("%s %s -> %d, want %d (%s)", c.user, c.action, rec.Code, c.want, rec.Body.String())
		}
	}

	rec := httptest.NewRecorder()
	RequirePermission(ResourceWorkOrderItems, "view")(ok).ServeHTTP(rec, httptest.NewRequest("GET", "/", nil))
	if rec.Code != 403 {
		t.Errorf("no user -> %d", rec.Code)
	}
}

func TestMigrateWorkOrderItemsPermission(t *testing.T) {
	for _, q := range []string{
		"DELETE FROM role_permissions WHERE role_id = 'role-mig-test'",
		"DELETE FROM roles_master WHERE id = 'role-mig-test'",
		"DELETE FROM app_meta WHERE key = 'rbac_item_pekerjaan_wo'",
	} {
		db.Exec(q)
	}
	db.Exec("INSERT INTO roles_master (id, name, description) VALUES ('role-mig-test', 'Mig Test', '')")
	db.Exec("INSERT INTO role_permissions (id, role_id, resource, action, is_allowed) VALUES ('mig-view', 'role-mig-test', 'Work Order', 'view', ?)", true)
	db.Exec("INSERT INTO role_permissions (id, role_id, resource, action, is_allowed) VALUES ('mig-export', 'role-mig-test', 'Work Order', 'export', ?)", false)

	count := func() (int, int) {
		var n, allowed int
		rows, _ := db.Query("SELECT action, is_allowed FROM role_permissions WHERE role_id = 'role-mig-test' AND resource = 'Item Pekerjaan WO'")
		defer rows.Close()
		for rows.Next() {
			var action string
			var ok bool
			rows.Scan(&action, &ok)
			n++
			if ok {
				allowed++
			}
		}
		return n, allowed
	}

	db.MigrateWorkOrderItemsPermission()
	if n, allowed := count(); n != 2 || allowed != 1 {
		t.Fatalf("after migration: %d rows, %d allowed; want the Work Order rows copied as-is (2, 1)", n, allowed)
	}

	// Runs once: a later change on the new resource is not overwritten.
	db.Exec("DELETE FROM role_permissions WHERE role_id = 'role-mig-test' AND resource = 'Item Pekerjaan WO'")
	db.MigrateWorkOrderItemsPermission()
	if n, _ := count(); n != 0 {
		t.Errorf("migration ran twice: %d rows", n)
	}
}
