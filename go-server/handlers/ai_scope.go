package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"shipyard/db"
)

// Scope and period chosen above the AI Asisten question box, and the
// "Perlu perhatian hari ini" counts shown beside it.

type aiScope struct {
	Key, Label string
	Tools      []string // tools offered for this scope
	Hint       string   // what to read, for the model
}

var aiScopes = []aiScope{
	{Key: "wo", Label: "Work Order dan tagihan", Tools: []string{"search_work_orders", "get_work_order", "billing_summary", "search_work_items", "price_reference", "data_findings", "unrecognized_activities", "job_order_margin", "repair_list", "marketing_price_reference"},
		Hint: "Work Order, item pekerjaan, tagihan, harga acuan, repair list dan data perlu dicek"},
	{Key: "project", Label: "Job Order", Tools: []string{"query_app_data", "search_work_orders", "repair_list", "job_order_margin", "marketing_price_reference"},
		Hint: "repair list setiap Job Order lewat repair_list, harga penawaran per Job Order dan margin lewat job_order_margin, harga acuan penawaran per jenis pekerjaan lewat marketing_price_reference, serta job_orders, mo_projects, mo_progress, mo_wbs dan locations lewat query_app_data"},
	{Key: "material", Label: "Material", Tools: []string{"query_app_data"},
		Hint: "material_stock, material_purchases, material_usages, material_master, material_requests dan components lewat query_app_data"},
	{Key: "manpower", Label: "Manpower dan absensi", Tools: []string{"attendance_hours", "query_app_data"},
		Hint: "attendance_hours, serta mo_vendor_heads, mo_vendor_members, mo_manpower_plan dan mo_manpower_updates lewat query_app_data"},
	{Key: "hse", Label: "HSE", Tools: []string{"query_app_data"},
		Hint: "hse_work_permits lewat query_app_data"},
}

func findAIScope(key string) *aiScope {
	for i := range aiScopes {
		if aiScopes[i].Key == key {
			return &aiScopes[i]
		}
	}
	return nil
}

// scopeTools keeps the tools of the scope (all when no scope is chosen).
func scopeTools(tools []aiTool, scope *aiScope) []aiTool {
	if scope == nil {
		return tools
	}
	keep := map[string]bool{}
	for _, n := range scope.Tools {
		keep[n] = true
	}
	var out []aiTool
	for _, t := range tools {
		if keep[t.Name] {
			out = append(out, t)
		}
	}
	return out
}

// aiPeriod turns a period key into its label and dates (WIB).
func aiPeriod(key string, now time.Time) (label, from, to string, ok bool) {
	if loc, err := time.LoadLocation("Asia/Jakarta"); err == nil {
		now = now.In(loc)
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	day := func(t time.Time) string { return t.Format("2006-01-02") }
	month := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, today.Location())
	switch key {
	case "today":
		return "Hari ini", day(today), day(today), true
	case "this_week":
		monday := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7))
		return "Minggu ini", day(monday), day(monday.AddDate(0, 0, 6)), true
	case "this_month":
		return "Bulan ini", day(month), day(month.AddDate(0, 1, -1)), true
	case "last_month":
		prev := month.AddDate(0, -1, 0)
		return "Bulan lalu", day(prev), day(month.AddDate(0, 0, -1)), true
	case "last_3_months":
		return "3 bulan terakhir", day(month.AddDate(0, -2, 0)), day(month.AddDate(0, 1, -1)), true
	case "this_year":
		year := time.Date(today.Year(), 1, 1, 0, 0, 0, 0, today.Location())
		return "Tahun ini", day(year), day(year.AddDate(1, 0, -1)), true
	}
	return "", "", "", false
}

