package handlers

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"shipyard/db"
)

// Attendance: fingerprint punches from the attendance spreadsheet's
// Master_RawData sheet. A separate Apps Script project
// (apps-script/attendance-sync) reads the sheet and posts its rows here; the
// spreadsheet's own script, which fills that sheet, is left untouched.

const (
	attendanceMaxRows  = 5000
	attendanceMaxBody  = 20 << 20
	attendanceMaxDays  = 62
	attendanceTimeForm = "2006-01-02 15:04:05"
	// Punches before this hour belong to the previous day's shift.
	attendanceShiftStartHour = 5
)

var attendanceHeaderClean = regexp.MustCompile(`[^a-z0-9_]`)

// attendanceTimeLayouts are the punch_time forms the sheet can hold.
var attendanceTimeLayouts = []string{
	attendanceTimeForm,
	"2006-01-02T15:04:05",
	"2006-01-02T15:04:05Z07:00",
	"2006-01-02 15:04",
	"2006/01/02 15:04:05",
}

func parsePunchTime(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	for _, layout := range attendanceTimeLayouts {
		if t, err := time.Parse(layout, s); err == nil {
			// Wall-clock time as the machine recorded it; the zone is dropped.
			return time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), 0, time.UTC), true
		}
	}
	return time.Time{}, false
}

func attendanceString(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(x)
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	}
	return strings.TrimSpace(fmt.Sprint(v))
}

