package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"shipyard/db"
)

const siagaWorkOrderURL = "https://shipyard-siaga.samudera.id/v2/work-orders/progress/"

var reISODate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

func checkDate(field, v string) error {
	if v != "" && !reISODate.MatchString(v) {
		return inputErrorf("%s harus berformat YYYY-MM-DD", field)
	}
	return nil
}

var woStatuses = []string{"Waiting", "Approval Level 1", "Approval Level 2", "Approval Level 3", "Approval Level 4", "Approval Level 5"}

// aiTools lists every tool. Descriptions say when to call each one: the
// model picks tools from them (forced tool choice is not available).
func aiTools() []aiTool {
	return []aiTool{
		{
			Name: "search_work_orders",
			Description: "Search ShipHub work orders (WO, from SIAGA) and get totals. Call this when the user asks which WOs exist for a ship, " +
				"project (Job Order / JO), vendor or approval status, how many WOs there are, or their total / approved / pending value. " +
				"Returns a summary (WO and JO counts; item value approved, pending and rejected; SIAGA header value) and the matching WOs, newest approval first. " +
				"date_from / date_to select WOs by their LATEST approval date, and the values are each WO's whole value, also approvals before the period; " +
				"for the value approved within a period use billing_summary. " +
				"For one specific WO by its code use get_work_order instead.",
			Schema: aiSchema(map[string]interface{}{
				"query":        aiString("Free text matched against WO code, JO code, project, vendor and ship name, e.g. \"WO25060066\", \"TB Barakuda\", \"PT Maju\"."),
				"status":       aiString("Approval status of the WO.", woStatuses...),
				"vendor":       aiString("Exact vendor name, or \"Tanpa Vendor\" for WOs without one."),
				"project":      aiString("Exact project name as shown in ShipHub (\"JO CODE - SHIP NAME\")."),
				"project_type": aiString("external = ship projects, internal = yard facility projects.", "external", "internal"),
				"date_from":    aiString("Latest approval date from (YYYY-MM-DD)."),
				"date_to":      aiString("Latest approval date until (YYYY-MM-DD)."),
				"sort":         aiString("latest = newest approval first (default), value = highest WO value first.", "latest", "value"),
				"limit":        aiInteger("How many WOs to list (default 10).", 1, 25),
			}),
			Resource: "Work Order",
			Run:      runSearchWorkOrders,
		},
		{
			Name: "get_work_order",
			Description: "Get one work order in detail by its WO code (e.g. WO25060066 or WO25060066/YWTS). Call this when the user names a " +
				"specific WO and asks about its status, value, vendor, ship, items or approval history. Returns the WO header, item totals " +
				"per status (approved / pending / rejected), its 15 costliest items with work type, and the approved value per approval date.",
			Schema: aiSchema(map[string]interface{}{
				"wo_code": aiString("The WO code, with or without the /YWTS suffix."),
			}, "wo_code"),
			Resource: "Work Order",
			Run:      runGetWorkOrder,
		},
		{
			Name: "billing_summary",
			Description: "Billing (tagihan) from the Financial Dashboard: approved WO value per approval date. Call this when the user asks " +
				"how much was approved or billed in a period, the trend per day / week / month, or which vendors or ships account for it. " +
				"Each approval day of each WO is one transaction. Returns totals (value, transactions, WO and JO counts), the trend, " +
				"top vendors and ships, and the latest transactions. Without a period it covers the last week of data.",
			Schema: aiSchema(map[string]interface{}{
				"period":    aiString("Relative period counted back from the NEWEST APPROVAL DATE in the data, not from today. For calendar questions (hari ini, minggu ini, bulan lalu, tahun ini...) use date_from / date_to from the date list instead. Ignored when date_from or date_to is given.", "all", "1week", "2weeks", "3weeks", "1month", "2months", "3months", "6months"),
				"date_from": aiString("Start date (YYYY-MM-DD) of a custom period."),
				"date_to":   aiString("End date (YYYY-MM-DD) of a custom period."),
				"year":      aiString("Only approvals in this year, e.g. \"2025\"."),
				"group":     aiString("Trend bucket (default month). Weeks run Saturday to Friday.", "day", "week", "month"),
				"vendor":    aiString("Exact vendor name."),
				"ship":      aiString("Exact ship name."),
				"status":    aiString("Current approval status of the WO.", woStatuses...),
			}),
			Resource: ResourceFinancialDashboard,
			Run:      runBillingSummary,
		},
		{
			Name: "search_work_items",
			Description: "Search the work items inside WOs (Item Pekerjaan WO), or group them. Call this when the user asks about specific " +
				"work (\"ganti baru plat\", \"kampas rem\", \"sandblasting\"), its volume or cost, or wants totals per work type, project, " +
				"vendor, activity or category. Item descriptions are free text; work_type is the cleaned-up type ShipHub derives from them " +
				"(e.g. \"Ganti baru packing karet\"), which is the better filter when the user names a kind of work. " +
				"With group_by none it lists items; otherwise it returns groups with item and WO counts, volume and min / average / max unit cost.",
			Schema: aiSchema(map[string]interface{}{
				"query":       aiString("Text matched against the item description and its activity name."),
				"work_type":   aiString("Exact work type, e.g. \"Ganti baru packing karet\" (see price_reference or a work_type grouping for names)."),
				"project":     aiString("Exact project name."),
				"vendor":      aiString("Exact vendor name."),
				"item_status": aiString("Approval status of the items.", "approved", "pending", "rejected"),
				"date_from":   aiString("Item approval date from (YYYY-MM-DD); limits to approved items."),
				"date_to":     aiString("Item approval date until (YYYY-MM-DD)."),
				"group_by":    aiString("none = list items (default); otherwise one row per group.", "none", "work_type", "work_type_size", "project", "vendor", "activity", "category", "item"),
				"sort":        aiString("cost (default), date, volume, or count (groups only).", "cost", "date", "volume", "count"),
				"limit":       aiInteger("How many items or groups to return (default 10).", 1, 25),
			}),
			Resource: ResourceWorkOrderItems,
			Run:      runSearchWorkItems,
		},
		{
			Name: "price_reference",
			Description: "Reference (fair) unit prices per work type, size and unit (Harga Acuan), from approved items of the last 24 months " +
				"(or all years where there are too few). Call this when the user asks what a piece of work usually costs, whether a price " +
				"is reasonable, or how a price compares between years or vendors. Search with query first; then pass the exact work_type, " +
				"size and unit of one result to get its yearly trend, vendor medians and recent items. The usual range is P25-P75 " +
				"(the middle half of the items). Only groups with at least 10 approved items have a reference.",
			Schema: aiSchema(map[string]interface{}{
				"query":     aiString("Words that must all appear in the work type or size, e.g. \"kampas rem\", \"packing karet 2\"."),
				"unit":      aiString("Only references in this unit, e.g. \"pcs\", \"m2\", \"kg\"."),
				"work_type": aiString("Exact work type of one reference, for its detail."),
				"size":      aiString("Exact size of that reference (empty string when it has none)."),
				"limit":     aiInteger("How many references to list (default 10).", 1, 25),
			}),
			Resource: ResourcePriceReference,
			Run:      runPriceReference,
		},
		{
			Name: "data_findings",
			Description: "Data checks (Data Perlu Dicek): work items whose unit price is far above the reference (more than 2x the median and " +
				"beyond the usual range) or whose pipe length is implausible. Call this when the user asks which prices or items look wrong, " +
				"need checking, or should be corrected in SIAGA. Items not approved yet (item_status pending) can still be fixed before " +
				"approval. Returns counts per rule and the findings with the biggest excess over the reference first.",
			Schema: aiSchema(map[string]interface{}{
				"rule":        aiString("price_high = price far above reference, pipe_length = implausible pipe length.", "price_high", "pipe_length", "all"),
				"status":      aiString("Finding status (default open).", "open", "ignored", "resolved", "all"),
				"item_status": aiString("Approval status of the item in SIAGA.", "pending", "approved", "rejected", "all"),
				"query":       aiString("Text matched against item, WO code, work type, project and vendor."),
				"sort":        aiString("excess = biggest rupiah excess (default), ratio = most times the median, date = newest.", "excess", "ratio", "date"),
				"date_from":   aiString("First day (YYYY-MM-DD) of a period, on date_field."),
				"date_to":     aiString("Last day (YYYY-MM-DD) of a period, on date_field."),
				"date_field":  aiString("found = the day ShipHub first flagged the item (default), approval = the item's approval date.", "found", "approval"),
				"limit":       aiInteger("How many findings to return (default 10).", 1, 25),
			}),
			Resource: ResourceItemFindings,
			Run:      runDataFindings,
		},
		{
			Name: "unrecognized_activities",
			Description: "Activities whose work items ShipHub could not assign a work type to, by value. Call this when the user asks which " +
				"items or activities are not grouped or recognized yet, or how much value has no work type. Returns the totals and the " +
				"activities with the most unrecognized value.",
			Schema: aiSchema(map[string]interface{}{
				"query": aiString("Text matched against activity, category or item description."),
				"limit": aiInteger("How many activities to return (default 10).", 1, 25),
			}),
			Resource: ResourceItemFindings,
			Run:      runUnrecognizedActivities,
		},
		attendanceHoursTool(),
		aiJobMarginTool(),
		aiRepairListTool(),
		aiQueryDataTool(),
	}
}