// aiFocusNote is put next to the question when a scope or period is chosen.
func aiFocusNote(scope *aiScope, periodKey string, now time.Time) string {
	var parts []string
	if scope != nil {
		parts = append(parts, "Cakupan dipilih pengguna: "+scope.Label+" (baca "+scope.Hint+")")
	}
	if label, from, to, ok := aiPeriod(periodKey, now); ok {
		parts = append(parts, "Periode dipilih pengguna: "+label+" ("+from+" s.d. "+to+"); pakai periode ini kecuali pertanyaan menyebut periode lain")
	}
	return strings.Join(parts, ". ")
}

type aiInsight struct {
	Key      string  `json:"key"`
	Label    string  `json:"label"`
	Count    int     `json:"count"`
	Value    float64 `json:"value,omitempty"` // rupiah, when the item is a sum
	Tone     string  `json:"tone"`            // danger, warning, neutral
	Question string  `json:"question"`
	Link     string  `json:"link"`
	// Display replaces the badge (count or rupiah), e.g. "128 jam"; Detail is
	// the line under the label, e.g. "minggu lalu Rp 1,2 M".
	Display string `json:"display,omitempty"`
	Detail  string `json:"detail,omitempty"`
}

// GetAIInsights counts what needs attention today, straight from the
// database (no AI call), each only when the user may open its page.
func GetAIInsights(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	if loc, err := time.LoadLocation("Asia/Jakarta"); err == nil {
		now = now.In(loc)
	}
	today := now.Format("2006-01-02")
	insights := []aiInsight{}
	add := func(i aiInsight) {
		if i.Count > 0 {
			insights = append(insights, i)
		}
	}

	// This week: Monday to today; last week: the Monday to Sunday before.
	weekStart := now.AddDate(0, 0, -((int(now.Weekday()) + 6) % 7))
	weekFrom := weekStart.Format("2006-01-02")
	lastFrom, lastTo := weekStart.AddDate(0, 0, -7).Format("2006-01-02"), weekStart.AddDate(0, 0, -1).Format("2006-01-02")
	jasaThis, jasaLast, jasaWOs := 0.0, 0.0, 0
	seeJasa := HasResourcePermission(r, ResourceFinancialDashboard, "view")
	if seeJasa {
		db.QueryRow(`SELECT COUNT(DISTINCT wo_id), COALESCE(SUM(approved_cost), 0) FROM work_order_daily_costs WHERE SUBSTR(cost_date, 1, 10) BETWEEN ? AND ?`,
			weekFrom, today).Scan(&jasaWOs, &jasaThis)
		db.QueryRow(`SELECT COALESCE(SUM(approved_cost), 0) FROM work_order_daily_costs WHERE SUBSTR(cost_date, 1, 10) BETWEEN ? AND ?`,
			lastFrom, lastTo).Scan(&jasaLast)
	}

	// Jasa (WO costs approved) and material (stock used) on projects this week.
	seeMaterial := HasResourcePermission(r, ResourceInventory, "view")
	if seeJasa || seeMaterial {
		material, materialProjects := 0.0, 0
		if seeMaterial {
			db.QueryRow(`SELECT COALESCE(SUM(biaya_fifo), 0), COUNT(DISTINCT proyek) FROM inv_usages WHERE SUBSTR(CAST(tanggal AS TEXT), 1, 10) BETWEEN ? AND ?`,
				weekFrom, today).Scan(&material, &materialProjects)
		}
		var parts []string
		if seeJasa {
			parts = append(parts, "jasa "+shortRupiah(jasaThis))
		}
		if seeMaterial {
			parts = append(parts, fmt.Sprintf("material %s (%d proyek)", shortRupiah(material), materialProjects))
		}
		total := material + jasaThis
		add(aiInsight{Key: "usage_week", Label: "Pemakaian jasa & material proyek minggu ini", Count: boolCount(total > 0), Value: total,
			Display: shortRupiah(total), Detail: strings.Join(parts, " · "), Tone: "neutral",
			Question: "Berapa pemakaian jasa (biaya WO yang di-approve) dan material di proyek minggu ini? Rinci per proyek, urutkan dari yang terbesar."})
	}

	if seeJasa {
		detail := "minggu lalu " + shortRupiah(jasaLast)
		if jasaLast > 0 {
			detail += fmt.Sprintf(" (%+.0f%%)", (jasaThis-jasaLast)/jasaLast*100)
		}
		add(aiInsight{Key: "jasa_week", Label: "Cost jasa di-approve minggu ini", Count: boolCount(jasaThis > 0 || jasaLast > 0), Value: jasaThis,
			Display: shortRupiah(jasaThis), Detail: fmt.Sprintf("%d WO · %s", jasaWOs, detail), Tone: "neutral", Link: "/financial-dashboard",
			Question: "Berapa cost jasa (WO) yang di-approve minggu ini dibanding minggu lalu? Rinci per vendor dan proyek."})
	}

	if HasResourcePermission(r, ResourceDataAttendance, "view") {
		if days, err := loadAttendanceDays(shiftDay(weekStart), shiftDay(now), map[string]string{}, attendanceRules{WeekdayHours: 8, SaturdayHours: 4}); err == nil {
			workers, overtimeWorkers, todayWorkers := map[string]bool{}, map[string]bool{}, map[string]bool{}
			perDay := map[string]int{}
			overtime := 0
			for _, d := range days {
				workers[d.EmpCode] = true
				perDay[d.Date]++
				if d.Date == today {
					todayWorkers[d.EmpCode] = true
				}
				// Measured overtime only: a day without its check-out is an estimate.
				if d.WorkedMinutes != nil && d.OvertimeMinutes > 0 {
					overtime += d.OvertimeMinutes
					overtimeWorkers[d.EmpCode] = true
				}
			}
			add(aiInsight{Key: "overtime_week", Label: "Overtime minggu ini", Count: boolCount(overtime > 0), Display: formatHours(overtime) + " jam",
				Detail: fmt.Sprintf("%d orang lembur, dari absen lengkap", len(overtimeWorkers)), Tone: "warning", Link: "/hse/attendance?tab=vendors",
				Question: "Berapa jam overtime pekerja minggu ini? Rinci per vendor dan sebutkan pekerja dengan lembur terbanyak."})
			avg := 0
			if len(perDay) > 0 {
				sum := 0
				for _, n := range perDay {
					sum += n
				}
				avg = sum / len(perDay)
			}
			add(aiInsight{Key: "workers_week", Label: "Jumlah pekerja minggu ini", Count: len(workers), Display: fmt.Sprintf("%d orang", len(workers)),
				Detail: fmt.Sprintf("hari ini %d · rata-rata %d orang per hari", len(todayWorkers), avg), Tone: "neutral", Link: "/hse/attendance?tab=dates",
				Question: "Berapa jumlah pekerja yang hadir minggu ini per hari dan per vendor? Bandingkan dengan minggu lalu."})
		}
	}

	latest := aiLatestToday(r, now)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"date": today, "insights": insights, "latest": latest})
}

