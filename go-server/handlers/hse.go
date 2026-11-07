package handlers

import (
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

// HSE menus: Work Permit (the MasterHSE workpermit tab, pushed by the
// spreadsheet source), Absensi (attendance punches, GetAttendanceDaily) and
// the HSE dashboard over both.

// ResourceHSEDashboard is the RBAC resource of the HSE dashboard menu; each
// part of it also needs its data permission (Data HSE, Data Absensi).
const ResourceHSEDashboard = "Dashboard HSE"

type workPermit struct {
	ID          string   `json:"id"`
	No          string   `json:"no_workpermit"`
	Category    string   `json:"category"`
	Status      string   `json:"status"`
	ProjectID   string   `json:"project_id"`
	Ship        string   `json:"shipname"`
	WO          string   `json:"wo"`
	Dept        string   `json:"dept"`
	Supervisor  string   `json:"supervisi"`
	Vendor      string   `json:"vendor"`
	Manpower    int      `json:"manpower"`
	Area        string   `json:"area_kerja"`
	Work        string   `json:"pekerjaan"`
	DateStart   string   `json:"date_start"`
	DateFinish  string   `json:"date_finish"`
	TimeStart   string   `json:"time_start"`
	TimeEnd     string   `json:"time_end"`
	Duration    int      `json:"duration_days"`
	Risks       []string `json:"risks"`    // wpclass_1: jenis pekerjaan berisiko
	Hazards     []string `json:"hazards"`  // wpclass_2
	Controls    []string `json:"controls"` // wpclass_3
	Tools       []string `json:"tools"`    // wpclass_4
	PPE         []string `json:"ppe"`      // wpclass_5
	Others      []string `json:"others"`   // wpclass_6
	Persons     []string `json:"persons"`  // person_list
	ProjectLead string   `json:"project_lead"`
	Safetyman   string   `json:"safetyman"`
	CreatedBy   string   `json:"created_by"`
	CreateDate  string   `json:"create_date"`
}

// sheetDate reads the spreadsheet's dates: "2024-06-04", "5/28/2024"
// (month first, as Google Sheets writes them) or a timestamp.
func sheetDate(v interface{}) string {
	s := strings.TrimSpace(cellString(v))
	if s == "" {
		return ""
	}
	for _, layout := range []string{"2006-01-02", "1/2/2006", "2006-01-02T15:04:05Z07:00", "2006-01-02 15:04:05", "1/2/2006 15:04:05", "02/01/2006"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.Format("2006-01-02")
		}
	}
	if len(s) >= 10 {
		if t, err := time.Parse("2006-01-02", s[:10]); err == nil {
			return t.Format("2006-01-02")
		}
	}
	return ""
}

// sheetList splits "Panas , Pengangkatan" into its items.
func sheetList(v interface{}) []string {
	out := []string{}
	for _, part := range strings.Split(cellString(v), ",") {
		if p := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(part), "…")); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func loadWorkPermits() ([]workPermit, error) {
	rows, err := loadExternalSheet("workpermit")
	if err != nil {
		return nil, err
	}
	out := make([]workPermit, 0, len(rows))
	for _, raw := range rows {
		row := map[string]interface{}{}
		for k, v := range raw {
			if !externalPersonalColumn.MatchString(k) {
				row[k] = v
			}
		}
		manpower, _ := strconv.Atoi(strings.TrimSpace(cellString(row["manpower"])))
		duration, _ := strconv.Atoi(strings.TrimSpace(cellString(row["durationWP"])))
		p := workPermit{
			No: cellString(row["no_workpermit"]), Category: strings.ToUpper(cellString(row["category"])), Status: cellString(row["status"]),
			ProjectID: cellString(row["project_id"]), Ship: cellString(row["shipname"]), WO: cellString(row["WO"]),
			Dept: cellString(row["bagian/dept"]), Supervisor: cellString(row["supervisi"]), Vendor: cellString(row["vendor"]),
			Manpower: manpower, Area: cellString(row["area_kerja"]), Work: cellString(row["pekerjaan"]),
			DateStart: sheetDate(row["date_start"]), DateFinish: sheetDate(row["date_finish"]),
			TimeStart: cellString(row["time_start"]), TimeEnd: cellString(row["time_end"]), Duration: duration,
			Risks: sheetList(row["wpclass_1"]), Hazards: sheetList(row["wpclass_2"]), Controls: sheetList(row["wpclass_3"]),
			Tools: sheetList(row["wpclass_4"]), PPE: sheetList(row["wpclass_5"]), Others: sheetList(row["wpclass_6"]),
			Persons: sheetList(row["person_list"]), ProjectLead: cellString(row["project_lead"]), Safetyman: cellString(row["safetyman"]),
			CreatedBy: cellString(row["created_by"]), CreateDate: sheetDate(row["create_date"]),
		}
		if p.Status == "" {
			p.Status = "Draft"
		}
		p.ID = p.No + "|" + cellString(row["no"])
		out = append(out, p)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].DateStart != out[j].DateStart {
			return out[i].DateStart > out[j].DateStart
		}
		return out[i].No > out[j].No
	})
	return out, nil
}

