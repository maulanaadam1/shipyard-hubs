package handlers

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"

	"shipyard/db"
)

// attendance_hours: work hours from the fingerprint attendance, per vendor,
// worker or day, joined with the other data so the assistant can combine
// them: each vendor carries the WO vendor name SIAGA uses (for the Work
// Order and billing tools) and, for users who may see billing, the WO value
// approved in the same period and that value per hour worked.

const noPTLabel = "Tanpa PT"

func attendanceHoursTool() aiTool {
	return aiTool{
		Name: "attendance_hours",
		Description: "Attendance and work hours from the fingerprint machines (ZKTeco, synced from the attendance spreadsheet): " +
			"subcontractor workers (grouped by PT) and the yard's own employees (grouped as Internal - <department>). A worker is a " +
			"vendor worker only when listed in MasterOperation's vendor member list (vendor_detail); everyone else is internal. " +
			"When the user asks about vendors, use vendor \"vendor\" (all vendor workers) or a PT name: internal employees are then " +
			"left out; they only appear with vendor \"Internal\" or when the user asks about employees / internal. " +
			"Call this when the user asks how many hours or man-days a vendor / PT or department worked, who worked or did overtime, " +
			"how many workers came on a day, what time someone checked in or out, attendance with a missing check-in or check-out, " +
			"or productivity of a vendor (WO value per hour worked). group_by worker_day lists each worker's days with check-in, " +
			"check-out, every punch time and status; use it with worker or vendor and dates when the user asks what time people came or left. group_by vendor (default) returns per vendor: workers, man-days, measured hours, hours including " +
			"estimates for days with one punch, overtime, wo_vendor (plus wo_vendors when the PT is also billed under its kepala vendor name) = the exact WO vendor names for search_work_orders / " +
			"billing_summary, and (when the user may see billing) WO value approved in the period and value per hour. group_by " +
			"worker or day gives the same per worker (with kepala subkon and skill) or per date. Without dates it covers the " +
			"last 7 days of attendance.",
		Schema: aiSchema(map[string]interface{}{
			"date_from": aiString("First shift day, YYYY-MM-DD."),
			"date_to":   aiString("Last shift day, YYYY-MM-DD (at most 366 days after date_from, so a whole year fits)."),
			"vendor":    aiString("Vendor / PT name in any spelling (PT ABC, ABC PT, ABC, PT. Abc), \"vendor\" for all vendor workers, \"Internal - <department>\" (e.g. Internal - QHSE), \"Internal\" for all yard employees, or \"Tanpa PT\" for vendor workers without a PT."),
			"worker":    aiString("Worker name, emp_code (fingerprint id) or department; words must all match."),
			"group_by":  aiString("vendor (default: PT or internal department), worker, day, or worker_day (one row per worker per day with check-in / check-out times).", "vendor", "worker", "day", "worker_day"),
			"sort":      aiString("hours = most hours first (default), overtime = most overtime first, incomplete = most days with a missing punch first.", "hours", "overtime", "incomplete"),
			"limit":     aiInteger("Rows to return (default 20).", 1, 100),
		}),
		Resource: ResourceDataAttendance,
		Run:      runAttendanceHours,
	}
}

type attendanceHoursInput struct {
	DateFrom string `json:"date_from"`
	DateTo   string `json:"date_to"`
	Vendor   string `json:"vendor"`
	Worker   string `json:"worker"`
	GroupBy  string `json:"group_by"`
	Sort     string `json:"sort"`
	Limit    int    `json:"limit"`
}

func hours(minutes int) float64 { return math.Round(float64(minutes)/6) / 10 }

// groupLabel: PT, "Internal - <department>" or "Tanpa PT".
func groupLabel(d attendanceDay) string { return attendanceGroupLabel(d, noPTLabel) }

func isInternalLabel(label string) bool {
	return label == "Internal" || strings.HasPrefix(label, "Internal - ")
}

