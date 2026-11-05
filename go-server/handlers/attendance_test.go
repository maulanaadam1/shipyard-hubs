package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"shipyard/db"
)

func postAttendance(t *testing.T, token, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest("POST", "/api/attendance/sync", strings.NewReader(body))
	if token != "" {
		req.Header.Set("X-Sync-Token", token)
	}
	rec := httptest.NewRecorder()
	PostAttendanceSync(rec, req)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func TestAttendanceSyncAuth(t *testing.T) {
	t.Setenv("ATTENDANCE_SYNC_TOKEN", "")
	if rec, _ := postAttendance(t, "x", `{"rows":[]}`); rec.Code != 503 {
		t.Errorf("unset token: want 503, got %d", rec.Code)
	}
	t.Setenv("ATTENDANCE_SYNC_TOKEN", "rahasia")
	if rec, _ := postAttendance(t, "", `{"rows":[]}`); rec.Code != 401 {
		t.Errorf("missing token: want 401, got %d", rec.Code)
	}
	if rec, _ := postAttendance(t, "salah", `{"rows":[]}`); rec.Code != 401 {
		t.Errorf("wrong token: want 401, got %d", rec.Code)
	}
	if rec, _ := postAttendance(t, "rahasia", `{"rows":[]}`); rec.Code != 200 {
		t.Errorf("right token: want 200, got %d", rec.Code)
	}
}

func TestAttendanceSyncUpsert(t *testing.T) {
	t.Setenv("ATTENDANCE_SYNC_TOKEN", "rahasia")
	db.Exec("DELETE FROM attendance_punches")

	body := `{"rows":[
		{"id": 101, "emp_code": "E1", "first_name": "Budi", "last_name": "S", "Kepala Subkon": "Pak A", "nama_pt": "PT Las", "punch_time": "2026-11-02 07:55:00"},
		{"id": "102", "emp_code": "E1", "punch_time": "2026-11-02T17:10:30", "nama_pt": "PT Las"},
		{"id": 103, "emp_code": "E2", "date": "2026-11-02", "time": "08:01:00"},
		{"id": 104, "emp_code": "", "punch_time": "2026-11-02 08:00:00"},
		{"id": 105, "emp_code": "E3", "punch_time": "kemarin"}
	]}`
	rec, out := postAttendance(t, "rahasia", body)
	if rec.Code != 200 || out["saved"].(float64) != 3 || out["skipped"].(float64) != 2 || len(out["problems"].([]any)) != 2 {
		t.Fatalf("first sync: %d %v", rec.Code, out)
	}

	var subkon string
	db.QueryRow("SELECT kepala_subkon FROM attendance_punches WHERE id = '101'").Scan(&subkon)
	if subkon != "Pak A" {
		t.Errorf("header with a space not mapped: kepala_subkon %q", subkon)
	}

	// Resending identical rows changes nothing.
	_, out = postAttendance(t, "rahasia", body)
	if out["saved"].(float64) != 0 || out["unchanged"].(float64) != 3 {
		t.Errorf("identical resend: %v", out)
	}

	// Sending the same id with new content updates the row instead of duplicating it.
	_, out = postAttendance(t, "rahasia", `{"rows":[{"id": 101, "emp_code": "E1", "nama_pt": "PT Las Baru", "punch_time": "2026-11-02 07:55:00"}]}`)
	var n int
	var pt, at string
	db.QueryRow("SELECT COUNT(*) FROM attendance_punches").Scan(&n)
	db.QueryRow("SELECT nama_pt, punch_time FROM attendance_punches WHERE id = '101'").Scan(&pt, &at)
	if out["saved"].(float64) != 1 || n != 3 || pt != "PT Las Baru" || at != "2026-11-02 07:55:00" {
		t.Errorf("after changed resend: %v, %d rows, nama_pt %q, punch_time %q", out, n, pt, at)
	}
	db.QueryRow("SELECT punch_time FROM attendance_punches WHERE id = '102'").Scan(&at)
	if at != "2026-11-02 17:10:30" {
		t.Errorf("ISO punch_time not normalized: %q", at)
	}
}

func punchAt(emp, pt, s string) punchRow {
	at, _ := parsePunchTime(s)
	return punchRow{EmpCode: emp, Name: emp, NamaPT: pt, At: at}
}

func TestComputeAttendanceDays(t *testing.T) {
	rules := attendanceRules{WeekdayHours: 8, SaturdayHours: 4}
	days := computeAttendanceDays([]punchRow{
		// Monday, in 07:30 out 18:00 with a punch in between: 10h30, 2h30 overtime.
		punchAt("A", "PT X", "2026-11-02 07:30:00"),
		punchAt("A", "PT X", "2026-11-02 12:00:00"),
		punchAt("A", "PT X", "2026-11-02 18:00:00"),
		// Night shift: in Monday 20:00, out Tuesday 02:00 belongs to Monday.
		punchAt("B", "PT X", "2026-11-02 20:00:00"),
		punchAt("B", "PT X", "2026-11-03 02:00:00"),
		// Only a morning punch on Saturday: estimated end 08:00 + 4h.
		punchAt("C", "PT Y", "2026-11-07 07:00:00"),
		// Only an afternoon punch on Tuesday: estimated start 08:00.
		punchAt("D", "PT Y", "2026-11-03 16:00:00"),
		// Sunday: every minute is overtime.
		punchAt("E", "PT Y", "2026-11-08 08:00:00"),
		punchAt("E", "PT Y", "2026-11-08 11:00:00"),
	}, rules)

	byEmp := map[string]attendanceDay{}
	for _, d := range days {
		byEmp[d.EmpCode] = d
	}
	check := func(emp, date, status string, worked *int, est, over int) {
		t.Helper()
		d := byEmp[emp]
		if d.Date != date || d.Status != status || d.EstimatedMinutes != est || d.OvertimeMinutes != over {
			t.Errorf("%s: got %+v", emp, d)
		}
		if (worked == nil) != (d.WorkedMinutes == nil) || (worked != nil && *worked != *d.WorkedMinutes) {
			t.Errorf("%s worked: want %v got %v", emp, worked, d.WorkedMinutes)
		}
	}
	m := func(v int) *int { return &v }
	check("A", "2026-11-02", "lengkap", m(630), 630, 150)
	check("B", "2026-11-02", "lengkap", m(360), 360, 0)
	check("C", "2026-11-07", "tanpa_absen_pulang", nil, 300, 60)
	check("D", "2026-11-03", "tanpa_absen_masuk", nil, 480, 0)
	check("E", "2026-11-08", "lengkap", m(180), 180, 180)
	if byEmp["A"].Day != "Senin" || byEmp["A"].CheckIn != "07:30:00" || byEmp["A"].CheckOut != "18:00:00" || byEmp["A"].Punches != 3 {
		t.Errorf("A details: %+v", byEmp["A"])
	}

	sum := summarizeAttendanceByVendor(days)
	if len(sum) != 2 {
		t.Fatalf("vendors: %+v", sum)
	}
	for _, s := range sum {
		switch s.NamaPT {
		case "PT X":
			if s.Workers != 2 || s.ManDays != 2 || s.IncompleteDays != 0 || s.WorkedMinutes != 990 || s.OvertimeMinutes != 150 {
				t.Errorf("PT X: %+v", s)
			}
		case "PT Y":
			if s.Workers != 3 || s.ManDays != 3 || s.IncompleteDays != 2 || s.WorkedMinutes != 180 || s.EstimatedMinutes != 960 {
				t.Errorf("PT Y: %+v", s)
			}
		}
	}
}

func TestGetAttendanceDailyRange(t *testing.T) {
	db.Exec("DELETE FROM attendance_punches")
	upsertAttendancePunches([]attendancePunch{
		{ID: "1", EmpCode: "A", NamaPT: "PT X", PunchTime: "2026-11-02 04:30:00"}, // Sunday's shift, outside the range
		{ID: "2", EmpCode: "A", NamaPT: "PT X", PunchTime: "2026-11-02 07:00:00"},
		{ID: "3", EmpCode: "A", NamaPT: "PT X", PunchTime: "2026-11-03 01:00:00"}, // Monday's shift
		{ID: "4", EmpCode: "A", NamaPT: "PT X", PunchTime: "2026-11-03 07:00:00"}, // Tuesday, outside
	})
	rec := httptest.NewRecorder()
	GetAttendanceDaily(rec, httptest.NewRequest("GET", "/api/attendance/daily?from=2026-11-02&to=2026-11-02", nil))
	var out struct {
		Days []attendanceDay `json:"days"`
	}
	json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != 200 || len(out.Days) != 1 || out.Days[0].Punches != 2 || *out.Days[0].WorkedMinutes != 18*60 {
		t.Fatalf("range: %d %s", rec.Code, rec.Body.String())
	}

	for _, q := range []string{"from=2026-11-05&to=2026-11-01", "from=bukan", "from=2026-01-01&to=2026-06-01", "weekday_hours=abc"} {
		rec := httptest.NewRecorder()
		GetAttendanceDaily(rec, httptest.NewRequest("GET", "/api/attendance/daily?"+q, nil))
		if rec.Code != 400 {
			t.Errorf("%s: want 400, got %d", q, rec.Code)
		}
	}
}