func setIf(q url.Values, key, value string) {
	if value = strings.TrimSpace(value); value != "" {
		q.Set(key, value)
	}
}

func trimList(v interface{}, n int) interface{} {
	if list, ok := v.([]interface{}); ok && len(list) > n {
		return list[:n]
	}
	return v
}

func runSearchWorkOrders(r *http.Request, input json.RawMessage) (interface{}, error) {
	var in struct {
		Query, Status, Vendor, Project string
		ProjectType                    string `json:"project_type"`
		DateFrom                       string `json:"date_from"`
		DateTo                         string `json:"date_to"`
		Sort                           string
		Limit                          int
	}
	if err := decodeAIInput(input, &in); err != nil {
		return nil, err
	}
	for _, err := range []error{oneOf("status", in.Status, woStatuses...), oneOf("project_type", in.ProjectType, "external", "internal"),
		oneOf("sort", in.Sort, "latest", "value"), checkDate("date_from", in.DateFrom), checkDate("date_to", in.DateTo)} {
		if err != nil {
			return nil, err
		}
	}
	q := url.Values{}
	setIf(q, "search", in.Query)
	setIf(q, "status", in.Status)
	setIf(q, "vendor", in.Vendor)
	setIf(q, "project", in.Project)
	setIf(q, "project_type", in.ProjectType)
	setIf(q, "start_date", in.DateFrom)
	setIf(q, "end_date", in.DateTo)
	stats, err := aiCall(GetWorkOrderStats, r, "/api/work-orders/stats", q)
	if err != nil {
		return nil, err
	}
	q.Set("sort", map[string]string{"value": "fullWoCost"}[in.Sort])
	if q.Get("sort") == "" {
		q.Set("sort", "latest_date")
	}
	q.Set("dir", "desc")
	q.Set("limit", strconv.Itoa(limitOr(in.Limit, 10, 25)))
	list, err := aiCall(GetWorkOrders, r, "/api/work-orders", q)
	if err != nil {
		return nil, err
	}
	rows, _ := list["data"].([]interface{})
	for _, row := range rows {
		if m, ok := row.(map[string]interface{}); ok {
			m["siaga_url"] = siagaWorkOrderURL + strings.TrimSpace(toString(m["id"]))
		}
	}
	return map[string]interface{}{
		"summary": map[string]interface{}{
			"wo_count": stats["totalWOs"], "jo_count": stats["totalJOs"], "vendor_count": stats["totalVendors"],
			"approved_value":                  stats["sumFinal"],
			"approved_at_latest_approval":     stats["sumSaatIni"],
			"approved_before_latest_approval": stats["sumSebelumnya"],
			"pending_value":                   stats["sumPending"],
			"rejected_value":                  stats["sumRejected"],
			"items_value":                     toFloat(stats["sumFinal"]) + toFloat(stats["sumPending"]) + toFloat(stats["sumRejected"]),
			"siaga_header_value":              stats["sumTotal"],
			"wo_per_status":                   stats["approvalCounts"],
		},
		"notes": []string{
			"approved_value = nilai item yang sudah di-approve (approved_before_latest_approval + approved_at_latest_approval). " +
				"pending_value = item belum di-approve, rejected_value = ditolak, items_value = jumlah ketiganya.",
			"siaga_header_value = total di header WO SIAGA (nilai awal WO); tidak bertambah saat ada pekerjaan tambahan, jadi bisa lebih kecil " +
				"dari approved_value. Jangan menyebutnya total nilai WO; total nilai pekerjaan adalah items_value.",
			"Per WO di work_orders: final_cost = approved, pending_cost, rejected_cost, total_cost = header SIAGA (sama seperti di atas).",
			"date_from / date_to memilih WO berdasarkan tanggal approval TERAKHIR-nya; nilainya mencakup approval sebelum periode. " +
				"Untuk nilai yang di-approve DI DALAM periode, pakai billing_summary.",
		},
		"total": list["total"], "work_orders": rows,
	}, nil
}