// GetAIScopes lists the scopes and periods for the question box.
func GetAIScopes(w http.ResponseWriter, r *http.Request) {
	available := map[string]bool{}
	for _, t := range availableAITools(r) {
		available[t.Name] = true
	}
	scopes := []map[string]string{}
	for _, s := range aiScopes {
		for _, n := range s.Tools {
			if available[n] {
				scopes = append(scopes, map[string]string{"key": s.Key, "label": s.Label})
				break
			}
		}
	}
	periods := []map[string]string{}
	for _, k := range []string{"today", "this_week", "this_month", "last_month", "last_3_months", "this_year"} {
		label, from, to, _ := aiPeriod(k, time.Now())
		periods = append(periods, map[string]string{"key": k, "label": label, "from": from, "to": to})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"scopes": scopes, "periods": periods})
}

// aiLatestToday: what is new today (WIB), each only with view rights on its
// page. Dates are compared on their first 10 characters (YYYY-MM-DD).
func aiLatestToday(r *http.Request, now time.Time) []aiInsight {
	today := now.Format("2006-01-02")
	latest := []aiInsight{}
	add := func(i aiInsight) {
		if i.Count > 0 {
			latest = append(latest, i)
		}
	}
	count := func(query string, args ...interface{}) int {
		var n int
		db.QueryRow(query, args...).Scan(&n)
		return n
	}

	if HasResourcePermission(r, "Work Order", "view") {
		add(aiInsight{Key: "new_wo", Label: "WO baru masuk", Tone: "neutral", Link: "/work-order",
			Count:    count(`SELECT COUNT(*) FROM work_order_summary WHERE SUBSTR(COALESCE(created_source_at, ''), 1, 10) = ?`, today),
			Question: "WO apa saja yang baru masuk hari ini? Sebutkan kapal, vendor dan nilainya."})
	}
	if HasResourcePermission(r, ResourceFinancialDashboard, "view") {
		var n int
		var value float64
		db.QueryRow(`SELECT COUNT(DISTINCT wo_id), COALESCE(SUM(approved_cost), 0) FROM work_order_daily_costs WHERE SUBSTR(cost_date, 1, 10) = ?`, today).Scan(&n, &value)
		add(aiInsight{Key: "approved_today", Label: "Nilai WO di-approve", Count: n, Value: value, Tone: "neutral", Link: "/financial-dashboard",
			Question: "WO apa saja yang di-approve hari ini dan berapa nilainya per vendor?"})
	}
	if HasResourcePermission(r, ResourceItemFindings, "view") {
		add(aiInsight{Key: "new_findings", Label: "Temuan harga baru", Tone: "danger", Link: "/data-findings",
			Count:    count(`SELECT COUNT(*) FROM wo_item_findings WHERE status = 'open' AND SUBSTR(COALESCE(first_seen, ''), 1, 10) = ?`, today),
			Question: "Item apa saja yang hari ini baru terdeteksi di atas harga acuan? Urutkan dari kelebihan terbesar."})
	}
	if HasResourcePermission(r, ResourceInventory, "view") {
		add(aiInsight{Key: "material_today", Label: "Pembelian dan pemakaian material", Tone: "neutral", Link: "/material-stock",
			Count: count(`SELECT (SELECT COUNT(*) FROM inv_purchases WHERE SUBSTR(CAST(tanggal AS TEXT), 1, 10) = ?) +
				(SELECT COUNT(*) FROM inv_usages WHERE SUBSTR(CAST(tanggal AS TEXT), 1, 10) = ?)`, today, today),
			Question: "Material apa saja yang dibeli dan dipakai hari ini, untuk proyek apa?"})
	}
	if HasResourcePermission(r, ResourceDataAttendance, "view") {
		if days, err := loadAttendanceDays(shiftDay(now), shiftDay(now), map[string]string{}, attendanceRules{WeekdayHours: 8, SaturdayHours: 4}); err == nil {
			perVendor := map[string]int{}
			for _, d := range days {
				perVendor[attendanceGroupLabel(d, noPTLabel)]++
			}
			var top []string
			for _, c := range topCounts(perVendor, 3) {
				top = append(top, fmt.Sprintf("%s %d", c.Name, c.Count))
			}
			add(aiInsight{Key: "present_today", Label: "Pekerja hadir hari ini", Count: len(days), Detail: strings.Join(top, " · "), Tone: "neutral",
				Link: "/hse/attendance", Question: "Berapa pekerja yang hadir hari ini per vendor? Siapa saja yang belum absen pulang?"})
		}
	}
	if HasResourcePermission(r, ResourceDataHSE, "view") {
		// Sheet dates in either format ("2026-11-07", "11/7/2026") via loadWorkPermits.
		if permits, err := loadWorkPermits(); err == nil {
			started, active, approved, manpower := 0, 0, 0, 0
			for _, p := range permits {
				if p.DateStart == today {
					started++
				}
				if p.activeOn(today) {
					active++
					if p.Status == "Approved" {
						approved++
						manpower += p.Manpower
					}
				}
			}
			detail := fmt.Sprintf("%d manpower di izin approved", manpower)
			if active > approved {
				detail += fmt.Sprintf(" · %d belum approved", active-approved)
			}
			add(aiInsight{Key: "permits_active", Label: "Izin kerja aktif hari ini", Count: active, Detail: detail, Tone: "neutral", Link: "/hse/work-permits?active=" + today,
				Question: "Izin kerja apa saja yang berlaku hari ini? Sebutkan vendor, kapal, area, jenis pekerjaan berisiko dan statusnya."})
			add(aiInsight{Key: "permits_today", Label: "Izin kerja mulai hari ini", Count: started, Tone: "neutral",
				Question: "Izin kerja apa saja yang mulai hari ini? Sebutkan vendor, kapal, area dan jenis pekerjaannya."})
		}
	}
	if HasResourcePermission(r, ResourceRepairList, "view") {
		var fresh, extra int
		db.QueryRow(`SELECT COALESCE(SUM(CASE WHEN change_kind = 'baru' THEN 1 ELSE 0 END), 0), COALESCE(SUM(CASE WHEN change_kind = 'tambahan' THEN 1 ELSE 0 END), 0)
			FROM jo_repair_lists WHERE SUBSTR(COALESCE(changed_at, ''), 1, 10) = ? AND COALESCE(error, '') = ''`, today).Scan(&fresh, &extra)
		add(aiInsight{Key: "repair_lists_today", Label: "Repair list baru / tambahan", Count: fresh + extra,
			Detail: fmt.Sprintf("%d Job Order baru · %d dapat versi tambahan", fresh, extra), Tone: "neutral", Link: "/repair-list",
			Question: "Job Order mana saja yang hari ini mendapat repair list baru atau repair list tambahan? Sebutkan kapal, versi dan nilainya."})
	}
	if HasResourcePermission(r, "Work Order", "view") {
		var items, wos int
		db.QueryRow(`SELECT COUNT(*), COUNT(DISTINCT i.wo_id) FROM wo_items i JOIN work_order_summary s ON s.wo_id = i.wo_id
			WHERE SUBSTR(COALESCE(s.created_source_at, ''), 1, 10) = ?`, today).Scan(&items, &wos)
		add(aiInsight{Key: "wo_items_today", Label: "Item WO baru", Count: items, Detail: fmt.Sprintf("dari %d WO baru", wos), Tone: "neutral", Link: "/work-order-items",
			Question: "Item pekerjaan apa saja yang masuk hari ini dari WO baru? Kelompokkan per jenis pekerjaan dan vendor."})
	}
	return latest
}

// shiftDay is the calendar day of t as loadAttendanceDays takes it (midnight,
// wall clock): passing the current time would leave out the morning's punches.
func shiftDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// boolCount turns "has something to show" into the count add() checks.
func boolCount(ok bool) int {
	if ok {
		return 1
	}
	return 0
}

// formatHours: minutes as hours with one decimal, Indonesian style ("12,5").
func formatHours(minutes int) string {
	return strings.Replace(fmt.Sprintf("%.1f", float64(minutes)/60), ".", ",", 1)
}

// shortRupiah: "Rp 1,2 M", "Rp 350 jt", "Rp 12 rb".
func shortRupiah(v float64) string {
	abs := v
	if abs < 0 {
		abs = -abs
	}
	var s string
	switch {
	case abs >= 1e9:
		s = strings.Replace(fmt.Sprintf("%.1f M", v/1e9), ".", ",", 1)
	case abs >= 1e6:
		s = fmt.Sprintf("%.0f jt", v/1e6)
	case abs >= 1e3:
		s = fmt.Sprintf("%.0f rb", v/1e3)
	default:
		s = fmt.Sprintf("%.0f", v)
	}
	return "Rp " + s
}
