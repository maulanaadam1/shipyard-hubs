package handlers

import (
	"encoding/json"
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
	{Key: "wo", Label: "Work Order dan tagihan", Tools: []string{"search_work_orders", "get_work_order", "billing_summary", "search_work_items", "price_reference", "data_findings", "unrecognized_activities"},
		Hint: "Work Order, item pekerjaan, tagihan, harga acuan dan data perlu dicek"},
	{Key: "project", Label: "Job Order dan docking", Tools: []string{"query_app_data", "search_work_orders"},
		Hint: "job_orders, ship_movements, mo_projects, mo_progress, mo_wbs, locations dan dock_statuses lewat query_app_data"},
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
	Key      string `json:"key"`
	Label    string `json:"label"`
	Count    int    `json:"count"`
	Tone     string `json:"tone"` // danger, warning, neutral
	Question string `json:"question"`
	Link     string `json:"link"`
}

// GetAIInsights counts what needs attention today, straight from the
// database (no AI call), each only when the user may open its page.
func GetAIInsights(w http.ResponseWriter, r *http.Request) {
	now := time.Now()
	if loc, err := time.LoadLocation("Asia/Jakarta"); err == nil {
		now = now.In(loc)
	}
	today := now.Format("2006-01-02")
	tomorrow := now.AddDate(0, 0, 1).Format("2006-01-02")
	insights := []aiInsight{}
	add := func(i aiInsight) {
		if i.Count > 0 {
			insights = append(insights, i)
		}
	}

	if HasResourcePermission(r, ResourceItemFindings, "view") {
		var n int
		db.QueryRow(`SELECT COUNT(*) FROM wo_item_findings WHERE status = 'open'`).Scan(&n)
		add(aiInsight{Key: "findings", Label: "Item harga di atas acuan", Count: n, Tone: "danger",
			Question: "Item pekerjaan apa saja yang harganya jauh di atas harga acuan dan belum dicek? Urutkan dari kelebihan terbesar.", Link: "/data-findings"})
	}
	if HasResourcePermission(r, ResourceInventory, "view") {
		var n int
		db.QueryRow(`SELECT COUNT(*) FROM inv_stock WHERE status IN ('PESAN ULANG', 'STOK NEGATIF')`).Scan(&n)
		add(aiInsight{Key: "stock", Label: "Material perlu dipesan ulang", Count: n, Tone: "warning",
			Question: "Material apa saja yang statusnya PESAN ULANG atau STOK NEGATIF? Tampilkan per gudang.", Link: "/material-stock"})
	}
	if HasResourcePermission(r, ResourceIngestSources, "view") {
		n := 0
		if rows, err := loadExternalSheet("workpermit"); err == nil {
			for _, row := range rows {
				finish := strings.TrimSpace(aiDataText(row["date_finish"]))
				if len(finish) >= 10 {
					finish = finish[:10]
				}
				if finish == today || finish == tomorrow {
					n++
				}
			}
		}
		add(aiInsight{Key: "permits", Label: "Izin kerja berakhir hari ini atau besok", Count: n, Tone: "warning",
			Question: "Izin kerja (work permit) mana saja yang berakhir hari ini atau besok? Sebutkan vendor, kapal, area dan pekerjaannya."})
	}
	if HasResourcePermission(r, "Work Order", "view") {
		var n int
		db.QueryRow(`SELECT COUNT(*) FROM work_order_summary WHERE derived_status = 'Waiting' AND COALESCE(created_source_at, '') <> '' AND created_source_at < ?`,
			now.AddDate(0, 0, -30).Format("2006-01-02")).Scan(&n)
		add(aiInsight{Key: "waiting", Label: "WO Waiting lebih dari 30 hari", Count: n, Tone: "neutral",
			Question: "WO mana saja yang masih Waiting lebih dari 30 hari? Tampilkan nilai dan vendornya, urutkan dari yang terlama.", Link: "/work-order"})
	}
	if HasResourcePermission(r, "Job Order", "view") {
		var n int
		db.QueryRow(`SELECT COUNT(*) FROM projects WHERE SUBSTR(COALESCE(est_docking_date, ''), 1, 10) BETWEEN ? AND ?`,
			today, now.AddDate(0, 0, 7).Format("2006-01-02")).Scan(&n)
		add(aiInsight{Key: "docking", Label: "Kapal rencana docking 7 hari ke depan", Count: n, Tone: "neutral",
			Question: "Kapal apa saja yang rencana docking dalam 7 hari ke depan, di lokasi mana?", Link: "/ship-docking"})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"date": today, "insights": insights})
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
