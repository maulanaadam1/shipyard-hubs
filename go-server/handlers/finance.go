package handlers

import (
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"shipyard/db"
)

// ResourceFinancialDashboard is the RBAC resource of the Financial Dashboard menu.
const ResourceFinancialDashboard = "Financial Dashboard"

const noShipLabel = "Tanpa Proyek"

// financeRow is one billing transaction: the cost of one WO approved on one
// day, from work_order_daily_costs. PreviousCost is what the same WO had
// approved before that day.
type financeRow struct {
	WOID         string  `json:"id"`
	Date         string  `json:"latest_date"`
	Cost         float64 `json:"final_cost"`
	PreviousCost float64 `json:"previous_cost"`
	WOCode       string  `json:"wo_code"`
	JOCode       string  `json:"jo_code"`
	ProjectName  string  `json:"project_name"`
	ShipName     string  `json:"ship_name"`
	VendorName   string  `json:"vendor_name"`
	Status       string  `json:"derived_status"`
	WOFinalCost  float64 `json:"wo_final_cost"`
	CreatedAt    string  `json:"created_at"`
}

type financeAmount struct {
	Label      string  `json:"label"`
	Cost       float64 `json:"cost"`
	Percentage float64 `json:"percentage,omitempty"`
}

type financeTrendPoint struct {
	Period string  `json:"period"`
	Cost   float64 `json:"cost"`
}

// financeBucket is the start of the day, week or month a date falls in. Weeks
// start on Saturday, the billing week this dashboard has always used.
func financeBucket(date, group string) string {
	t, err := time.Parse("2006-01-02", dateOnly(date))
	if err != nil {
		return ""
	}
	switch group {
	case "month":
		return t.Format("2006-01") + "-01"
	case "week":
		return t.AddDate(0, 0, -((int(t.Weekday()) + 1) % 7)).Format("2006-01-02")
	}
	return t.Format("2006-01-02")
}

// financeRange turns a date preset into an inclusive [start, end] range,
// counted back from latest (the newest approval date). Empty means open.
func financeRange(q url.Values, latest string) (string, string) {
	preset := q.Get("preset")
	if preset == "custom" {
		return strings.TrimSpace(q.Get("start")), strings.TrimSpace(q.Get("end"))
	}
	end, err := time.Parse("2006-01-02", latest)
	if err != nil || preset == "" || preset == "all" {
		return "", ""
	}
	start := end
	switch preset {
	case "1week":
		start = end.AddDate(0, 0, -6)
	case "2weeks":
		start = end.AddDate(0, 0, -13)
	case "3weeks":
		start = end.AddDate(0, 0, -20)
	case "1month":
		start = end.AddDate(0, -1, 0)
	case "2months":
		start = end.AddDate(0, -2, 0)
	case "3months":
		start = end.AddDate(0, -3, 0)
	case "6months":
		start = end.AddDate(0, -6, 0)
	default:
		return "", ""
	}
	return start.Format("2006-01-02"), end.Format("2006-01-02")
}