func toString(v interface{}) string {
	switch x := v.(type) {
	case string:
		return x
	case nil:
		return ""
	}
	b, _ := json.Marshal(v)
	return strings.Trim(string(b), `"`)
}

func runGetWorkOrder(r *http.Request, input json.RawMessage) (interface{}, error) {
	var in struct {
		WOCode string `json:"wo_code"`
	}
	if err := decodeAIInput(input, &in); err != nil {
		return nil, err
	}
	code := strings.ToUpper(strings.TrimSpace(in.WOCode))
	if code == "" {
		return nil, inputErrorf("wo_code wajib diisi")
	}
	var id, woCode, jo, project, vendor, ship, status, latest, created, updated, projectType string
	var total, final, pending, rejected float64
	err := db.QueryRow(`SELECT wo_id, COALESCE(wo_code, ''), COALESCE(jo_code, ''), COALESCE(project_name, ''), COALESCE(vendor_name, ''),
			COALESCE(ship_name, ''), COALESCE(derived_status, ''), COALESCE(latest_date, ''), COALESCE(created_source_at, ''),
			COALESCE(updated_source_at, ''), COALESCE(project_type, 'external'), COALESCE(total_cost, 0), COALESCE(final_cost, 0),
			COALESCE(pending_cost, 0), COALESCE(rejected_cost, 0)
		FROM work_order_summary WHERE UPPER(wo_code) = ? OR UPPER(wo_code) LIKE ? OR wo_id = ?
		ORDER BY CASE WHEN UPPER(wo_code) = ? THEN 0 ELSE 1 END LIMIT 1`, code, code+"/%", code, code).
		Scan(&id, &woCode, &jo, &project, &vendor, &ship, &status, &latest, &created, &updated, &projectType, &total, &final, &pending, &rejected)
	if err != nil {
		return nil, inputErrorf("WO %s tidak ditemukan di ShipHub; coba search_work_orders dengan sebagian kodenya", code)
	}

	perStatus := map[string]interface{}{}
	if rows, err := db.Query(`SELECT COALESCE(status, ''), COUNT(*), COALESCE(SUM(total_cost), 0) FROM wo_items WHERE wo_id = ? GROUP BY 1`, id); err == nil {
		for rows.Next() {
			var s string
			var n int
			var cost float64
			if rows.Scan(&s, &n, &cost) == nil {
				perStatus[s] = map[string]interface{}{"items": n, "value": cost}
			}
		}
		rows.Close()
	}
	items := []map[string]interface{}{}
	if rows, err := db.Query(`SELECT COALESCE(i.label, ''), COALESCE(i.activity_name, ''), CASE WHEN p.recognized THEN COALESCE(p.work_type, '') ELSE '' END,
			COALESCE(i.unit, ''), COALESCE(i.volume, 0), COALESCE(i.unit_cost, 0), COALESCE(i.total_cost, 0), COALESCE(i.status, ''), COALESCE(i.approval_date, '')
		FROM wo_items i LEFT JOIN wo_item_parsed p ON p.wo_id = i.wo_id AND p.item_id = i.item_id
		WHERE i.wo_id = ? ORDER BY i.total_cost DESC LIMIT 15`, id); err == nil {
		for rows.Next() {
			var label, activity, work, unit, st, date string
			var vol, unitCost, cost float64
			if rows.Scan(&label, &activity, &work, &unit, &vol, &unitCost, &cost, &st, &date) == nil {
				items = append(items, map[string]interface{}{"label": label, "activity": activity, "work_type": workTypeLabel(work), "unit": unit,
					"volume": vol, "unit_cost": unitCost, "total_cost": cost, "status": st, "approval_date": dateOnly(date)})
			}
		}
		rows.Close()
	}
	approvals := []map[string]interface{}{}
	if rows, err := db.Query(`SELECT cost_date, approved_cost FROM work_order_daily_costs WHERE wo_id = ? ORDER BY cost_date`, id); err == nil {
		for rows.Next() {
			var d string
			var c float64
			if rows.Scan(&d, &c) == nil {
				approvals = append(approvals, map[string]interface{}{"date": d, "approved_value": c})
			}
		}
		rows.Close()
	}
	return map[string]interface{}{
		"wo_code": woCode, "jo_code": jo, "project": project, "ship": ship, "vendor": vendorLabel(vendor), "status": status,
		"project_type": projectType, "approved_value": final, "pending_value": pending, "rejected_value": rejected,
		"items_value": final + pending + rejected, "siaga_header_value": total,
		"value_note": "items_value = approved + pending + rejected (nilai pekerjaan sebenarnya). siaga_header_value = total di header WO SIAGA, " +
			"nilai awal yang tidak bertambah dengan pekerjaan tambahan.",
		"latest_approval_date": latest, "created_at": created, "updated_at": updated, "siaga_url": siagaWorkOrderURL + id,
		"items_per_status": perStatus, "top_items": items, "approvals_per_date": approvals,
	}, nil
}

