package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"shipyard/db"
)

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
	upsertAttendancePunches("absen", []attendancePunch{
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

	for _, q := range []string{"from=2026-11-05&to=2026-11-01", "from=bukan", "from=2025-01-01&to=2026-06-01", "weekday_hours=abc"} {
		rec := httptest.NewRecorder()
		GetAttendanceDaily(rec, httptest.NewRequest("GET", "/api/attendance/daily?"+q, nil))
		if rec.Code != 400 {
			t.Errorf("%s: want 400, got %d", q, rec.Code)
		}
	}
}

// A later punch without name or vendor does not blank out the day's details.
func TestComputeAttendanceDaysKeepsDetails(t *testing.T) {
	first := punchAt("F", "PT Z", "2026-11-05 07:50:00")
	first.Name, first.KepalaSubkon = "Uji Coba", "Pak A"
	last := punchAt("F", "", "2026-11-05 17:05:00")
	last.Name = ""
	days := computeAttendanceDays([]punchRow{first, last}, attendanceRules{WeekdayHours: 8, SaturdayHours: 4})
	if len(days) != 1 || days[0].Name != "Uji Coba" || days[0].KepalaSubkon != "Pak A" || days[0].NamaPT != "PT Z" {
		t.Errorf("details: %+v", days)
	}
}