func financeLabel(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

// GetFinanceSummary serves the Financial Dashboard from the derived WO tables:
// every approval day of every WO is one billing transaction, so the totals,
// the trend and the per-vendor and per-ship splits all add up to the same
// approved costs as the Work Order dashboard.
//
// Query: year, ship, vendor, status (main filters); preset (all, 1week ...
// 6months, custom with start/end); group (day, week, month); pick_period,
// pick_vendor, pick_ship (cross-filters from clicking a chart); sort, dir,
// page, limit for the transaction table.
func GetFinanceSummary(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	group := q.Get("group")
	if group != "week" && group != "month" {
		group = "day"
	}

	var latest, lastSync string
	db.QueryRow(`SELECT COALESCE(MAX(cost_date), '') FROM work_order_daily_costs WHERE approved_cost <> 0`).Scan(&latest)
	db.QueryRow(`SELECT COALESCE(last_sync, '') FROM sync_configs WHERE id = 'WorkOrders'`).Scan(&lastSync)

	where := []string{"l.approved_cost <> 0"}
	args := []interface{}{}
	if year := strings.TrimSpace(q.Get("year")); year != "" && year != "all" {
		where = append(where, "l.cost_date LIKE ?")
		args = append(args, year+"%")
	}
	if ship := strings.TrimSpace(q.Get("ship")); ship == noShipLabel {
		where = append(where, "COALESCE(s.ship_name, '') = ''")
	} else if ship != "" && ship != "all" {
		where = append(where, "s.ship_name = ?")
		args = append(args, ship)
	}
	if vendor := strings.TrimSpace(q.Get("vendor")); vendor == noVendorLabel {
		where = append(where, "COALESCE(s.vendor_name, '') = ''")
	} else if vendor != "" && vendor != "all" {
		where = append(where, "s.vendor_name = ?")
		args = append(args, vendor)
	}
	if status := strings.TrimSpace(q.Get("status")); status != "" && status != "all" {
		where = append(where, "s.derived_status = ?")
		args = append(args, status)
	}
	start, end := financeRange(q, latest)
	if start != "" {
		where = append(where, "l.cost_date >= ?")
		args = append(args, start)
	}
	if end != "" {
		where = append(where, "l.cost_date <= ?")
		args = append(args, end)
	}

	// PreviousCost runs over the WO's whole history, before any date filter.
	rows, err := db.Query(`
		WITH l AS (
			SELECT wo_id, cost_date, approved_cost,
				COALESCE(SUM(approved_cost) OVER (PARTITION BY wo_id ORDER BY cost_date
					ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS previous_cost
			FROM work_order_daily_costs
		)
		SELECT l.wo_id, l.cost_date, l.approved_cost, l.previous_cost,
			COALESCE(s.wo_code, ''), COALESCE(s.jo_code, ''), COALESCE(s.project_name, ''), COALESCE(s.ship_name, ''),
			COALESCE(s.vendor_name, ''), COALESCE(s.derived_status, ''), COALESCE(s.final_cost, 0), COALESCE(s.created_source_at, '')
		FROM l JOIN work_order_summary s ON s.wo_id = l.wo_id
		WHERE `+strings.Join(where, " AND "), args...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	pickPeriod, pickVendor, pickShip := q.Get("pick_period"), q.Get("pick_vendor"), q.Get("pick_ship")
	var picked []financeRow
	for rows.Next() {
		var f financeRow
		if rows.Scan(&f.WOID, &f.Date, &f.Cost, &f.PreviousCost, &f.WOCode, &f.JOCode, &f.ProjectName, &f.ShipName,
			&f.VendorName, &f.Status, &f.WOFinalCost, &f.CreatedAt) != nil {
			continue
		}
		f.VendorName = financeLabel(f.VendorName, noVendorLabel)
		f.ShipName = financeLabel(f.ShipName, noShipLabel)
		if (pickPeriod != "" && financeBucket(f.Date, group) != pickPeriod) ||
			(pickVendor != "" && f.VendorName != pickVendor) || (pickShip != "" && f.ShipName != pickShip) {
			continue
		}
		picked = append(picked, f)
	}
	rows.Close()

	var total float64
	wos, jos := map[string]bool{}, map[string]bool{}
	trend, vendors, ships := map[string]float64{}, map[string]float64{}, map[string]float64{}
	for _, f := range picked {
		total += f.Cost
		wos[f.WOID] = true
		if f.JOCode != "" && f.JOCode != "N/A" {
			jos[f.JOCode] = true
		}
		if b := financeBucket(f.Date, group); b != "" {
			trend[b] += f.Cost
		}
		vendors[f.VendorName] += f.Cost
		ships[f.ShipName] += f.Cost
	}
	trendList := make([]financeTrendPoint, 0, len(trend))
	for period, cost := range trend {
		trendList = append(trendList, financeTrendPoint{period, cost})
	}
	sort.Slice(trendList, func(i, j int) bool { return trendList[i].Period < trendList[j].Period })
	amounts := func(m map[string]float64, withShare bool) []financeAmount {
		list := make([]financeAmount, 0, len(m))
		for label, cost := range m {
			a := financeAmount{Label: label, Cost: cost}
			if withShare && total > 0 {
				a.Percentage = cost / total * 100
			}
			list = append(list, a)
		}
		sort.Slice(list, func(i, j int) bool {
			if list[i].Cost != list[j].Cost {
				return list[i].Cost > list[j].Cost
			}
			return list[i].Label < list[j].Label
		})
		return list
	}

	sortFinanceRows(picked, q.Get("sort"), q.Get("dir") == "asc")
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 10
	}
	from := (page - 1) * limit
	if from > len(picked) {
		from = len(picked)
	}
	to := from + limit
	if to > len(picked) {
		to = len(picked)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"latest_date": latest,
		"last_sync":   lastSync,
		"range":       map[string]string{"start": start, "end": end},
		"options":     financeOptions(),
		"totals": map[string]interface{}{
			"cost":         total,
			"transactions": len(picked),
			"wo_count":     len(wos),
			"jo_count":     len(jos),
		},
		"trend":   trendList,
		"vendors": amounts(vendors, false),
		"ships":   amounts(ships, true),
		"rows":    picked[from:to],
		"total":   len(picked),
		"page":    page,
		"limit":   limit,
	})
}