func runBillingSummary(r *http.Request, input json.RawMessage) (interface{}, error) {
	var in struct {
		Period   string
		DateFrom string `json:"date_from"`
		DateTo   string `json:"date_to"`
		Year     string
		Group    string
		Vendor   string
		Ship     string
		Status   string
	}
	if err := decodeAIInput(input, &in); err != nil {
		return nil, err
	}
	for _, err := range []error{oneOf("period", in.Period, "all", "1week", "2weeks", "3weeks", "1month", "2months", "3months", "6months"),
		oneOf("group", in.Group, "day", "week", "month"), oneOf("status", in.Status, woStatuses...),
		checkDate("date_from", in.DateFrom), checkDate("date_to", in.DateTo)} {
		if err != nil {
			return nil, err
		}
	}
	q := url.Values{"limit": {"10"}}
	switch {
	case in.DateFrom != "" || in.DateTo != "":
		q.Set("preset", "custom")
		setIf(q, "start", in.DateFrom)
		setIf(q, "end", in.DateTo)
	case in.Period != "":
		q.Set("preset", in.Period)
	default:
		q.Set("preset", "1week")
	}
	if in.Group == "" {
		in.Group = "month"
	}
	q.Set("group", in.Group)
	setIf(q, "year", in.Year)
	setIf(q, "vendor", in.Vendor)
	setIf(q, "ship", in.Ship)
	setIf(q, "status", in.Status)
	res, err := aiCall(GetFinanceSummary, r, "/api/finance/summary", q)
	if err != nil {
		return nil, err
	}
	rng, _ := res["range"].(map[string]interface{})
	trend := billingTrend(res["trend"], toString(rng["start"]), toString(rng["end"]), in.Group)
	return map[string]interface{}{
		"period": res["range"], "newest_approval_date": res["latest_date"], "totals": res["totals"], "trend": trimList(trend, 60),
		"trend_note": "trend memuat setiap " + map[string]string{"day": "hari", "week": "minggu tagihan (Sabtu-Jumat)", "month": "bulan"}[in.Group] +
			" yang bersinggungan dengan periode, termasuk yang bernilai 0. Di tepi periode, partial = true: hanya tanggal from s.d. to " +
			"yang dihitung, label sudah menyebut tanggalnya. Tampilkan semua baris (juga partial dan 0) agar jumlahnya sama dengan totals.",
		"top_vendors": trimList(res["vendors"], 10), "top_ships": trimList(res["ships"], 10), "latest_transactions": res["rows"],
	}, nil
}