// attendanceSyncToken is compared in constant time; an unset token turns the
// endpoint off instead of leaving it open.
func attendanceTokenOK(r *http.Request) (enabled, ok bool) {
	want := os.Getenv("ATTENDANCE_SYNC_TOKEN")
	if want == "" {
		return false, false
	}
	got := r.Header.Get("X-Sync-Token")
	return true, subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

type attendancePunch struct {
	ID, EmpCode, FirstName, LastName, KepalaSubkon, NamaPT, PunchTime, TerminalSN, Raw string
}

// attendancePunchFromRow maps one sheet row (header -> value) to a punch.
func attendancePunchFromRow(row map[string]any) (attendancePunch, error) {
	clean := make(map[string]any, len(row))
	for k, v := range row {
		// "Kepala Subkon" and "kepala_subkon" are the same column.
		key := strings.Join(strings.Fields(strings.ToLower(k)), "_")
		clean[attendanceHeaderClean.ReplaceAllString(key, "")] = v
	}
	get := func(k string) string { return attendanceString(clean[k]) }

	p := attendancePunch{
		ID:           get("id"),
		EmpCode:      get("emp_code"),
		FirstName:    get("first_name"),
		LastName:     get("last_name"),
		KepalaSubkon: get("kepala_subkon"),
		NamaPT:       get("nama_pt"),
		TerminalSN:   get("terminal_sn"),
	}
	if p.ID == "" || p.EmpCode == "" {
		return p, fmt.Errorf("baris tanpa id atau emp_code")
	}
	pt := get("punch_time")
	if pt == "" && get("date") != "" && get("time") != "" {
		pt = get("date") + " " + get("time")
	}
	t, ok := parsePunchTime(pt)
	if !ok {
		return p, fmt.Errorf("id %s: punch_time %q tidak terbaca", p.ID, pt)
	}
	p.PunchTime = t.Format(attendanceTimeForm)
	raw, _ := json.Marshal(row)
	p.Raw = string(raw)
	return p, nil
}

// PostAttendanceSync upserts punches sent by the attendance Apps Script.
// Auth: X-Sync-Token must equal ATTENDANCE_SYNC_TOKEN (no user session).
func PostAttendanceSync(w http.ResponseWriter, r *http.Request) {
	enabled, ok := attendanceTokenOK(r)
	if !enabled {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "sinkron absensi belum diaktifkan (ATTENDANCE_SYNC_TOKEN kosong)"})
		return
	}
	if !ok {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "token sinkron salah"})
		return
	}

	var body struct {
		Rows []map[string]any `json:"rows"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, attendanceMaxBody)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body JSON tidak valid: " + err.Error()})
		return
	}
	if len(body.Rows) > attendanceMaxRows {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": fmt.Sprintf("maksimal %d baris per kiriman", attendanceMaxRows)})
		return
	}

	var punches []attendancePunch
	var problems []string
	for _, row := range body.Rows {
		p, err := attendancePunchFromRow(row)
		if err != nil {
			if len(problems) < 10 {
				problems = append(problems, err.Error())
			}
			continue
		}
		punches = append(punches, p)
	}

	changed, err := upsertAttendancePunches(punches)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gagal menyimpan: " + err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"received":  len(body.Rows),
		"saved":     changed,                       // new or changed
		"unchanged": len(punches) - changed,        // already stored as is
		"skipped":   len(body.Rows) - len(punches), // unreadable rows, see problems
		"problems":  problems,
	})
}

func upsertAttendancePunches(punches []attendancePunch) (int, error) {
	if len(punches) == 0 {
		return 0, nil
	}
	tx, err := db.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	// The script resends the last days every 5 minutes; rows whose content is
	// unchanged are left alone, so a resend does not rewrite them.
	stmt, err := tx.Prepare(db.FormatQuery(`INSERT INTO attendance_punches
		(id, emp_code, first_name, last_name, kepala_subkon, nama_pt, punch_time, terminal_sn, raw, synced_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (id) DO UPDATE SET
			emp_code = excluded.emp_code, first_name = excluded.first_name, last_name = excluded.last_name,
			kepala_subkon = excluded.kepala_subkon, nama_pt = excluded.nama_pt, punch_time = excluded.punch_time,
			terminal_sn = excluded.terminal_sn, raw = excluded.raw, synced_at = excluded.synced_at
		WHERE attendance_punches.raw IS DISTINCT FROM excluded.raw`))
	if err != nil {
		return 0, err
	}
	defer stmt.Close()
	now := time.Now().Format(time.RFC3339)
	changed := 0
	for _, p := range punches {
		res, err := stmt.Exec(p.ID, p.EmpCode, p.FirstName, p.LastName, p.KepalaSubkon, p.NamaPT, p.PunchTime, p.TerminalSN, p.Raw, now)
		if err != nil {
			return 0, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			changed++
		}
	}
	return changed, tx.Commit()
}

// --- Daily work hours ---

var attendanceDayNames = []string{"Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"}

// attendanceRules: normal working hours per day before overtime starts.
// Same defaults as the spreadsheet's Pengaturan Overtime menu.
type attendanceRules struct {
	WeekdayHours  float64
	SaturdayHours float64
}

func (r attendanceRules) normalMinutes(day time.Weekday) int {
	switch day {
	case time.Sunday:
		return 0
	case time.Saturday:
		return int(r.SaturdayHours * 60)
	}
	return int(r.WeekdayHours * 60)
}

// standardOutMinutes is how long after 08:00 a shift is assumed to end when
// the check-out punch is missing (Sunday uses the weekday length, as the sheet does).
func (r attendanceRules) standardOutMinutes(day time.Weekday) int {
	if day == time.Saturday {
		return int(r.SaturdayHours * 60)
	}
	return int(r.WeekdayHours * 60)
}

type attendanceDay struct {
	EmpCode      string `json:"emp_code"`
	Name         string `json:"name"`
	KepalaSubkon string `json:"kepala_subkon"`
	NamaPT       string `json:"nama_pt"`
	Date         string `json:"date"`
	Day          string `json:"hari"`
	CheckIn      string `json:"check_in"`
	CheckOut     string `json:"check_out"`
	Punches      int    `json:"punches"`
	// Status: lengkap, tanpa_absen_pulang, tanpa_absen_masuk.
	Status string `json:"status"`
	// WorkedMinutes is measured from real punches; nil when one is missing.
	WorkedMinutes *int `json:"worked_minutes"`
	// EstimatedMinutes fills a missing punch with 08:00 or the standard end,
	// like the spreadsheet's Attendance Card. Equal to WorkedMinutes when complete.
	EstimatedMinutes int `json:"estimated_minutes"`
	OvertimeMinutes  int `json:"overtime_minutes"`
}

type attendanceVendorSummary struct {
	NamaPT           string `json:"nama_pt"`
	Workers          int    `json:"workers"`
	ManDays          int    `json:"man_days"`
	IncompleteDays   int    `json:"incomplete_days"`
	WorkedMinutes    int    `json:"worked_minutes"`
	EstimatedMinutes int    `json:"estimated_minutes"`
	OvertimeMinutes  int    `json:"overtime_minutes"`
}

type punchRow struct {
	EmpCode, Name, KepalaSubkon, NamaPT string
	At                                  time.Time
}

// shiftDate: punches before 05:00 count for the day before.
func shiftDate(t time.Time) time.Time {
	d := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
	if t.Hour() < attendanceShiftStartHour {
		d = d.AddDate(0, 0, -1)
	}
	return d
}

// computeAttendanceDays turns punches into one row per worker per shift day.
func computeAttendanceDays(punches []punchRow, rules attendanceRules) []attendanceDay {
	type group struct {
		date  time.Time
		times []time.Time
		last  punchRow
	}
	groups := map[string]*group{}
	var keys []string
	for _, p := range punches {
		d := shiftDate(p.At)
		key := p.EmpCode + "|" + d.Format("2006-01-02")
		g := groups[key]
		if g == nil {
			g = &group{date: d}
			groups[key] = g
			keys = append(keys, key)
		}
		g.times = append(g.times, p.At)
		g.last = p
	}

	out := make([]attendanceDay, 0, len(keys))
	for _, key := range keys {
		g := groups[key]
		sort.Slice(g.times, func(i, j int) bool { return g.times[i].Before(g.times[j]) })
		info := g.last // latest synced name/vendor for the worker that day
		in, outT := g.times[0], g.times[len(g.times)-1]
		hasIn, hasOut := true, true
		if !in.Before(outT) {
			// One punch (or several at the same second): a morning one is the
			// check-in, anything else the check-out, as in the spreadsheet.
			hm := in.Hour()*100 + in.Minute()
			if hm >= 500 && hm <= 1300 && in.Day() == g.date.Day() {
				hasOut = false
			} else {
				hasIn = false
			}
		}

		std := g.date.Add(8 * time.Hour)
		calcIn, calcOut := in, outT
		day := attendanceDay{
			EmpCode:      info.EmpCode,
			Name:         info.Name,
			KepalaSubkon: info.KepalaSubkon,
			NamaPT:       info.NamaPT,
			Date:         g.date.Format("2006-01-02"),
			Day:          attendanceDayNames[g.date.Weekday()],
			Punches:      len(g.times),
			Status:       "lengkap",
		}
		if hasIn {
			day.CheckIn = in.Format("15:04:05")
		} else {
			calcIn = std
			day.Status = "tanpa_absen_masuk"
		}
		if hasOut {
			day.CheckOut = outT.Format("15:04:05")
		} else {
			calcOut = std.Add(time.Duration(rules.standardOutMinutes(g.date.Weekday())) * time.Minute)
			day.Status = "tanpa_absen_pulang"
		}

		minutes := int(calcOut.Sub(calcIn).Minutes())
		if minutes < 0 {
			minutes = 0
		}
		day.EstimatedMinutes = minutes
		if hasIn && hasOut {
			m := minutes
			day.WorkedMinutes = &m
		}
		if over := minutes - rules.normalMinutes(g.date.Weekday()); over > 0 {
			day.OvertimeMinutes = over
		}
		out = append(out, day)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Date != out[j].Date {
			return out[i].Date < out[j].Date
		}
		if out[i].NamaPT != out[j].NamaPT {
			return out[i].NamaPT < out[j].NamaPT
		}
		return out[i].EmpCode < out[j].EmpCode
	})
	return out
}

func summarizeAttendanceByVendor(days []attendanceDay) []attendanceVendorSummary {
	byPT := map[string]*attendanceVendorSummary{}
	workers := map[string]map[string]bool{}
	for _, d := range days {
		pt := d.NamaPT
		if pt == "" {
			pt = "-"
		}
		s := byPT[pt]
		if s == nil {
			s = &attendanceVendorSummary{NamaPT: pt}
			byPT[pt] = s
			workers[pt] = map[string]bool{}
		}
		workers[pt][d.EmpCode] = true
		s.ManDays++
		s.EstimatedMinutes += d.EstimatedMinutes
		s.OvertimeMinutes += d.OvertimeMinutes
		if d.WorkedMinutes != nil {
			s.WorkedMinutes += *d.WorkedMinutes
		} else {
			s.IncompleteDays++
		}
	}
	out := make([]attendanceVendorSummary, 0, len(byPT))
	for pt, s := range byPT {
		s.Workers = len(workers[pt])
		out = append(out, *s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].EstimatedMinutes > out[j].EstimatedMinutes })
	return out
}

func attendanceHoursParam(v string, def float64) (float64, error) {
	if v == "" {
		return def, nil
	}
	f, err := strconv.ParseFloat(strings.Replace(v, ",", ".", 1), 64)
	if err != nil || f < 0 || f > 24 {
		return 0, fmt.Errorf("jam kerja normal harus angka 0-24")
	}
	return f, nil
}

// GetAttendanceDaily: work hours per worker per day, and totals per vendor.
// ?from=YYYY-MM-DD&to=YYYY-MM-DD (max 62 days), optional nama_pt, emp_code,
// weekday_hours (default 8) and saturday_hours (default 4).
func GetAttendanceDaily(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	today := time.Now().Format("2006-01-02")
	fromS, toS := q.Get("from"), q.Get("to")
	if fromS == "" {
		fromS = today
	}
	if toS == "" {
		toS = fromS
	}
	from, err1 := time.Parse("2006-01-02", fromS)
	to, err2 := time.Parse("2006-01-02", toS)
	if err1 != nil || err2 != nil || to.Before(from) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "from/to harus tanggal YYYY-MM-DD dan from <= to"})
		return
	}
	if to.Sub(from) >= attendanceMaxDays*24*time.Hour {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("rentang maksimal %d hari", attendanceMaxDays)})
		return
	}
	weekday, err := attendanceHoursParam(q.Get("weekday_hours"), 8)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	sat, err := attendanceHoursParam(q.Get("saturday_hours"), 4)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	rules := attendanceRules{WeekdayHours: weekday, SaturdayHours: sat}
	days, err := loadAttendanceDays(from, to, q.Get("nama_pt"), q.Get("emp_code"), rules)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"from":    fromS,
		"to":      toS,
		"rules":   map[string]float64{"weekday_hours": weekday, "saturday_hours": sat},
		"vendors": summarizeAttendanceByVendor(days),
		"days":    days,
	})
}

func loadAttendanceDays(from, to time.Time, namaPT, empCode string, rules attendanceRules) ([]attendanceDay, error) {
	shift := time.Duration(attendanceShiftStartHour) * time.Hour
	where := []string{"punch_time >= ?", "punch_time < ?"}
	args := []any{from.Add(shift).Format(attendanceTimeForm), to.AddDate(0, 0, 1).Add(shift).Format(attendanceTimeForm)}
	if namaPT != "" {
		where = append(where, "nama_pt = ?")
		args = append(args, namaPT)
	}
	if empCode != "" {
		where = append(where, "emp_code = ?")
		args = append(args, empCode)
	}
	rows, err := db.Query(`SELECT emp_code, COALESCE(first_name, ''), COALESCE(last_name, ''),
		COALESCE(kepala_subkon, ''), COALESCE(nama_pt, ''), punch_time
		FROM attendance_punches WHERE `+strings.Join(where, " AND ")+` ORDER BY punch_time`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var punches []punchRow
	for rows.Next() {
		var p punchRow
		var first, last, at string
		if err := rows.Scan(&p.EmpCode, &first, &last, &p.KepalaSubkon, &p.NamaPT, &at); err != nil {
			return nil, err
		}
		t, ok := parsePunchTime(at)
		if !ok {
			continue
		}
		p.At = t
		p.Name = strings.TrimSpace(first + " " + last)
		punches = append(punches, p)
	}
	return computeAttendanceDays(punches, rules), rows.Err()
}
