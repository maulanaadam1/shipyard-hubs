package handlers

import (
	"encoding/json"
	"strings"
	"testing"

	"shipyard/db"
)

func TestNormalizeVendorName(t *testing.T) {
	for in, want := range map[string]string{
		"PT. Maskuri Karya Sejahtera":   "MASKURI KARYA SEJAHTERA",
		"MASKURI KARYA SEJAHTERA, PT":   "MASKURI KARYA SEJAHTERA",
		"PRIMA DWI NUSA,PT":             "PRIMA DWI NUSA",
		"CV CWS OXY MARINE":             "CWS OXY MARINE",
		"  pt   haza  karya mandiri ":   "HAZA KARYA MANDIRI",
		"Dumas Tanjung Perak Shipyards": "DUMAS TANJUNG PERAK SHIPYARDS",
		"PTPN Jaya":                     "PTPN JAYA", // PT only as a whole word
	} {
		if got := normalizeVendorName(in); got != want {
			t.Errorf("%q: got %q, want %q", in, got, want)
		}
	}
}

func TestIngestReplaceSheet(t *testing.T) {
	resetIngest(t)
	id, token := createIngestSource(t, `{"name": "MasterOperation", "kind": "records", "key_column": "_key"}`)
	path := "/api/ingest/" + id
	send := func(body string) (int, map[string]any) { return ingestCall(t, "POST", path, token, body) }

	send(`{"rows": [{"_sheet": "vendor", "_key": "vendor:1", "id": "1"}, {"_sheet": "vendor", "_key": "vendor:2", "id": "2"}], "replace_sheet": "vendor"}`)
	send(`{"rows": [{"_sheet": "project", "_key": "project:9", "id": "9"}], "replace_sheet": "project"}`)

	// vendor:2 was deleted in the sheet; project rows stay.
	code, out := send(`{"rows": [{"_sheet": "vendor", "_key": "vendor:1", "id": "1"}], "replace_sheet": "vendor"}`)
	if code != 200 || out["removed"].(float64) != 1 || out["unchanged"].(float64) != 1 {
		t.Fatalf("replace: %d %v", code, out)
	}
	vendors, _ := loadExternalSheet("vendor")
	projects, _ := loadExternalSheet("project")
	if len(vendors) != 1 || vendors[0]["id"] != "1" || len(projects) != 1 {
		t.Errorf("after replace: vendor %v project %v", vendors, projects)
	}
	if _, has := vendors[0][externalSheetField]; has {
		t.Error("bookkeeping field returned")
	}

	// A row from another tab in a replace delivery is refused.
	if code, _ := send(`{"rows": [{"_sheet": "project", "_key": "project:9"}], "replace_sheet": "vendor"}`); code != 400 {
		t.Errorf("mixed tabs: want 400, got %d", code)
	}
	// An empty tab clears it.
	if _, out := send(`{"rows": [], "replace_sheet": "vendor"}`); out["removed"].(float64) != 1 {
		t.Errorf("empty tab: %v", out)
	}
}