// attendancePeriod: the requested days, or the last 7 days of attendance.
func attendancePeriod(in attendanceHoursInput) (time.Time, time.Time, error) {
	if err := checkDate("date_from", in.DateFrom); err != nil {
		return time.Time{}, time.Time{}, err
	}
	if err := checkDate("date_to", in.DateTo); err != nil {
		return time.Time{}, time.Time{}, err
	}
	to := time.Now().UTC().Truncate(24 * time.Hour)
	if in.DateTo != "" {
		to, _ = time.Parse("2006-01-02", in.DateTo)
	} else {
		var latest string
		db.QueryRow("SELECT COALESCE(MAX(punch_time), '') FROM attendance_punches").Scan(&latest)
		if t, ok := parsePunchTime(latest); ok {
			to = shiftDate(t)
		}
	}
	from := to.AddDate(0, 0, -6)
	if in.DateFrom != "" {
		from, _ = time.Parse("2006-01-02", in.DateFrom)
		if in.DateTo == "" && to.Before(from) {
			to = from.AddDate(0, 0, 6)
		}
	}
	if to.Before(from) {
		return from, to, inputErrorf("date_to harus sama dengan atau setelah date_from")
	}
	if to.Sub(from) >= attendanceMaxDays*24*time.Hour {
		return from, to, inputErrorf("rentang maksimal %d hari; bagi pertanyaan per bulan", attendanceMaxDays)
	}
	return from, to, nil
}

// vendorApprovals: WO value approved per normalized vendor name in the
// period (by approval date, as on the Financial Dashboard).
func vendorApprovals(from, to string) map[string][2]float64 {
	out := map[string][2]float64{}
	rows, err := db.Query(`SELECT COALESCE(s.vendor_name, ''), COALESCE(SUM(l.approved_cost), 0), COUNT(DISTINCT l.wo_id)
		FROM work_order_daily_costs l JOIN work_order_summary s ON s.wo_id = l.wo_id
		WHERE l.cost_date >= ? AND l.cost_date <= ? AND l.approved_cost <> 0
		GROUP BY s.vendor_name`, from, to)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		var value, count float64
		if rows.Scan(&name, &value, &count) == nil {
			key := normalizeVendorName(name)
			cur := out[key]
			out[key] = [2]float64{cur[0] + value, cur[1] + count}
		}
	}
	return out
}

