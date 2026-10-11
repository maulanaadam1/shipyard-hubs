package handlers

import "testing"

func TestSQLIdentifier(t *testing.T) {
	for _, ok := range []string{"id", "unique_id", "created_at", "Col2"} {
		if !sqlIdentifier.MatchString(ok) {
			t.Errorf("%q should be accepted", ok)
		}
	}
	for _, bad := range []string{"", "1=1", "id; DROP TABLE profiles", "id--", "name desc", "a.b", "x)", "2col"} {
		if sqlIdentifier.MatchString(bad) {
			t.Errorf("%q should be rejected", bad)
		}
	}
	if got := invalidColumn(map[string]any{"name": 1, "role = 'Admin' --": 2}); got != "role = 'Admin' --" {
		t.Errorf("invalidColumn = %q", got)
	}
	if got := invalidColumn(map[string]any{"name": 1, "email": 2}); got != "" {
		t.Errorf("invalidColumn on valid row = %q", got)
	}
}

func TestRedactRow(t *testing.T) {
	profile := map[string]any{"id": "1", "email": "a@b", "password": "$2a$10$hash"}
	redactRow("profiles", profile, true)
	if _, ok := profile["password"]; ok {
		t.Error("password hash must never be returned, even to Admins")
	}

	cfg := func() map[string]any {
		return map[string]any{"id": "WorkOrders", "url": "https://x", "headers": `{"cookie":"secret"}`, "last_response": "{...}"}
	}
	staff := cfg()
	redactRow("sync_configs", staff, false)
	if _, ok := staff["headers"]; ok {
		t.Error("SIAGA headers must be hidden from non-Admins")
	}
	if _, ok := staff["last_response"]; ok {
		t.Error("last_response must not be returned")
	}
	admin := cfg()
	redactRow("sync_configs", admin, true)
	if _, ok := admin["headers"]; !ok {
		t.Error("Admins need headers to edit API Sync Config")
	}

	other := map[string]any{"password": "x"}
	redactRow("vendors", other, false)
	if _, ok := other["password"]; !ok {
		t.Error("only listed tables are redacted")
	}
}

func TestPrivilegeChangeDeniedForNewRows(t *testing.T) {
	if privilegeChangeDenied("role_permissions", map[string]any{"is_allowed": true}, false, "") == "" {
		t.Error("non-Admins must not write role_permissions")
	}
	if privilegeChangeDenied("role_permissions", map[string]any{"is_allowed": true}, true, "") != "" {
		t.Error("Admins may write role_permissions")
	}
	if privilegeChangeDenied("profiles", map[string]any{"name": "New", "role": "Staff", "roles": "Staff"}, false, "") != "" {
		t.Error("non-Admins with user rights may create plain Staff users")
	}
	for _, row := range []map[string]any{
		{"role": "Admin"},
		{"role": "Manager"},
		{"role": "Staff", "roles": "Admin"},
		{"role": "Staff", "extra_roles": "User Management"},
	} {
		if privilegeChangeDenied("profiles", row, false, "") == "" {
			t.Errorf("non-Admin creating %v must be denied", row)
		}
	}
	if privilegeChangeDenied("vendors", map[string]any{"role": "Admin"}, false, "") != "" {
		t.Error("only profiles carry privilege fields")
	}
}