func sortFinanceRows(list []financeRow, key string, asc bool) {
	less := func(a, b financeRow) bool { return a.Date < b.Date }
	switch key {
	case "woCode":
		less = func(a, b financeRow) bool { return a.WOCode < b.WOCode }
	case "joCode":
		less = func(a, b financeRow) bool { return a.JOCode < b.JOCode }
	case "shipName":
		less = func(a, b financeRow) bool { return a.ShipName < b.ShipName }
	case "vendorName":
		less = func(a, b financeRow) bool { return a.VendorName < b.VendorName }
	case "statusApproval":
		less = func(a, b financeRow) bool { return a.Status < b.Status }
	case "prevCost":
		less = func(a, b financeRow) bool { return a.PreviousCost < b.PreviousCost }
	case "finalCost":
		less = func(a, b financeRow) bool { return a.Cost < b.Cost }
	}
	sort.SliceStable(list, func(i, j int) bool {
		if asc {
			return less(list[i], list[j])
		}
		return less(list[j], list[i])
	})
}

// financeOptions lists the values of the main filters across all billing
// transactions, so a choice never hides the others.
func financeOptions() map[string][]string {
	queries := map[string]string{
		"years":    `SELECT DISTINCT SUBSTR(cost_date, 1, 4) FROM work_order_daily_costs WHERE approved_cost <> 0`,
		"ships":    `SELECT DISTINCT COALESCE(NULLIF(s.ship_name, ''), '` + noShipLabel + `') FROM work_order_summary s WHERE s.wo_id IN (SELECT wo_id FROM work_order_daily_costs WHERE approved_cost <> 0)`,
		"vendors":  `SELECT DISTINCT COALESCE(NULLIF(s.vendor_name, ''), '` + noVendorLabel + `') FROM work_order_summary s WHERE s.wo_id IN (SELECT wo_id FROM work_order_daily_costs WHERE approved_cost <> 0)`,
		"statuses": `SELECT DISTINCT COALESCE(s.derived_status, '') FROM work_order_summary s WHERE s.wo_id IN (SELECT wo_id FROM work_order_daily_costs WHERE approved_cost <> 0) AND COALESCE(s.derived_status, '') <> ''`,
	}
	options := map[string][]string{}
	for key, query := range queries {
		values := []string{}
		if rows, err := db.Query(query); err == nil {
			for rows.Next() {
				var v string
				if rows.Scan(&v) == nil && v != "" {
					values = append(values, v)
				}
			}
			rows.Close()
		}
		sort.Strings(values)
		if key == "years" {
			sort.Sort(sort.Reverse(sort.StringSlice(values)))
		}
		options[key] = values
	}
	return options
}