func runAttendanceHours(r *http.Request, input json.RawMessage) (interface{}, error) {
	var in attendanceHoursInput
	if err := decodeAIInput(input, &in); err != nil {
		return nil, err
	}
	if err := oneOf("group_by", in.GroupBy, "vendor", "worker", "day", "worker_day"); err != nil {
		return nil, err
	}
	if err := oneOf("sort", in.Sort, "hours", "overtime", "incomplete"); err != nil {
		return nil, err
	}
	from, to, err := attendancePeriod(in)
	if err != nil {
		return nil, err
	}
	rules := attendanceRules{WeekdayHours: 8, SaturdayHours: 4}
	all, err := loadAttendanceDays(from, to, map[string]string{}, rules)
	if err != nil {
		return nil, err
	}

	vendorKey := normalizeVendorName(in.Vendor)
	words := strings.Fields(strings.ToLower(in.Worker))
	var days []attendanceDay
	for _, d := range all {
		if in.Vendor != "" {
			label := groupLabel(d)
			switch {
			case strings.EqualFold(strings.TrimSpace(in.Vendor), noPTLabel):
				if label != noPTLabel {
					continue
				}
			case strings.EqualFold(strings.TrimSpace(in.Vendor), "internal"):
				if !isInternalLabel(label) {
					continue
				}
			case strings.EqualFold(strings.TrimSpace(in.Vendor), "vendor"):
				if isInternalLabel(label) {
					continue
				}
			case normalizeVendorName(label) != vendorKey:
				continue
			}
		}
		if len(words) > 0 {
			text := strings.ToLower(d.EmpCode + " " + d.Name + " " + d.Department)
			ok := true
			for _, w := range words {
				ok = ok && strings.Contains(text, w)
			}
			if !ok {
				continue
			}
		}
		days = append(days, d)
	}

	if in.GroupBy == "worker_day" {
		return attendanceWorkerDays(in, from, to, days), nil
	}

	type agg struct {
		key, name, empCode, kepala, keahlian, date, day  string
		department, position                             string
		workers                                          map[string]bool
		manDays, incomplete, worked, estimated, overtime int
	}
	groupBy := in.GroupBy
	if groupBy == "" {
		groupBy = "vendor"
	}
	groups := map[string]*agg{}
	total := agg{workers: map[string]bool{}}
	for _, d := range days {
		var key string
		switch groupBy {
		case "worker":
			key = d.EmpCode
		case "day":
			key = d.Date
		default:
			key = groupLabel(d)
		}
		g := groups[key]
		if g == nil {
			g = &agg{key: key, workers: map[string]bool{}}
			groups[key] = g
		}
		for _, a := range []*agg{g, &total} {
			a.workers[d.EmpCode] = true
			a.manDays++
			a.estimated += d.EstimatedMinutes
			a.overtime += d.OvertimeMinutes
			if d.WorkedMinutes != nil {
				a.worked += *d.WorkedMinutes
			} else {
				a.incomplete++
			}
		}
		g.name, g.empCode, g.kepala, g.keahlian = d.Name, d.EmpCode, d.KepalaSubkon, d.Keahlian
		g.department, g.position = d.Department, d.Position
		g.date, g.day = d.Date, d.Day
		if groupBy == "worker" {
			g.key = groupLabel(d) // the worker's vendor or department, shown below
		}
	}

	list := make([]*agg, 0, len(groups))
	for _, g := range groups {
		list = append(list, g)
	}
	metric := func(a *agg) int {
		switch in.Sort {
		case "overtime":
			return a.overtime
		case "incomplete":
			return a.incomplete
		}
		return a.estimated
	}
	sort.Slice(list, func(i, j int) bool {
		if groupBy == "day" && in.Sort == "" {
			return list[i].date < list[j].date
		}
		if mi, mj := metric(list[i]), metric(list[j]); mi != mj {
			return mi > mj
		}
		return list[i].key+list[i].empCode < list[j].key+list[j].empCode
	})
	limit := limitOr(in.Limit, 20, 100)

	showValue := HasResourcePermission(r, ResourceFinancialDashboard, "view")
	var approvals map[string][2]float64
	var woNames map[string]string
	var aliases map[string][]string
	if groupBy == "vendor" {
		woNames = woVendorNames()
		aliases = vendorAliases()
		if showValue {
			approvals = vendorApprovals(from.Format("2006-01-02"), to.Format("2006-01-02"))
		}
	}

	rows := []map[string]interface{}{}
	var noWO, viaHead []string
	for _, g := range list {
		row := map[string]interface{}{
			"workers": len(g.workers), "man_days": g.manDays, "incomplete_days": g.incomplete,
			"worked_hours": hours(g.worked), "hours_incl_estimates": hours(g.estimated), "overtime_hours": hours(g.overtime),
		}
		switch groupBy {
		case "worker":
			delete(row, "workers")
			row["emp_code"], row["name"], row["vendor"] = g.empCode, g.name, g.key
			if g.kepala != "" && g.kepala != "-" {
				row["kepala_subkon"] = g.kepala
			}
			if g.keahlian != "" {
				row["keahlian"] = g.keahlian
			}
			if g.position != "" {
				row["position"] = g.position
			}
		case "day":
			row["date"], row["hari"] = g.date, g.day
		default:
			row["vendor"] = g.key
			if g.key != noPTLabel && !isInternalLabel(g.key) {
				// The PT's own name, then its kepala vendor / subkon names:
				// a WO under any of them is that PT's work.
				key := normalizeVendorName(g.key)
				names := aliases[key]
				if len(names) == 0 {
					names = []string{key}
				}
				var wos []string
				var value, count float64
				for _, n := range names {
					wo, ok := woNames[n]
					if !ok {
						continue
					}
					wos = append(wos, wo)
					value += approvals[n][0]
					count += approvals[n][1]
					if n != key {
						viaHead = append(viaHead, g.key+" = "+wo)
					}
				}
				if len(wos) == 0 {
					noWO = append(noWO, g.key)
					break
				}
				row["wo_vendor"] = wos[0]
				if len(wos) > 1 {
					row["wo_vendors"] = wos
				}
				if showValue {
					row["wo_approved_value"], row["wo_approved_count"] = value, int(count)
					if g.estimated > 0 {
						row["value_per_hour"] = math.Round(value / (float64(g.estimated) / 60))
					}
				}
			}
		}
		if len(rows) < limit {
			rows = append(rows, row)
		}
	}

	notes := []string{
		"worked_hours dihitung dari absen masuk dan pulang yang ada; hours_incl_estimates menambahkan hari dengan satu absen " +
			"(masuk dianggap 08:00 atau pulang dianggap jam pulang standar, seperti Attendance Card). Absen sebelum 05:00 masuk shift hari sebelumnya. " +
			"Lembur: lebih dari 8 jam Senin-Jumat, 4 jam Sabtu, semua jam hari Minggu.",
	}
	if groupBy == "vendor" {
		if showValue {
			notes = append(notes, "wo_approved_value = nilai WO vendor itu yang di-approve pada periode yang sama (tanggal approval, bukan tanggal kerja); "+
				"value_per_hour = wo_approved_value / hours_incl_estimates. Ini perkiraan kasar produktivitas, bukan nilai pekerjaan per jam yang pasti.")
		}
		if len(viaHead) > 0 {
			sort.Strings(viaHead)
			notes = append(notes, "WO yang tercatat atas nama kepala vendor/subkon (dari MasterOperation) dihitung ke PT-nya: "+strings.Join(viaHead, "; ")+
				". wo_vendors berisi semua nama vendor WO untuk PT itu; pakai masing-masing di search_work_orders / billing_summary.")
		}
		if len(noWO) > 0 {
			sort.Strings(noWO)
			notes = append(notes, "Vendor tanpa WO di ShipHub (nama PT maupun kepala vendornya tidak sama dengan vendor WO mana pun): "+strings.Join(noWO, ", "))
		}
	}
	if g := groups[noPTLabel]; g != nil && groupBy == "vendor" {
		notes = append(notes, fmt.Sprintf("%d pekerja tanpa PT: emp_code mereka tidak ada di daftar anggota vendor (vendor_detail) maupun di Personal-Data, dan absennya tidak membawa nama PT.", len(g.workers)))
	}

	return map[string]interface{}{
		"period":   map[string]string{"from": from.Format("2006-01-02"), "to": to.Format("2006-01-02")},
		"group_by": groupBy,
		"totals": map[string]interface{}{
			"workers": len(total.workers), "man_days": total.manDays, "incomplete_days": total.incomplete,
			"worked_hours": hours(total.worked), "hours_incl_estimates": hours(total.estimated), "overtime_hours": hours(total.overtime),
		},
		"groups_total": len(list),
		"rows":         rows,
		"notes":        notes,
	}, nil
}