var shortMonths = []string{"", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}

// billingTrend lays the dashboard's trend out on every day / billing week /
// month that touches [start, end], with zero buckets filled in and the edge
// buckets clipped to the period and marked partial, so a chart of "Oktober"
// shows 1-2 Okt and 31 Okt instead of dropping them. Without a closed range
// the trend is passed through with labels only.
func billingTrend(raw interface{}, start, end, group string) []interface{} {
	costs := map[string]float64{}
	var keys []string
	if list, ok := raw.([]interface{}); ok {
		for _, p := range list {
			if m, ok := p.(map[string]interface{}); ok {
				k := toString(m["period"])
				costs[k] += toFloat(m["cost"])
				keys = append(keys, k)
			}
		}
	}
	span := func(key string) (time.Time, time.Time) {
		from, _ := time.Parse("2006-01-02", key)
		switch group {
		case "week":
			return from, from.AddDate(0, 0, 6)
		case "month":
			return from, from.AddDate(0, 1, -1)
		}
		return from, from
	}
	label := func(from, to time.Time) string {
		switch {
		case group == "month" && from.Day() == 1 && to.AddDate(0, 0, 1).Day() == 1:
			return fmt.Sprintf("%s %d", shortMonths[from.Month()], from.Year())
		case from.Equal(to):
			return fmt.Sprintf("%d %s", from.Day(), shortMonths[from.Month()])
		case from.Month() == to.Month():
			return fmt.Sprintf("%d–%d %s", from.Day(), to.Day(), shortMonths[to.Month()])
		}
		return fmt.Sprintf("%d %s–%d %s", from.Day(), shortMonths[from.Month()], to.Day(), shortMonths[to.Month()])
	}
	point := func(key string, from, to time.Time, partial bool) map[string]interface{} {
		l := label(from, to)
		if partial {
			l += " (sebagian)"
		}
		return map[string]interface{}{"period": key, "label": l, "from": from.Format("2006-01-02"), "to": to.Format("2006-01-02"),
			"partial": partial, "cost": costs[key]}
	}

	s, errS := time.Parse("2006-01-02", start)
	e, errE := time.Parse("2006-01-02", end)
	out := []interface{}{}
	if errS != nil || errE != nil || e.Before(s) {
		sort.Strings(keys)
		for _, k := range keys {
			from, to := span(k)
			out = append(out, point(k, from, to, false))
		}
		return out
	}
	for k := financeBucket(start, group); k != "" && k <= end; {
		from, to := span(k)
		cf, ct := from, to
		if cf.Before(s) {
			cf = s
		}
		if ct.After(e) {
			ct = e
		}
		out = append(out, point(k, cf, ct, !cf.Equal(from) || !ct.Equal(to)))
		k = financeBucket(to.AddDate(0, 0, 1).Format("2006-01-02"), group)
		if len(out) > 400 {
			break // a day trend over years: the 60 shown are enough
		}
	}
	return out
}