// seedAttendanceWorld: two PT's punches, one worker known only from the
// member list, a WO vendor spelled the SIAGA way, and approvals in the week.
func seedAttendanceWorld(t *testing.T) {
	t.Helper()
	resetIngest(t)
	resetWorkOrderTables(t)
	_, token := createIngestSource(t, `{"id": "master-op", "name": "MasterOperation", "kind": "records", "key_column": "_key"}`)
	ingestCall(t, "POST", "/api/ingest/master-op", token, `{"replace_sheet": "vendor_detail", "rows": [
		{"_sheet": "vendor_detail", "_key": "vendor_detail:1", "emp_code": "E9", "name": "Sari Uji", "kepala_subkon": "Pak Budi", "nama_pt": "PT Maju Jaya", "keahlian": "Fitter", "no_hp": "0812"},
		{"_sheet": "vendor_detail", "_key": "vendor_detail:2", "emp_code": "E1", "name": "Andi Uji", "kepala_subkon": "Pak Las", "nama_pt": "PT. Las Abadi", "keahlian": "Welder"}]}`)

	upsertAttendancePunches("absen", []attendancePunch{
		{ID: "1", EmpCode: "E1", FirstName: "Andi", NamaPT: "PT. Las Abadi", PunchTime: "2026-11-02 07:00:00"},
		{ID: "2", EmpCode: "E1", NamaPT: "PT. Las Abadi", PunchTime: "2026-11-02 17:00:00"}, // 10h, 2h overtime
		{ID: "3", EmpCode: "E9", PunchTime: "2026-11-02 07:30:00"},                          // no PT on the punch
		{ID: "4", EmpCode: "E9", PunchTime: "2026-11-02 15:30:00"},                          // 8h
		{ID: "5", EmpCode: "E7", PunchTime: "2026-11-03 07:00:00"},                          // unknown worker, one punch
	})
	db.Exec(`INSERT INTO work_order_summary (wo_id, wo_code, vendor_name) VALUES ('900', 'WO-900', 'LAS ABADI, PT')`)
	db.Exec(`INSERT INTO work_order_daily_costs (wo_id, cost_date, approved_cost) VALUES ('900', '2026-11-03', 5000000), ('900', '2026-12-01', 999)`)

	db.Exec("DELETE FROM profiles WHERE id IN ('att-admin', 'att-viewer', 'att-nobody')")
	db.Exec(`INSERT INTO profiles (id, email, username, name, role) VALUES ('att-admin', 'att-admin@example.test', 'attadmin', 'Att Admin', 'Admin')`)
	db.Exec(`INSERT INTO profiles (id, email, username, name, role, roles, extra_roles) VALUES ('att-viewer', 'att-viewer@example.test', 'attviewer', 'Viewer', 'Staff', '', ?)`, ResourceIngestSources)
	db.Exec(`INSERT INTO profiles (id, email, username, name, role, roles) VALUES ('att-nobody', 'att-nobody@example.test', 'attnobody', 'Nobody', 'Staff', '')`)
	t.Cleanup(func() { db.Exec("DELETE FROM profiles WHERE id IN ('att-admin', 'att-viewer', 'att-nobody')") })
}

func runAttendanceTool(t *testing.T, user, input string) (map[string]interface{}, error) {
	t.Helper()
	res, err := runAttendanceHours(aiRequest(user), json.RawMessage(input))
	if err != nil {
		return nil, err
	}
	b, _ := json.Marshal(res)
	var out map[string]interface{}
	json.Unmarshal(b, &out)
	return out, nil
}