// attendanceWorkerDays: one row per worker per shift day with the actual
// check-in, check-out and every punch, for "what time did X come in".
func attendanceWorkerDays(in attendanceHoursInput, from, to time.Time, days []attendanceDay) map[string]interface{} {
	sort.SliceStable(days, func(i, j int) bool {
		if days[i].Date != days[j].Date {
			return days[i].Date < days[j].Date
		}
		if a, b := groupLabel(days[i]), groupLabel(days[j]); a != b {
			return a < b
		}
		return days[i].Name+days[i].EmpCode < days[j].Name+days[j].EmpCode
	})
	limit := limitOr(in.Limit, 50, 100)
	rows := []map[string]interface{}{}
	counts := map[string]int{}
	for _, d := range days {
		counts[d.Status]++
		if len(rows) == limit {
			continue
		}
		row := map[string]interface{}{
			"date": d.Date, "hari": d.Day, "emp_code": d.EmpCode, "name": d.Name, "vendor": groupLabel(d),
			"check_in": d.CheckIn, "check_out": d.CheckOut, "punch_times": d.PunchTimes, "status": d.Status,
			"hours_incl_estimates": hours(d.EstimatedMinutes), "overtime_hours": hours(d.OvertimeMinutes),
		}
		if d.WorkedMinutes != nil {
			row["worked_hours"] = hours(*d.WorkedMinutes)
		}
		if d.KepalaSubkon != "" && d.KepalaSubkon != "-" {
			row["kepala_subkon"] = d.KepalaSubkon
		}
		if d.Position != "" {
			row["position"] = d.Position
		}
		rows = append(rows, row)
	}
	out := map[string]interface{}{
		"period":   map[string]string{"from": from.Format("2006-01-02"), "to": to.Format("2006-01-02")},
		"group_by": "worker_day",
		"totals": map[string]interface{}{"days": len(days), "lengkap": counts["lengkap"],
			"tanpa_absen_pulang": counts["tanpa_absen_pulang"], "tanpa_absen_masuk": counts["tanpa_absen_masuk"]},
		"rows": rows,
		"notes": []string{"check_in = absen pertama, check_out = absen terakhir pada hari shift itu (absen sebelum 05:00 masuk shift hari sebelumnya). " +
			"Bila hanya ada satu absen, absen pagi (05:00-13:00) dianggap masuk dan check_out kosong; selain itu dianggap pulang. " +
			"punch_times berisi semua absen hari itu, apa adanya dari mesin; hours_incl_estimates memakai jam standar untuk absen yang hilang."},
	}
	if len(days) > len(rows) {
		out["note"] = fmt.Sprintf("menampilkan %d dari %d hari; persempit dengan worker, vendor atau tanggal", len(rows), len(days))
	}
	return out
}