func runSearchWorkItems(r *http.Request, input json.RawMessage) (interface{}, error) {
	var in struct {
		Query, Project, Vendor, Sort string
		WorkType                     string `json:"work_type"`
		ItemStatus                   string `json:"item_status"`
		DateFrom                     string `json:"date_from"`
		DateTo                       string `json:"date_to"`
		GroupBy                      string `json:"group_by"`
		Limit                        int
	}
	if err := decodeAIInput(input, &in); err != nil {
		return nil, err
	}
	for _, err := range []error{oneOf("item_status", in.ItemStatus, "approved", "pending", "rejected"),
		oneOf("group_by", in.GroupBy, "none", "work_type", "work_type_size", "project", "vendor", "activity", "category", "item"),
		oneOf("sort", in.Sort, "cost", "date", "volume", "count"), checkDate("date_from", in.DateFrom), checkDate("date_to", in.DateTo)} {
		if err != nil {
			return nil, err
		}
	}
	q := url.Values{"dir": {"desc"}, "limit": {strconv.Itoa(limitOr(in.Limit, 10, 25))}}
	setIf(q, "search", in.Query)
	setIf(q, "work_type", in.WorkType)
	setIf(q, "project", in.Project)
	setIf(q, "vendor", in.Vendor)
	setIf(q, "status", in.ItemStatus)
	setIf(q, "start_date", in.DateFrom)
	setIf(q, "end_date", in.DateTo)
	if in.GroupBy == "" || in.GroupBy == "none" {
		if in.Sort == "count" {
			return nil, inputErrorf("sort count hanya untuk group_by selain none")
		}
		q.Set("sort", map[string]string{"": "total_cost", "cost": "total_cost", "date": "item_date", "volume": "volume"}[in.Sort])
		res, err := aiCall(GetWorkOrderItems, r, "/api/wo-items", q)
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{"total_items": res["total"], "total_value": res["totalCost"], "items": res["data"]}, nil
	}
	q.Set("group", in.GroupBy)
	q.Set("sort", map[string]string{"": "total_cost", "cost": "total_cost", "date": "latest_date", "volume": "total_volume", "count": "item_count"}[in.Sort])
	res, err := aiCall(GetWorkOrderItemSummary, r, "/api/wo-items/summary", q)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"total_groups": res["total"], "group_by": in.GroupBy, "groups": res["data"]}, nil
}