// activeOn: the permit covers the day (YYYY-MM-DD).
func (p workPermit) activeOn(day string) bool {
	if p.DateStart == "" || p.DateStart > day {
		return false
	}
	finish := p.DateFinish
	if finish == "" {
		finish = p.DateStart
	}
	return finish >= day
}

type countItem struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

func topCounts(m map[string]int, n int) []countItem {
	out := make([]countItem, 0, len(m))
	for k, v := range m {
		if k != "" {
			out = append(out, countItem{k, v})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Name < out[j].Name
	})
	if n > 0 && len(out) > n {
		out = out[:n]
	}
	return out
}

// GetWorkPermits lists work permits. Query: q (words in number, ship,
// project, vendor, area, work, supervisor), status, category, risk, vendor,
// area, from/to (permits overlapping the period), active (a day: permits
// covering it; "today"), page, limit (500 max; 5000 with all=1).
func GetWorkPermits(w http.ResponseWriter, r *http.Request) {
	permits, err := loadWorkPermits()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	q := r.URL.Query()
	words := strings.Fields(strings.ToLower(q.Get("q")))
	active := q.Get("active")
	if active == "today" {
		active = time.Now().Format("2006-01-02")
	}
	from, to := q.Get("from"), q.Get("to")
	statuses, categories, risks := map[string]int{}, map[string]int{}, map[string]int{}
	list := []workPermit{}
	manpower := 0
	for _, p := range permits {
		if len(words) > 0 {
			text := strings.ToLower(strings.Join([]string{p.No, p.Ship, p.ProjectID, p.WO, p.Vendor, p.Area, p.Work, p.Supervisor, p.Dept}, " "))
			ok := true
			for _, wd := range words {
				if !strings.Contains(text, wd) {
					ok = false
					break
				}
			}
			if !ok {
				continue
			}
		}
		if active != "" && !p.activeOn(active) {
			continue
		}
		if from != "" || to != "" {
			finish := p.DateFinish
			if finish == "" {
				finish = p.DateStart
			}
			if (to != "" && p.DateStart > to) || (from != "" && finish < from) {
				continue
			}
		}
		if v := q.Get("category"); v != "" && p.Category != v {
			continue
		}
		if v := q.Get("vendor"); v != "" && p.Vendor != v {
			continue
		}
		if v := q.Get("area"); v != "" && p.Area != v {
			continue
		}
		if v := q.Get("risk"); v != "" {
			found := false
			for _, x := range p.Risks {
				if x == v {
					found = true
				}
			}
			if !found {
				continue
			}
		}
		// Counts before the status and risk filters they describe would narrow them.
		statuses[p.Status]++
		if v := q.Get("status"); v != "" && p.Status != v {
			continue
		}
		categories[p.Category]++
		for _, x := range p.Risks {
			risks[x]++
		}
		manpower += p.Manpower
		list = append(list, p)
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	max := 500
	if q.Get("all") == "1" {
		max = 5000
	}
	if limit <= 0 || limit > max {
		limit = 50
	}
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	start := (page - 1) * limit
	if start > len(list) {
		start = len(list)
	}
	end := start + limit
	if end > len(list) {
		end = len(list)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"permits": list[start:end], "total": len(list), "page": page, "limit": limit, "manpower": manpower,
		"statuses": topCounts(statuses, 0), "categories": topCounts(categories, 0), "risks": topCounts(risks, 30),
	})
}

