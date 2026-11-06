package handlers

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

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
	// Kepala vendor per PT: SIAGA bills some work under these names.
	ingestCall(t, "POST", "/api/ingest/master-op", token, `{"replace_sheet": "vendor", "rows": [
		{"_sheet": "vendor", "_key": "vendor:1", "id": "1", "vendor": "MARYONO", "nama_pt": "MAJU JAYA, PT"},
		{"_sheet": "vendor", "_key": "vendor:2", "id": "2", "vendor": "Lasman", "nama_pt": "PT LAS ABADI"}]}`)

	upsertAttendancePunches("absen", []attendancePunch{
		{ID: "1", EmpCode: "E1", FirstName: "Andi", NamaPT: "PT. Las Abadi", PunchTime: "2026-11-02 07:00:00"},
		{ID: "2", EmpCode: "E1", NamaPT: "PT. Las Abadi", PunchTime: "2026-11-02 17:00:00"}, // 10h, 2h overtime
		{ID: "3", EmpCode: "E9", PunchTime: "2026-11-02 07:30:00"},                          // no PT on the punch
		{ID: "4", EmpCode: "E9", PunchTime: "2026-11-02 15:30:00"},                          // 8h
		{ID: "5", EmpCode: "E7", PunchTime: "2026-11-03 07:00:00"},                          // unknown worker, one punch
		{ID: "6", EmpCode: "E8", NamaPT: "PT Tanpa Order", PunchTime: "2026-11-02 08:00:00"},
		{ID: "7", EmpCode: "E5", PunchTime: "2026-11-03 18:00:00"}, // in no list, one evening punch
	})
	// The attendance spreadsheet's machine users: E7 is a yard employee; E5's
	// department is the machine's placeholder, i.e. not set.
	ingestCall(t, "POST", "/api/ingest/master-op", token, `{"replace_sheet": "Personal-Data", "rows": [
		{"_sheet": "Personal-Data", "_key": "Personal-Data:E7", "emp_code": "E7", "first_name": "Rudi", "department": "QHSE", "positition": "Staff"},
		{"_sheet": "Personal-Data", "_key": "Personal-Data:E5", "emp_code": "E5", "first_name": "Tono", "department": "Department", "positition": "Harian"}]}`)
	db.Exec(`INSERT INTO work_order_summary (wo_id, wo_code, vendor_name) VALUES ('900', 'WO-900', 'LAS ABADI, PT')`)
	db.Exec(`INSERT INTO work_order_summary (wo_id, wo_code, vendor_name) VALUES ('901', 'WO-901', 'MARYONO'), ('902', 'WO-902', 'LASMAN')`)
	db.Exec(`INSERT INTO work_order_daily_costs (wo_id, cost_date, approved_cost) VALUES ('900', '2026-11-03', 5000000), ('900', '2026-12-01', 999),
		('901', '2026-11-04', 1600000), ('902', '2026-11-05', 1000000)`)

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
	// Joined to the WO vendor despite the different spelling and to the WO
	// under its kepala vendor; only approvals inside the period count:
	// (5,000,000 + 1,000,000) / 10 h.
	if las == nil || las["wo_vendor"] != "LAS ABADI, PT" || las["wo_approved_value"] != float64(6000000) ||
		las["value_per_hour"] != float64(600000) || las["overtime_hours"] != float64(2) || las["wo_approved_count"] != float64(2) ||
		strings.Join(toStrings(las["wo_vendors"]), ",") != "LAS ABADI, PT,LASMAN" {
		t.Errorf("Las Abadi: %v", las)
	}
	// E9's PT comes from the member list; its WO is under its kepala vendor.
	maju := byVendor["PT Maju Jaya"]
	if maju == nil || maju["worked_hours"] != float64(8) || maju["wo_vendor"] != "MARYONO" ||
		maju["wo_approved_value"] != float64(1600000) || maju["value_per_hour"] != float64(200000) || maju["wo_vendors"] != nil {
		t.Errorf("Maju Jaya: %v", maju)
	}
	// E7 has no PT but is a yard employee in Personal-Data; E5 is in no list.
	if q := byVendor["Internal - QHSE"]; q == nil || q["workers"] != float64(1) || q["wo_vendor"] != nil {
		t.Errorf("internal department: %v", q)
	}
	if byVendor[noPTLabel] == nil || byVendor[noPTLabel]["workers"] != float64(1) || byVendor[noPTLabel]["incomplete_days"] != float64(1) {
		t.Errorf("worker without PT: %v", byVendor[noPTLabel])
	}
	notes := strings.Join(toStrings(out["notes"]), " | ")
	if !strings.Contains(notes, "Vendor tanpa WO di ShipHub (nama PT maupun kepala vendornya tidak sama dengan vendor WO mana pun): PT Tanpa Order") ||
		!strings.Contains(notes, "PT Maju Jaya = MARYONO") || !strings.Contains(notes, "PT. Las Abadi = LASMAN") || !strings.Contains(notes, "1 pekerja tanpa PT") {
		t.Errorf("notes: %s", notes)
	}
	if strings.Contains(notes, "Internal - QHSE") {
		t.Errorf("an internal department listed as a vendor without WO: %s", notes)
	}
	if tot := out["totals"].(map[string]interface{}); tot["workers"] != float64(5) || tot["man_days"] != float64(5) {
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

	for _, bad := range []string{`{"group_by": "kapal"}`, `{"date_from": "2025-01-01", "date_to": "2026-06-01"}`, `{"date_from": "kemarin"}`, `{"dari": "x"}`} {
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

func TestQueryAppDataHidesPersonalColumns(t *testing.T) {
	seedAttendanceWorld(t)
	db.Exec("DELETE FROM master_employees WHERE id = 'emp-priv'")
	db.Exec(`INSERT INTO master_employees (id, code, name, address, email, phone, mobile_phone, position) VALUES ('emp-priv', 'K-1', 'Karyawan Uji', 'Jl. Rahasia 1', 'k@example.test', '021', '0812', 'Welder')`)
	defer db.Exec("DELETE FROM master_employees WHERE id = 'emp-priv'")
	res, err := runQueryAppData(aiRequest("att-admin"), json.RawMessage(`{"source": "employees", "filters": {"code": "K-1"}}`))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(res)
	for _, leak := range []string{"Rahasia", "k@example.test", "0812", `"address"`, `"email"`, `"phone"`, `"mobile_phone"`} {
		if strings.Contains(string(b), leak) {
			t.Errorf("employee personal data returned (%s): %s", leak, b)
		}
	}
	if !strings.Contains(string(b), "Karyawan Uji") || !strings.Contains(string(b), "Welder") {
		t.Errorf("employee row missing: %s", b)
	}
}

func TestAttendanceWorkerDaysAndInternal(t *testing.T) {
	seedAttendanceWorld(t)
	week := `"date_from": "2026-11-02", "date_to": "2026-11-08"`

	out, err := runAttendanceTool(t, "att-admin", `{`+week+`, "group_by": "worker_day", "worker": "andi"}`)
	if err != nil {
		t.Fatal(err)
	}
	rows := out["rows"].([]interface{})
	if len(rows) != 1 {
		t.Fatalf("worker_day rows: %v", rows)
	}
	r := rows[0].(map[string]interface{})
	if r["date"] != "2026-11-02" || r["check_in"] != "07:00:00" || r["check_out"] != "17:00:00" || r["status"] != "lengkap" ||
		strings.Join(toStrings(r["punch_times"]), ",") != "07:00:00,17:00:00" || r["worked_hours"] != float64(10) || r["vendor"] != "PT. Las Abadi" {
		t.Errorf("Andi's day: %v", r)
	}

	// The yard employee: department as group, position, one morning punch.
	out, _ = runAttendanceTool(t, "att-admin", `{`+week+`, "group_by": "worker_day", "vendor": "internal"}`)
	rows = out["rows"].([]interface{})
	if len(rows) != 1 {
		t.Fatalf("internal rows: %v", rows)
	}
	r = rows[0].(map[string]interface{})
	if r["emp_code"] != "E7" || r["vendor"] != "Internal - QHSE" || r["position"] != "Staff" || r["check_in"] != "07:00:00" ||
		r["check_out"] != "" || r["status"] != "tanpa_absen_pulang" || r["worked_hours"] != nil {
		t.Errorf("E7's day: %v", r)
	}
	// "Internal QHSE" in any spelling selects the department.
	out, _ = runAttendanceTool(t, "att-admin", `{`+week+`, "vendor": "internal qhse"}`)
	if rows := out["rows"].([]interface{}); len(rows) != 1 || rows[0].(map[string]interface{})["vendor"] != "Internal - QHSE" {
		t.Errorf("department filter: %v", rows)
	}
	// The placeholder department "Department" is not a department.
	out, _ = runAttendanceTool(t, "att-admin", `{`+week+`, "vendor": "Tanpa PT", "group_by": "worker_day"}`)
	if rows := out["rows"].([]interface{}); len(rows) != 1 || rows[0].(map[string]interface{})["emp_code"] != "E5" ||
		rows[0].(map[string]interface{})["status"] != "tanpa_absen_masuk" {
		t.Errorf("Tanpa PT: %v", rows)
	}
	if tot := out["totals"].(map[string]interface{}); tot["days"] != float64(1) || tot["tanpa_absen_masuk"] != float64(1) {
		t.Errorf("worker_day totals: %v", tot)
	}

	// The daily API carries the same detail.
	days, err := loadAttendanceDays(mustDate("2026-11-03"), mustDate("2026-11-03"), map[string]string{"emp_code": "E7"}, attendanceRules{WeekdayHours: 8, SaturdayHours: 4})
	if err != nil || len(days) != 1 || days[0].Department != "QHSE" || days[0].Position != "Staff" || len(days[0].PunchTimes) != 1 {
		t.Errorf("daily days: %+v %v", days, err)
	}
}

func mustDate(s string) time.Time {
	t, _ := time.Parse("2006-01-02", s)
	return t
}

// nama_pt empty or "-": the vendor name in the column before it counts as
// the vendor (kepala_subkon in vendor_detail and on punches, vendor in the
// vendor tab).
func TestNamaPTFallsBackToNeighbour(t *testing.T) {
	seedAttendanceWorld(t)
	var token string
	_, token = createIngestSource(t, `{"id": "master-op-2", "name": "MasterOperation 2", "kind": "records", "key_column": "_key"}`)
	ingestCall(t, "POST", "/api/ingest/master-op-2", token, `{"rows": [
		{"_sheet": "vendor_detail", "_key": "vendor_detail:9", "emp_code": "E4", "name": "Wawan", "kepala_subkon": "CV Kepala Usaha", "nama_pt": ""},
		{"_sheet": "vendor", "_key": "vendor:9", "id": "9", "vendor": "TEMU", "nama_pt": "-"}]}`)
	upsertAttendancePunches("absen", []attendancePunch{
		{ID: "20", EmpCode: "E4", PunchTime: "2026-11-02 08:00:00"},
		{ID: "21", EmpCode: "E4", PunchTime: "2026-11-02 16:00:00"},
		{ID: "22", EmpCode: "E3", KepalaSubkon: "Pak Mandor", NamaPT: "-", PunchTime: "2026-11-02 08:00:00"},
	})
	db.Exec(`INSERT INTO work_order_summary (wo_id, wo_code, vendor_name) VALUES ('903', 'WO-903', 'KEPALA USAHA, CV'), ('904', 'WO-904', 'TEMU')`)
	db.Exec(`INSERT INTO work_order_daily_costs (wo_id, cost_date, approved_cost) VALUES ('903', '2026-11-04', 800000)`)

	out, err := runAttendanceTool(t, "att-admin", `{"date_from": "2026-11-02", "date_to": "2026-11-08"}`)
	if err != nil {
		t.Fatal(err)
	}
	byVendor := map[string]map[string]interface{}{}
	for _, r := range out["rows"].([]interface{}) {
		row := r.(map[string]interface{})
		byVendor[row["vendor"].(string)] = row
	}
	// From the member list: no PT, so the kepala subkon is the vendor, and
	// its WO (spelled the SIAGA way) is found.
	if k := byVendor["CV Kepala Usaha"]; k == nil || k["worked_hours"] != float64(8) || k["wo_vendor"] != "KEPALA USAHA, CV" || k["wo_approved_value"] != float64(800000) {
		t.Errorf("member without PT: %v", k)
	}
	// From the punch itself: PT "-", kepala subkon on the punch.
	if m := byVendor["Pak Mandor"]; m == nil || m["workers"] != float64(1) {
		t.Errorf("punch without PT: %v", m)
	}
	if aliases := vendorAliases()["TEMU"]; len(aliases) != 1 || aliases[0] != "TEMU" {
		t.Errorf("vendor tab row without PT: %v", aliases)
	}
	for in, want := range map[[2]string]string{{"PT A", "X"}: "PT A", {"", "X"}: "X", {"-", "X"}: "X", {"", "-"}: "", {" ", ""}: ""} {
		if got := orNeighbour(in[0], in[1]); got != want {
			t.Errorf("orNeighbour(%q, %q) = %q, want %q", in[0], in[1], got, want)
		}
	}
}

// MasterHSE work permits: a permit active on a day is found by its date range,
// and one permit number can have several rows.
func TestQueryAppDataWorkPermits(t *testing.T) {
	seedAttendanceWorld(t)
	_, token := createIngestSource(t, `{"id": "master-hse", "name": "MasterHSE", "kind": "records", "key_column": "_key"}`)
	ingestCall(t, "POST", "/api/ingest/master-hse", token, `{"replace_sheet": "workpermit", "rows": [
		{"_sheet": "workpermit", "_key": "workpermit:WP-1", "no_workpermit": "WP-1", "vendor": "MARYONO", "manpower": 3, "wpclass_1": "Panas , Lainnya", "date_start": "2026-11-02", "date_finish": "2026-11-08", "status": "Approved"},
		{"_sheet": "workpermit", "_key": "workpermit:WP-1#2", "no_workpermit": "WP-1", "vendor": "Lasman", "manpower": 4, "wpclass_1": "Ruang Terbatas", "date_start": "2026-11-02", "date_finish": "2026-11-08", "status": "Draft"},
		{"_sheet": "workpermit", "_key": "workpermit:WP-2", "no_workpermit": "WP-2", "vendor": "MARYONO", "manpower": 5, "wpclass_1": "Panas", "date_start": "2026-10-01", "date_finish": "2026-10-07", "status": "Approved"}]}`)
	res, err := runQueryAppData(aiRequest("att-admin"), json.RawMessage(
		`{"source": "hse_work_permits", "date_column": "date_start", "end_column": "date_finish", "date_from": "2026-11-06", "date_to": "2026-11-06", "group_by": "vendor", "sum_column": "manpower"}`))
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(res)
	var out struct {
		Groups []struct {
			Value string  `json:"value"`
			Count int     `json:"count"`
			Sum   float64 `json:"sum"`
		} `json:"groups"`
	}
	json.Unmarshal(b, &out)
	if len(out.Groups) != 2 {
		t.Fatalf("active permits per vendor: %s", b)
	}
	for _, g := range out.Groups {
		if g.Value == "MARYONO" && (g.Count != 1 || g.Sum != 3) {
			t.Errorf("MARYONO: %+v (the October permit is not active)", g)
		}
	}
	// The start date alone misses permits that began before the day.
	res, _ = runQueryAppData(aiRequest("att-admin"), json.RawMessage(
		`{"source": "hse_work_permits", "date_column": "date_start", "date_from": "2026-11-06", "date_to": "2026-11-06"}`))
	if m := res.(map[string]interface{})["matched"]; m != 0 {
		t.Errorf("start date only: matched %v, want 0", m)
	}
	// A range overlapping the end of the October permit finds it.
	res, _ = runQueryAppData(aiRequest("att-admin"), json.RawMessage(
		`{"source": "hse_work_permits", "date_column": "date_start", "end_column": "date_finish", "date_from": "2026-10-05", "date_to": "2026-10-31"}`))
	if m := res.(map[string]interface{})["matched"]; m != 1 {
		t.Errorf("October overlap: matched %v, want 1", m)
	}
	if _, err := runQueryAppData(aiRequest("att-admin"), json.RawMessage(`{"source": "hse_work_permits", "end_column": "date_finish"}`)); err == nil {
		t.Error("end_column without date_column accepted")
	}
	if _, err := runQueryAppData(aiRequest("att-nobody"), json.RawMessage(`{"source": "hse_work_permits"}`)); err == nil {
		t.Error("a user without the resource read work permits")
	}
}