func runPriceReference(r *http.Request, input json.RawMessage) (interface{}, error) {
	var in struct {
		Query, Unit string
		WorkType    string  `json:"work_type"`
		Size        *string `json:"size"`
		Limit       int
	}
	if err := decodeAIInput(input, &in); err != nil {
		return nil, err
	}
	if in.WorkType != "" {
		if in.Unit == "" {
			return nil, inputErrorf("untuk rincian satu harga acuan, isi work_type, size dan unit persis seperti hasil pencarian")
		}
		size := ""
		if in.Size != nil {
			size = *in.Size
		}
		res, err := aiCall(GetPriceReferenceDetail, r, "/api/price-reference/detail", url.Values{"work_type": {in.WorkType}, "size": {size}, "unit": {in.Unit}})
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{"reference": res["reference"], "per_year": res["years"], "per_vendor": trimList(res["vendors"], 10),
			"comparable_items": res["item_count"], "recent_items": trimList(res["items"], 10)}, nil
	}
	if strings.TrimSpace(in.Query) == "" {
		return nil, inputErrorf("isi query (jenis pekerjaan atau ukuran yang dicari)")
	}
	q := url.Values{"sort": {"n"}, "dir": {"desc"}, "limit": {strconv.Itoa(limitOr(in.Limit, 10, 25))}}
	setIf(q, "search", in.Query)
	setIf(q, "unit", in.Unit)
	res, err := aiCall(GetPriceReferences, r, "/api/price-reference", q)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"total": res["total"], "references": res["data"], "updated_at": res["updated_at"],
		"note": "median = typical unit price; p25-p75 = usual range; n = approved items compared"}, nil
}

func runDataFindings(r *http.Request, input json.RawMessage) (interface{}, error) {
	var in struct {
		Rule, Status, Query, Sort string
		ItemStatus                string `json:"item_status"`
		DateFrom                  string `json:"date_from"`
		DateTo                    string `json:"date_to"`
		DateField                 string `json:"date_field"`
		Limit                     int
	}
	if err := decodeAIInput(input, &in); err != nil {
		return nil, err
	}
	for _, err := range []error{oneOf("rule", in.Rule, "price_high", "pipe_length", "all"), oneOf("status", in.Status, "open", "ignored", "resolved", "all"),
		oneOf("item_status", in.ItemStatus, "pending", "approved", "rejected", "all"), oneOf("sort", in.Sort, "excess", "ratio", "date"),
		oneOf("date_field", in.DateField, "found", "approval"), checkDate("date_from", in.DateFrom), checkDate("date_to", in.DateTo)} {
		if err != nil {
			return nil, err
		}
	}
	summary, err := aiCall(GetItemFindingsSummary, r, "/api/wo-findings/summary", url.Values{})
	if err != nil {
		return nil, err
	}
	q := url.Values{"dir": {"desc"}, "limit": {strconv.Itoa(limitOr(in.Limit, 10, 25))}}
	setIf(q, "rule", in.Rule)
	setIf(q, "status", in.Status)
	setIf(q, "item_status", in.ItemStatus)
	setIf(q, "search", in.Query)
	setIf(q, "sort", in.Sort)
	setIf(q, "date_from", in.DateFrom)
	setIf(q, "date_to", in.DateTo)
	setIf(q, "date_field", in.DateField)
	res, err := aiCall(GetItemFindings, r, "/api/wo-findings", q)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"counts_per_rule": summary["counts"], "open_not_approved_per_rule": summary["open_pending"],
		"last_check": summary["last_run"], "matching": res["total"], "matching_excess": res["excess"], "findings": res["data"]}, nil
}

func runUnrecognizedActivities(r *http.Request, input json.RawMessage) (interface{}, error) {
	var in struct {
		Query string
		Limit int
	}
	if err := decodeAIInput(input, &in); err != nil {
		return nil, err
	}
	q := url.Values{"limit": {strconv.Itoa(limitOr(in.Limit, 10, 25))}}
	setIf(q, "search", in.Query)
	res, err := aiCall(GetUnrecognizedActivities, r, "/api/wo-findings/unrecognized", q)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"unrecognized_items": res["items"], "unrecognized_value": res["total_cost"], "all_items": res["all_items"],
		"all_value": res["all_cost"], "activities": res["data"], "activity_count": res["total"]}, nil
}

// toFloat reads a number decoded from a handler's JSON answer (0 if absent).
func toFloat(v interface{}) float64 {
	n, _ := aiDataNumber(v)
	return n
}