// GetWorkPermitFacets: vendors and areas for the filters.
func GetWorkPermitFacets(w http.ResponseWriter, r *http.Request) {
	permits, err := loadWorkPermits()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	vendors, areas := map[string]int{}, map[string]int{}
	for _, p := range permits {
		vendors[p.Vendor]++
		areas[p.Area]++
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"vendors": topCounts(vendors, 0), "areas": topCounts(areas, 0)})
}

// GetHSEDashboard: the HSE picture for one day (date, default today) and the
// weeks before it. Work permit parts need Data HSE, attendance parts Data
// Absensi; a part the user may not see is left out.
func GetHSEDashboard(w http.ResponseWriter, r *http.Request) {
	day := r.URL.Query().Get("date")
	d, err := time.Parse("2006-01-02", day)
	if err != nil {
		d, _ = time.Parse("2006-01-02", time.Now().Format("2006-01-02"))
		day = d.Format("2006-01-02")
	}
	out := map[string]interface{}{"date": day}

	if HasResourcePermission(r, ResourceDataHSE, "view") {
		permits, err := loadWorkPermits()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		status, risks, areas, vendors := map[string]int{}, map[string]int{}, map[string]int{}, map[string]int{}
		active, approved, manpower := 0, 0, 0
		monthly := map[string]int{}
		yearAgo := d.AddDate(-1, 0, 1).Format("2006-01")
		for _, p := range permits {
			if len(p.DateStart) >= 7 && p.DateStart[:7] >= yearAgo && p.DateStart <= day {
				monthly[p.DateStart[:7]]++
			}
			if !p.activeOn(day) {
				continue
			}
			active++
			status[p.Status]++
			if p.Status != "Approved" {
				continue
			}
			approved++
			manpower += p.Manpower
			areas[p.Area]++
			vendors[p.Vendor]++
			for _, x := range p.Risks {
				risks[x]++
			}
		}
		months := []map[string]interface{}{}
		for m := d.AddDate(0, -11, 0); !m.After(d); m = m.AddDate(0, 1, 0) {
			key := m.Format("2006-01")
			months = append(months, map[string]interface{}{"month": key, "count": monthly[key]})
		}
		out["permits"] = map[string]interface{}{
			"active": active, "approved": approved, "not_approved": active - approved, "manpower": manpower,
			"status": topCounts(status, 0), "risks": topCounts(risks, 10), "areas": topCounts(areas, 10), "vendors": topCounts(vendors, 10),
			"monthly": months,
		}
	}

	if HasResourcePermission(r, ResourceDataAttendance, "view") {
		from := d.AddDate(0, 0, -29)
		days, err := loadAttendanceDays(from, d, map[string]string{}, attendanceRules{WeekdayHours: 8, SaturdayHours: 4})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		perDate := map[string]map[string]bool{}
		todayPT := map[string]int{}
		present, incomplete, overtime := 0, 0, 0
		var minutes int
		for _, a := range days {
			if perDate[a.Date] == nil {
				perDate[a.Date] = map[string]bool{}
			}
			perDate[a.Date][a.EmpCode] = true
			if a.Date != day {
				continue
			}
			present++
			minutes += a.EstimatedMinutes
			if a.Status != "lengkap" {
				incomplete++
			}
			if a.WorkedMinutes != nil && a.OvertimeMinutes > 0 { // measured, not estimated
				overtime++
			}
			todayPT[attendanceGroupLabel(a, noPTLabel)]++
		}
		trend := []map[string]interface{}{}
		for x := from; !x.After(d); x = x.AddDate(0, 0, 1) {
			key := x.Format("2006-01-02")
			trend = append(trend, map[string]interface{}{"date": key, "workers": len(perDate[key])})
		}
		out["attendance"] = map[string]interface{}{
			"present": present, "incomplete": incomplete, "with_overtime": overtime, "hours": hours(minutes),
			"vendors": topCounts(todayPT, 10), "daily": trend,
		}
	}
	writeJSON(w, http.StatusOK, out)
}
