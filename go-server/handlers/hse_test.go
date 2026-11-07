package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"shipyard/db"
)

func seedWorkPermits(t *testing.T) {
	t.Helper()
	// Other tests leave work permits of their own (AI data tests): start clean.
	db.Exec(`DELETE FROM external_records WHERE data LIKE '%"_sheet":"workpermit"%'`)
	t.Cleanup(func() { db.Exec("DELETE FROM external_records WHERE source_id = 'hse-test'") })
	for i, row := range []map[string]interface{}{
		// Sheets write dates both ways; month first.
		{"no": 1, "no_workpermit": "WP-T-001", "category": "PROJECT", "status": "Approved", "shipname": "KM UJI", "vendor": "Vendor A",
			"manpower": "6", "area_kerja": "Graving Dock", "pekerjaan": "Replating bottom", "date_start": "11/2/2026", "date_finish": "2026-11-08",
			"wpclass_1": "Panas , Pengangkatan", "wpclass_5": "Safety Helm , Sepatu Safety", "person_list": "BUDI,ANTO", "no_hp": "0812"},
		{"no": 2, "no_workpermit": "WP-T-002", "category": "NON PROJECT", "status": "Draft", "shipname": "Bengkel", "vendor": "Vendor B",
			"manpower": "3", "area_kerja": "Workshop", "pekerjaan": "Perbaikan pompa", "date_start": "2026-11-05", "date_finish": "2026-11-05",
			"wpclass_1": "Ruang Terbatas"},
		{"no": 3, "no_workpermit": "WP-T-003", "category": "PROJECT", "status": "Approved", "shipname": "KM LAMA", "vendor": "Vendor A",
			"manpower": "4", "area_kerja": "Slipway D", "pekerjaan": "Pengecatan", "date_start": "2026-10-01", "date_finish": "2026-10-06",
			"wpclass_1": "Panas"},
	} {
		row[externalSheetField] = "workpermit"
		row[externalKeyField] = "workpermit:" + row["no_workpermit"].(string)
		raw, _ := json.Marshal(row)
		db.Exec(`INSERT INTO external_records (source_id, record_key, data, updated_at) VALUES ('hse-test', ?, ?, '2026-11-05')`, i, string(raw))
	}
}

func TestWorkPermits(t *testing.T) {
	seedWorkPermits(t)
	get := func(path string) map[string]interface{} {
		rec := httptest.NewRecorder()
		GetWorkPermits(rec, httptest.NewRequest("GET", path, nil))
		var out map[string]interface{}
		json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}
	all := get("/api/hse/work-permits")
	if all["total"] != float64(3) {
		t.Fatalf("all: %v", all)
	}
	first := all["permits"].([]interface{})[0].(map[string]interface{})
	if first["no_workpermit"] != "WP-T-002" { // newest start first
		t.Errorf("order: %v", first)
	}
	active := get("/api/hse/work-permits?active=2026-11-05")
	if active["total"] != float64(2) || active["manpower"] != float64(9) {
		t.Errorf("active on 5 Nov: %v", active)
	}
	p := get("/api/hse/work-permits?active=2026-11-03")["permits"].([]interface{})[0].(map[string]interface{})
	if p["no_workpermit"] != "WP-T-001" || p["date_start"] != "2026-11-02" || len(p["risks"].([]interface{})) != 2 || len(p["persons"].([]interface{})) != 2 {
		t.Errorf("permit fields: %v", p)
	}
	if _, ok := p["no_hp"]; ok {
		t.Error("personal column shown")
	}
	if n := get("/api/hse/work-permits?risk=Panas")["total"]; n != float64(2) {
		t.Errorf("risk filter: %v", n)
	}
	if n := get("/api/hse/work-permits?q=pompa&status=Draft")["total"]; n != float64(1) {
		t.Errorf("search + status: %v", n)
	}
	if n := get("/api/hse/work-permits?from=2026-10-05&to=2026-10-31")["total"]; n != float64(1) {
		t.Errorf("period: %v", n)
	}
}

func TestHSEDashboard(t *testing.T) {
	seedWorkPermits(t)
	db.Exec("DELETE FROM attendance_punches")
	t.Cleanup(func() { db.Exec("DELETE FROM attendance_punches") })
	upsertAttendancePunches("absen", []attendancePunch{
		{ID: "h1", EmpCode: "A", NamaPT: "PT X", PunchTime: "2026-11-05 07:30:00"},
		{ID: "h2", EmpCode: "A", NamaPT: "PT X", PunchTime: "2026-11-05 16:30:00"},
		{ID: "h3", EmpCode: "B", NamaPT: "PT Y", PunchTime: "2026-11-05 07:45:00"}, // no check-out
		{ID: "h4", EmpCode: "A", NamaPT: "PT X", PunchTime: "2026-11-04 07:30:00"},
	})
	db.Exec("DELETE FROM profiles WHERE id IN ('hse-admin', 'hse-only')")
	t.Cleanup(func() { db.Exec("DELETE FROM profiles WHERE id IN ('hse-admin', 'hse-only')") })
	db.Exec(`INSERT INTO profiles (id, email, username, name, role) VALUES ('hse-admin', 'hse-admin@example.test', 'hseadmin', 'Admin', 'Admin')`)
	db.Exec(`INSERT INTO profiles (id, email, username, name, role, roles, extra_roles) VALUES ('hse-only', 'hse-only@example.test', 'hseonly', 'HSE', 'Staff', '', ?)`, ResourceDataHSE)

	dash := func(user string) map[string]interface{} {
		rec := httptest.NewRecorder()
		GetHSEDashboard(rec, httptest.NewRequest("GET", "/api/hse/dashboard?date=2026-11-05", nil).WithContext(asUser(user)))
		var out map[string]interface{}
		json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}
	out := dash("hse-admin")
	permits := out["permits"].(map[string]interface{})
	if permits["active"] != float64(2) || permits["approved"] != float64(1) || permits["manpower"] != float64(6) {
		t.Errorf("permits: %v", permits)
	}
	att := out["attendance"].(map[string]interface{})
	if att["present"] != float64(2) || att["incomplete"] != float64(1) || len(att["daily"].([]interface{})) != 30 {
		t.Errorf("attendance: %v", att)
	}
	// Data HSE only: no attendance part.
	if only := dash("hse-only"); only["attendance"] != nil || only["permits"] == nil {
		t.Errorf("HSE-only dashboard: %v", only)
	}

	rec := httptest.NewRecorder()
	GetAttendanceDaily(rec, httptest.NewRequest("GET", "/api/attendance/daily?from=2026-11-04&to=2026-11-05&rows=0", nil))
	var daily map[string]interface{}
	json.Unmarshal(rec.Body.Bytes(), &daily)
	if dates := daily["dates"].([]interface{}); len(dates) != 2 || dates[1].(map[string]interface{})["workers"] != float64(2) || daily["days"] != nil {
		t.Errorf("attendance per date: %v", daily)
	}
}