func TestAttendanceHoursTool(t *testing.T) {
	seedAttendanceWorld(t)
	week := `"date_from": "2026-11-02", "date_to": "2026-11-08"`

	out, err := runAttendanceTool(t, "att-admin", `{`+week+`}`)
	if err != nil {
		t.Fatal(err)
	}
	byVendor := map[string]map[string]interface{}{}
	for _, r := range out["rows"].([]interface{}) {
		row := r.(map[string]interface{})
		byVendor[row["vendor"].(string)] = row
	}
	las := byVendor["PT. Las Abadi"]
	// Joined to the WO vendor despite the different spelling; only the
	// approval inside the period counts; 5,000,000 / 10 h.
	if las == nil || las["wo_vendor"] != "LAS ABADI, PT" || las["wo_approved_value"] != float64(5000000) ||
		las["value_per_hour"] != float64(500000) || las["overtime_hours"] != float64(2) {
		t.Errorf("Las Abadi: %v", las)
	}
	// E9's PT comes from the member list.
	maju := byVendor["PT Maju Jaya"]
	if maju == nil || maju["worked_hours"] != float64(8) || maju["wo_vendor"] != nil {
		t.Errorf("Maju Jaya: %v", maju)
	}
	if byVendor[noPTLabel] == nil || byVendor[noPTLabel]["incomplete_days"] != float64(1) {
		t.Errorf("worker without PT: %v", byVendor[noPTLabel])
	}
	notes := strings.Join(toStrings(out["notes"]), " | ")
	if !strings.Contains(notes, "Vendor tanpa WO di ShipHub") || !strings.Contains(notes, "PT Maju Jaya") || !strings.Contains(notes, "1 pekerja tanpa PT") {
		t.Errorf("notes: %s", notes)
	}
	if tot := out["totals"].(map[string]interface{}); tot["workers"] != float64(3) || tot["man_days"] != float64(3) {
		t.Errorf("totals: %v", tot)
	}

	// Any spelling of the vendor; per worker with kepala subkon and skill.
	out, _ = runAttendanceTool(t, "att-admin", `{`+week+`, "vendor": "las abadi pt", "group_by": "worker"}`)
	rows := out["rows"].([]interface{})
	if len(rows) != 1 || rows[0].(map[string]interface{})["keahlian"] != "Welder" || rows[0].(map[string]interface{})["kepala_subkon"] != "Pak Las" {
		t.Errorf("worker rows: %v", rows)
	}
	out, _ = runAttendanceTool(t, "att-admin", `{`+week+`, "worker": "sari", "group_by": "worker"}`)
	if rows := out["rows"].([]interface{}); len(rows) != 1 || rows[0].(map[string]interface{})["emp_code"] != "E9" {
		t.Errorf("worker search: %v", rows)
	}
	out, _ = runAttendanceTool(t, "att-admin", `{`+week+`, "group_by": "day"}`)
	if rows := out["rows"].([]interface{}); len(rows) != 2 || rows[0].(map[string]interface{})["date"] != "2026-11-02" {
		t.Errorf("day rows: %v", rows)
	}
	// Without dates: the 7 days up to the latest attendance.
	out, _ = runAttendanceTool(t, "att-admin", `{}`)
	if p := out["period"].(map[string]interface{}); p["to"] != "2026-11-03" || p["from"] != "2026-10-28" {
		t.Errorf("default period: %v", p)
	}

	// Without billing rights: hours and the WO vendor name, no value.
	out, _ = runAttendanceTool(t, "att-viewer", `{`+week+`, "vendor": "PT. Las Abadi"}`)
	row := out["rows"].([]interface{})[0].(map[string]interface{})
	if row["wo_vendor"] != "LAS ABADI, PT" || row["wo_approved_value"] != nil || row["value_per_hour"] != nil {
		t.Errorf("viewer: %v", row)
	}

	for _, bad := range []string{`{"group_by": "kapal"}`, `{"date_from": "2026-01-01", "date_to": "2026-06-01"}`, `{"date_from": "kemarin"}`, `{"dari": "x"}`} {
		if _, err := runAttendanceTool(t, "att-admin", bad); err == nil {
			t.Errorf("%s: want an input error", bad)
		}
	}

	var tool aiTool
	for _, x := range aiTools() {
		if x.Name == "attendance_hours" {
			tool = x
		}
	}
	if !tool.allowed(aiRequest("att-admin")) || !tool.allowed(aiRequest("att-viewer")) || tool.allowed(aiRequest("att-nobody")) {
		t.Error("attendance_hours must be offered to Admin and Sumber Data Eksternal viewers only")
	}
}

func TestQueryAppDataMasterOperation(t *testing.T) {
	seedAttendanceWorld(t)
	run := func(user, input string) (map[string]interface{}, error) {
		res, err := runQueryAppData(aiRequest(user), json.RawMessage(input))
		if err != nil {
			return nil, err
		}
		b, _ := json.Marshal(res)
		var out map[string]interface{}
		json.Unmarshal(b, &out)
		return out, nil
	}
	out, err := run("att-admin", `{"source": "mo_vendor_members", "filters": {"emp_code": "E9"}}`)
	if err != nil {
		t.Fatal(err)
	}
	rows := out["rows"].([]interface{})
	if len(rows) != 1 || rows[0].(map[string]interface{})["kepala_subkon"] != "Pak Budi" {
		t.Fatalf("member lookup: %v", out)
	}
	// A phone number sent anyway is never shown.
	if _, has := rows[0].(map[string]interface{})["no_hp"]; has {
		t.Error("personal column returned")
	}
	if _, err := run("att-nobody", `{"source": "mo_vendor_members"}`); err == nil {
		t.Error("a user without the resource read vendor members")
	}
}

func toStrings(v interface{}) []string {
	var out []string
	if list, ok := v.([]interface{}); ok {
		for _, x := range list {
			out = append(out, x.(string))
		}
	}
	return out
}
