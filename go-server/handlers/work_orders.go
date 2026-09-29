package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"shipyard/db"
)

func workOrderSummaryFilters(r *http.Request) (string, []interface{}, string, string) {
	q := r.URL.Query()
	where := []string{"1=1"}
	args := []interface{}{}
	if search := strings.TrimSpace(q.Get("search")); search != "" {
		like := "%" + strings.ToLower(search) + "%"
		where = append(where, "(LOWER(wo_code) LIKE ? OR LOWER(jo_code) LIKE ? OR LOWER(project_name) LIKE ? OR LOWER(vendor_name) LIKE ? OR LOWER(ship_name) LIKE ?)")
		args = append(args, like, like, like, like, like)
	}
	if status := strings.TrimSpace(q.Get("status")); status != "" && status != "All" {
		where = append(where, "(derived_status = ? OR status_approval = ?)")
		args = append(args, status, status)
	}
	if vendor := strings.TrimSpace(q.Get("vendor")); vendor != "" && vendor != "All" {
		where = append(where, "vendor_name = ?")
		args = append(args, vendor)
	}
	if project := strings.TrimSpace(q.Get("project")); project != "" && project != "All" {
		where = append(where, "project_name = ?")
		args = append(args, project)
	}
	if start := strings.TrimSpace(q.Get("start_date")); start != "" {
		where = append(where, "latest_date >= ?")
		args = append(args, start)
	}
	if end := strings.TrimSpace(q.Get("end_date")); end != "" {
		where = append(where, "latest_date <= ?")
		args = append(args, end)
	}
	if trend := strings.TrimSpace(q.Get("trend_date")); trend != "" {
		group := strings.TrimSpace(q.Get("group"))
		switch group {
		case "day", "daily":
			where = append(where, "latest_date = ?")
			args = append(args, trend)
		case "week", "weekly":
			where = append(where, "latest_date >= ? AND latest_date < ?")
			start, err := time.Parse("2006-01-02", trend)
			if err == nil {
				args = append(args, start.Format("2006-01-02"), start.AddDate(0, 0, 7).Format("2006-01-02"))
			} else {
				args = append(args, trend, trend)
			}
		default:
			where = append(where, "latest_date LIKE ?")
			args = append(args, trend+"%")
		}
	}

	sortColumns := map[string]string{
		"created_at":        "created_source_at",
		"updated_at":        "updated_source_at",
		"latest_date":       "latest_date",
		"woCode":            "wo_code",
		"joCode":            "jo_code",
		"projectName":       "project_name",
		"vendorName":        "vendor_name",
		"derivedStatus":     "derived_status",
		"fullWoCost":        "total_cost",
		"totalCostNum":      "latest_cost",
		"pending_approvals": "pending_cost",
		"final_costs":       "final_cost",
	}
	sortCol := sortColumns[q.Get("sort")]
	if sortCol == "" {
		sortCol = "latest_date"
	}
	dir := strings.ToUpper(q.Get("dir"))
	if dir != "ASC" {
		dir = "DESC"
	}
	return strings.Join(where, " AND "), args, sortCol, dir
}

func scanWorkOrderSummaryRows(rows *sql.Rows) []workOrderSummary {
	items := []workOrderSummary{}
	for rows.Next() {
		var item workOrderSummary
		if rows.Scan(&item.WOID, &item.WOCode, &item.JOCode, &item.ProjectName, &item.VendorName, &item.ShipName, &item.StatusApproval, &item.DerivedStatus,
			&item.LatestDate, &item.PendingCost, &item.FinalCost, &item.LatestCost, &item.PreviousCost, &item.RejectedCost, &item.TotalCost,
			&item.CreatedSourceAt, &item.UpdatedSourceAt) == nil {
			items = append(items, item)
		}
	}
	return items
}

type workOrderSummary struct {
	WOID            string  `json:"id"`
	WOCode          string  `json:"wo_code"`
	JOCode          string  `json:"jo_code"`
	ProjectName     string  `json:"project_name"`
	VendorName      string  `json:"vendor_name"`
	ShipName        string  `json:"ship_name"`
	StatusApproval  string  `json:"status_approval"`
	DerivedStatus   string  `json:"derived_status"`
	LatestDate      string  `json:"latest_date"`
	PendingCost     float64 `json:"pending_cost"`
	FinalCost       float64 `json:"final_cost"`
	LatestCost      float64 `json:"latest_cost"`
	PreviousCost    float64 `json:"previous_cost"`
	RejectedCost    float64 `json:"rejected_cost"`
	TotalCost       float64 `json:"total_cost"`
	CreatedSourceAt string  `json:"created_at"`
	UpdatedSourceAt string  `json:"updated_at"`
}

func approvalStatusText(level float64, status string) string {
	normalized := strings.ToLower(strings.TrimSpace(status))
	if normalized == "approved" || normalized == "approved level 5" || level >= 5 {
		return "Approval Level 5"
	}
	if level >= 1 && level <= 4 {
		return fmt.Sprintf("Approval Level %.0f", level)
	}
	return "Waiting"
}

func dataObject(raw []byte) (map[string]interface{}, error) {
	var dynamic map[string]interface{}
	if err := json.Unmarshal(raw, &dynamic); err != nil {
		return nil, err
	}
	if d, ok := dynamic["data"].(map[string]interface{}); ok {
		return d, nil
	}
	return dynamic, nil
}

func repairListFromData(data map[string]interface{}) []interface{} {
	if list, ok := data["repair_list"].([]interface{}); ok {
		return list
	}
	return nil
}

func dateOnly(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = strings.ReplaceAll(value, "T", " ")
	return strings.Split(value, " ")[0]
}

func nestedMap(item map[string]interface{}, key string) map[string]interface{} {
	if value, ok := item[key].(map[string]interface{}); ok {
		return value
	}
	return nil
}

func nestedFirstString(item map[string]interface{}, parent string, keys ...string) string {
	child := nestedMap(item, parent)
	if child == nil {
		return ""
	}
	return firstString(child, keys...)
}

func workOrderJOCode(item map[string]interface{}) string {
	if value := firstString(item, "jo_code", "joCode"); value != "" {
		return value
	}
	return nestedFirstString(item, "t_job_order", "code", "idproject", "project")
}

func workOrderShipName(item map[string]interface{}) string {
	if value := firstString(item, "m_ship_name", "ship_name"); value != "" {
		return value
	}
	if value := nestedFirstString(item, "m_ship", "name", "shipname"); value != "" {
		return value
	}
	return nestedFirstString(nestedMap(item, "t_job_order"), "m_ship", "name", "shipname")
}

func workOrderVendorName(item map[string]interface{}) string {
	if value := firstString(item, "m_vendor_name", "vendor_name"); value != "" {
		return value
	}
	if value := nestedFirstString(item, "m_vendor", "name", "vendor", "nama_pt"); value != "" {
		return value
	}
	return firstString(item, "vendor", "code_vendor")
}

func summaryFromWorkOrderListItem(item map[string]interface{}) workOrderSummary {
	woID := firstString(item, "id", "wo_id")
	joCode := workOrderJOCode(item)
	shipName := workOrderShipName(item)
	if shipName == "" {
		shipName = "N/A"
	}
	if joCode == "" {
		joCode = "N/A"
	}

	status := firstString(item, "status_approval")
	level := parseFloatAny(firstPresent(item, "min_approval_level", "approved_level"))
	totalCost := parseFloatAny(firstPresent(item, "total_cost", "total_price"))
	createdAt := firstString(item, "created_at", "create_date")
	updatedAt := firstString(item, "updated_at", "last_updated")
	projectName := strings.ToUpper(joCode) + " - " + strings.ToUpper(shipName)

	return workOrderSummary{
		WOID:            woID,
		WOCode:          firstString(item, "code", "wo_code"),
		JOCode:          joCode,
		ProjectName:     projectName,
		VendorName:      workOrderVendorName(item),
		ShipName:        strings.ToUpper(shipName),
		StatusApproval:  status,
		DerivedStatus:   approvalStatusText(level, status),
		LatestDate:      dateOnly(updatedAt),
		TotalCost:       totalCost,
		CreatedSourceAt: createdAt,
		UpdatedSourceAt: updatedAt,
	}
}

func applyFinancialsFromDetail(summary workOrderSummary, raw []byte) workOrderSummary {
	data, err := dataObject(raw)
	if err != nil {
		return summary
	}
	if summary.WOID == "" {
		summary.WOID = firstString(data, "id", "wo_id")
	}
	if summary.WOCode == "" {
		summary.WOCode = firstString(data, "code", "wo_code")
	}
	if summary.JOCode == "" || summary.JOCode == "N/A" {
		summary.JOCode = workOrderJOCode(data)
	}
	if summary.ShipName == "" || summary.ShipName == "N/A" {
		summary.ShipName = strings.ToUpper(workOrderShipName(data))
	}
	if summary.ProjectName == "" || strings.EqualFold(summary.ProjectName, "N/A - N/A") {
		summary.ProjectName = strings.ToUpper(summary.JOCode) + " - " + strings.ToUpper(summary.ShipName)
	}
	if summary.VendorName == "" {
		summary.VendorName = workOrderVendorName(data)
	}
	if summary.StatusApproval == "" {
		summary.StatusApproval = firstString(data, "status_approval")
	}
	rootLevel := parseFloatAny(firstPresent(data, "min_approval_level", "approved_level"))
	rootStatus := strings.ToLower(strings.TrimSpace(summary.StatusApproval))
	summary.DerivedStatus = approvalStatusText(rootLevel, summary.StatusApproval)

	rootCreatedAt := firstString(data, "created_at", "create_date")
	rootUpdatedAt := firstString(data, "updated_at", "last_updated")
	if summary.CreatedSourceAt == "" {
		summary.CreatedSourceAt = rootCreatedAt
	}
	if summary.UpdatedSourceAt == "" {
		summary.UpdatedSourceAt = rootUpdatedAt
	}
	rootTotalCost := parseFloatAny(firstPresent(data, "total_cost", "total_price"))
	if summary.TotalCost == 0 {
		summary.TotalCost = rootTotalCost
	}

	repairList := repairListFromData(data)
	isGlobalApproved := rootLevel >= 5 || rootStatus == "approved" || rootStatus == "approved level 5"
	var latestApprove5Date string
	var latestWaitingDate string

	var scanDates func(items []interface{})
	scanDates = func(items []interface{}) {
		for _, itemRaw := range items {
			item, ok := itemRaw.(map[string]interface{})
			if !ok {
				continue
			}
			approvedLevel := parseFloatAny(item["approved_level"])
			statusAppr := strings.ToLower(strings.TrimSpace(firstString(item, "status_approval")))
			dateToUse := firstString(item, "date_approval", "updated_at", "created_at")
			if dateToUse == "" {
				dateToUse = rootUpdatedAt
			}
			if dateToUse == "" {
				dateToUse = rootCreatedAt
			}

			isAppr5 := approvedLevel >= 5 || statusAppr == "approved" || statusAppr == "approved level 5"
			isWaiting := approvedLevel == 0 || statusAppr == "waiting"
			if isAppr5 && dateToUse > latestApprove5Date {
				latestApprove5Date = dateToUse
			}
			if isWaiting && dateToUse > latestWaitingDate {
				latestWaitingDate = dateToUse
			}

			if children, ok := item["material"].([]interface{}); ok && len(children) > 0 {
				scanDates(children)
			}
		}
	}
	scanDates(repairList)

	allowLevel1To4 := latestWaitingDate == "" || latestWaitingDate <= latestApprove5Date
	dailyCosts := make(map[string]float64)
	var pendingSum, finalCostSum, rejectedSum float64

	itemCost := func(item map[string]interface{}) float64 {
		baseCost := parseFloatAny(item["volume_cost_final"])
		if baseCost == 0 {
			baseCost = parseFloatAny(item["price"])
		}
		costToAdd := float64(0)
		if baseCost > 0 {
			vol := parseFloatAny(item["volume"])
			if vol == 0 {
				vol = parseFloatAny(item["quantity"])
			}
			if vol == 0 {
				vol = parseFloatAny(item["act_quantity"])
			}
			if vol == 0 {
				vol = 1
			}
			costToAdd = baseCost * vol
		}
		if costToAdd == 0 {
			costToAdd = parseFloatAny(item["total_price"])
		}
		if costToAdd == 0 {
			costToAdd = parseFloatAny(item["total_price_details"])
		}
		if costToAdd == 0 {
			costToAdd = parseFloatAny(item["total_cost_details"])
		}
		if costToAdd == 0 {
			if parameter, ok := item["parameter"].(map[string]interface{}); ok {
				costToAdd = parseFloatAny(parameter["total_price"])
			}
		}
		return costToAdd
	}

	var processItems func(items []interface{}) float64
	processItems = func(items []interface{}) float64 {
		var processedCost float64
		for _, itemRaw := range items {
			item, ok := itemRaw.(map[string]interface{})
			if !ok {
				continue
			}
			if children, ok := item["material"].([]interface{}); ok && len(children) > 0 {
				if childCost := processItems(children); childCost > 0 {
					processedCost += childCost
					continue
				}
			}

			costToAdd := itemCost(item)
			processedCost += costToAdd

			approvedLevel := parseFloatAny(item["approved_level"])
			statusAppr := strings.ToLower(strings.TrimSpace(firstString(item, "status_approval")))
			isRejected := statusAppr == "rejected"
			isAppr5 := !isRejected && (approvedLevel >= 5 || statusAppr == "approved" || statusAppr == "approved level 5" || isGlobalApproved)
			isLevel1To4 := !isRejected && ((approvedLevel >= 1 && approvedLevel <= 4) || strings.HasPrefix(statusAppr, "level") || strings.HasPrefix(statusAppr, "approved level"))
			isAppr := isAppr5 || (allowLevel1To4 && isLevel1To4)

			if isRejected {
				rejectedSum += costToAdd
				continue
			}
			if !isAppr {
				pendingSum += costToAdd
				continue
			}

			dateToUse := firstString(item, "date_approval", "updated_at", "created_at")
			if dateToUse == "" {
				dateToUse = rootUpdatedAt
			}
			if dateToUse == "" {
				dateToUse = rootCreatedAt
			}
			if d := dateOnly(dateToUse); d != "" {
				dailyCosts[d] += costToAdd
			}
			finalCostSum += costToAdd
		}
		return processedCost
	}
	processItems(repairList)

	if isGlobalApproved {
		if finalCostSum == 0 && rootTotalCost > 0 {
			finalCostSum = rootTotalCost
		}
		pendingSum = 0
	} else if pendingSum == 0 && rootTotalCost > 0 && len(dailyCosts) == 0 {
		pendingSum = rootTotalCost
	}

	var latestDate string
	for d, cost := range dailyCosts {
		if cost > 0 && d > latestDate {
			latestDate = d
		}
	}
	if latestDate == "" {
		latestDate = dateOnly(rootUpdatedAt)
	}
	if latestDate == "" {
		latestDate = dateOnly(rootCreatedAt)
	}

	latestCost := dailyCosts[latestDate]
	previousCost := finalCostSum - latestCost
	if latestCost == 0 && finalCostSum > 0 {
		previousCost = finalCostSum
	}

	summary.PendingCost = pendingSum
	summary.FinalCost = finalCostSum
	summary.LatestCost = latestCost
	summary.PreviousCost = previousCost
	summary.RejectedCost = rejectedSum
	if latestDate != "" {
		summary.LatestDate = latestDate
	}
	return summary
}

func upsertWorkOrderSummary(summary workOrderSummary) error {
	if summary.WOID == "" {
		return nil
	}
	_, err := db.Exec(`
		INSERT INTO work_order_summary (
			wo_id, wo_code, jo_code, project_name, vendor_name, ship_name, status_approval, derived_status,
			latest_date, pending_cost, final_cost, latest_cost, previous_cost, rejected_cost, total_cost,
			created_source_at, updated_source_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(wo_id) DO UPDATE SET
			wo_code = excluded.wo_code,
			jo_code = excluded.jo_code,
			project_name = excluded.project_name,
			vendor_name = excluded.vendor_name,
			ship_name = excluded.ship_name,
			status_approval = excluded.status_approval,
			derived_status = excluded.derived_status,
			latest_date = excluded.latest_date,
			pending_cost = excluded.pending_cost,
			final_cost = excluded.final_cost,
			latest_cost = excluded.latest_cost,
			previous_cost = excluded.previous_cost,
			rejected_cost = excluded.rejected_cost,
			total_cost = excluded.total_cost,
			created_source_at = excluded.created_source_at,
			updated_source_at = excluded.updated_source_at,
			updated_at = CURRENT_TIMESTAMP
	`, summary.WOID, summary.WOCode, summary.JOCode, summary.ProjectName, summary.VendorName, summary.ShipName, summary.StatusApproval, summary.DerivedStatus,
		summary.LatestDate, summary.PendingCost, summary.FinalCost, summary.LatestCost, summary.PreviousCost, summary.RejectedCost, summary.TotalCost,
		summary.CreatedSourceAt, summary.UpdatedSourceAt)
	return err
}

func UpsertWorkOrderSummaryFromDetail(woID string, raw []byte) error {
	summary := workOrderSummary{WOID: woID}
	summary = applyFinancialsFromDetail(summary, raw)
	return upsertWorkOrderSummary(summary)
}

func workOrdersMasterResponse() (string, error) {
	if db.RDB != nil {
		if value, err := db.RDB.Get(db.Ctx, "cache:WorkOrders").Result(); err == nil && value != "" {
			return value, nil
		}
	}

	var lastResponse string
	err := db.QueryRow("SELECT COALESCE(last_response, '') FROM sync_configs WHERE id = 'WorkOrders'").Scan(&lastResponse)
	return lastResponse, err
}

func workOrderListFromResponse(raw string) []interface{} {
	if raw == "" {
		return nil
	}
	var parsed interface{}
	if json.Unmarshal([]byte(raw), &parsed) != nil {
		return nil
	}
	switch value := parsed.(type) {
	case []interface{}:
		return value
	case map[string]interface{}:
		if data, ok := value["data"].([]interface{}); ok {
			return data
		}
	}
	return nil
}

func UpsertWorkOrderSummariesFromMasterCache() (int, error) {
	lastResponse, err := workOrdersMasterResponse()
	if err != nil {
		return 0, err
	}

	count := 0
	for _, rawItem := range workOrderListFromResponse(lastResponse) {
		if count >= 1000 {
			break
		}
		item, ok := rawItem.(map[string]interface{})
		if !ok {
			continue
		}
		summary := summaryFromWorkOrderListItem(item)
		if summary.WOID == "" {
			continue
		}
		if err := upsertWorkOrderSummary(summary); err == nil {
			count++
		}
	}
	return count, nil
}

func BackfillWorkOrderSummaries() (int, error) {
	summaries := map[string]workOrderSummary{}

	lastResponse, err := workOrdersMasterResponse()
	if err == nil {
		for _, rawItem := range workOrderListFromResponse(lastResponse) {
			item, ok := rawItem.(map[string]interface{})
			if !ok {
				continue
			}
			summary := summaryFromWorkOrderListItem(item)
			if summary.WOID != "" {
				summaries[summary.WOID] = summary
			}
		}
	}

	rows, err := db.Query("SELECT wo_id, raw_json FROM work_order_details")
	if err != nil && err != sql.ErrNoRows {
		return 0, err
	}
	if rows != nil {
		defer rows.Close()
		for rows.Next() {
			var woID string
			var rawJSON []byte
			if rows.Scan(&woID, &rawJSON) != nil {
				continue
			}
			summary := summaries[woID]
			summary.WOID = woID
			summaries[woID] = applyFinancialsFromDetail(summary, rawJSON)
		}
	}

	count := 0
	for _, summary := range summaries {
		if err := upsertWorkOrderSummary(summary); err == nil {
			count++
		}
	}
	return count, nil
}

func BackfillWorkOrderSummariesHandler(w http.ResponseWriter, r *http.Request) {
	count, err := BackfillWorkOrderSummaries()
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"success": true, "count": count})
}

func GetWorkOrders(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 25
	}
	offset := (page - 1) * limit

	whereSQL, args, sortCol, dir := workOrderSummaryFilters(r)
	var total int
	countArgs := append([]interface{}{}, args...)
	_ = db.QueryRow("SELECT COUNT(*) FROM work_order_summary WHERE "+whereSQL, countArgs...).Scan(&total)

	dataArgs := append([]interface{}{}, args...)
	dataArgs = append(dataArgs, limit, offset)
	rows, err := db.Query(`
		SELECT wo_id, wo_code, jo_code, project_name, vendor_name, ship_name, status_approval, derived_status,
			COALESCE(latest_date, ''), pending_cost, final_cost, latest_cost, previous_cost, rejected_cost, total_cost,
			COALESCE(created_source_at, ''), COALESCE(updated_source_at, '')
		FROM work_order_summary
		WHERE `+whereSQL+`
		ORDER BY `+sortCol+` `+dir+`
		LIMIT ? OFFSET ?
	`, dataArgs...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"data": scanWorkOrderSummaryRows(rows), "total": total, "page": page, "limit": limit})
}

func GetWorkOrdersExport(w http.ResponseWriter, r *http.Request) {
	whereSQL, args, sortCol, dir := workOrderSummaryFilters(r)
	rows, err := db.Query(`
		SELECT wo_id, wo_code, jo_code, project_name, vendor_name, ship_name, status_approval, derived_status,
			COALESCE(latest_date, ''), pending_cost, final_cost, latest_cost, previous_cost, rejected_cost, total_cost,
			COALESCE(created_source_at, ''), COALESCE(updated_source_at, '')
		FROM work_order_summary
		WHERE `+whereSQL+`
		ORDER BY `+sortCol+` `+dir+`
	`, args...)
	if err != nil {
		http.Error(w, "Export failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="Export_WorkOrder.csv"`)
	w.Write([]byte("No;Kode WO;Kode JO;Proyek (Kapal);Vendor Rekanan;Nilai Total;Nilai Sebelumnya;Nilai Saat Ini;Pending Approval;Terakhir Diperbarui;Status Approval\n"))

	for idx, item := range scanWorkOrderSummaryRows(rows) {
		line := fmt.Sprintf("%d;%s;%s;%s;%s;%.0f;%.0f;%.0f;%.0f;%s;%s\n",
			idx+1,
			csvCell(item.WOCode),
			csvCell(item.JOCode),
			csvCell(item.ShipName),
			csvCell(item.VendorName),
			item.TotalCost,
			item.PreviousCost,
			item.LatestCost,
			item.PendingCost,
			csvCell(item.UpdatedSourceAt),
			csvCell(item.DerivedStatus),
		)
		w.Write([]byte(line))
	}
}

func csvCell(value string) string {
	escaped := strings.ReplaceAll(value, `"`, `""`)
	return `"` + escaped + `"`
}

func GetWorkOrderTimeline(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	start := strings.TrimSpace(q.Get("start"))
	end := strings.TrimSpace(q.Get("end"))
	group := strings.TrimSpace(q.Get("group"))
	if group == "" {
		group = "month"
	}

	where := []string{"latest_date IS NOT NULL", "latest_date <> ''"}
	args := []interface{}{}
	if start != "" {
		where = append(where, "latest_date >= ?")
		args = append(args, start)
	}
	if end != "" {
		where = append(where, "latest_date <= ?")
		args = append(args, end)
	}
	if vendor := strings.TrimSpace(q.Get("vendor")); vendor != "" && vendor != "All" {
		where = append(where, "vendor_name = ?")
		args = append(args, vendor)
	}
	if project := strings.TrimSpace(q.Get("project")); project != "" && project != "All" {
		where = append(where, "project_name = ?")
		args = append(args, project)
	}
	if status := strings.TrimSpace(q.Get("status")); status != "" && status != "All" {
		where = append(where, "(derived_status = ? OR status_approval = ?)")
		args = append(args, status, status)
	}

	rows, err := db.Query(`
		SELECT latest_date, latest_cost, final_cost
		FROM work_order_summary
		WHERE `+strings.Join(where, " AND ")+`
	`, args...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type bucket struct {
		Period string  `json:"period"`
		Cost   float64 `json:"cost"`
		Count  int     `json:"count"`
	}
	buckets := map[string]*bucket{}
	for rows.Next() {
		var date string
		var latestCost, finalCost float64
		if rows.Scan(&date, &latestCost, &finalCost) != nil {
			continue
		}
		key := timelineKey(date, group)
		if key == "" {
			continue
		}
		if buckets[key] == nil {
			buckets[key] = &bucket{Period: key}
		}
		cost := latestCost
		if cost == 0 {
			cost = finalCost
		}
		buckets[key].Cost += cost
		buckets[key].Count++
	}

	keys := make([]string, 0, len(buckets))
	for key := range buckets {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make([]bucket, 0, len(keys))
	for _, key := range keys {
		result = append(result, *buckets[key])
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

func GetWorkOrderStats(w http.ResponseWriter, r *http.Request) {
	whereSQL, args, _, _ := workOrderSummaryFilters(r)
	if trend := strings.TrimSpace(r.URL.Query().Get("trend_date")); trend != "" {
		group := strings.TrimSpace(r.URL.Query().Get("group"))
		rows, err := db.Query(`
			SELECT wo_id, wo_code, jo_code, project_name, vendor_name, ship_name, status_approval, derived_status,
				COALESCE(latest_date, ''), pending_cost, final_cost, latest_cost, previous_cost, rejected_cost, total_cost,
				COALESCE(created_source_at, ''), COALESCE(updated_source_at, '')
			FROM work_order_summary
			WHERE `+whereSQL+`
		`, args...)
		if err != nil {
			http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
			return
		}
		items := scanWorkOrderSummaryRows(rows)
		rows.Close()
		filtered := make([]workOrderSummary, 0, len(items))
		for _, item := range items {
			if timelineKey(item.LatestDate, group) == trend {
				filtered = append(filtered, item)
			}
		}
		writeWorkOrderStats(w, filtered)
		return
	}

	rows, err := db.Query(`
		SELECT wo_id, wo_code, jo_code, project_name, vendor_name, ship_name, status_approval, derived_status,
			COALESCE(latest_date, ''), pending_cost, final_cost, latest_cost, previous_cost, rejected_cost, total_cost,
			COALESCE(created_source_at, ''), COALESCE(updated_source_at, '')
		FROM work_order_summary
		WHERE `+whereSQL+`
	`, args...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	writeWorkOrderStats(w, scanWorkOrderSummaryRows(rows))
}

func writeWorkOrderStats(w http.ResponseWriter, items []workOrderSummary) {
	joSet := map[string]bool{}
	vendorSet := map[string]bool{}
	projectSet := map[string]bool{}
	approvalCounts := map[string]int{
		"Waiting":          0,
		"Approval Level 1": 0,
		"Approval Level 2": 0,
		"Approval Level 3": 0,
		"Approval Level 4": 0,
		"Approval Level 5": 0,
	}
	var sumTotal, sumSebelumnya, sumSaatIni, sumPending float64
	for _, item := range items {
		if item.JOCode != "" && item.JOCode != "N/A" {
			joSet[item.JOCode] = true
		}
		if item.VendorName != "" {
			vendorSet[item.VendorName] = true
		}
		if item.ProjectName != "" {
			projectSet[item.ProjectName] = true
		}
		sumTotal += item.TotalCost
		sumSebelumnya += item.PreviousCost
		sumSaatIni += item.LatestCost
		sumPending += item.PendingCost
		approvalCounts[item.DerivedStatus]++
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"totalWOs":       len(items),
		"totalJOs":       len(joSet),
		"totalVendors":   len(vendorSet),
		"totalProjects":  len(projectSet),
		"totalCostValue": sumSaatIni,
		"sumTotal":       sumTotal,
		"sumSebelumnya":  sumSebelumnya,
		"sumSaatIni":     sumSaatIni,
		"sumPending":     sumPending,
		"approvalCounts": approvalCounts,
	})
}

func GetProjectWorkOrderSummaries(w http.ResponseWriter, r *http.Request) {
	whereSQL, args, sortCol, dir := workOrderSummaryFilters(r)
	if sortCol == "latest_date" {
		sortCol = "MAX(latest_date)"
	}
	rows, err := db.Query(`
		SELECT
			project_name,
			MIN(jo_code) AS jo_code,
			MIN(ship_name) AS ship_name,
			COUNT(*) AS wo_count,
			COUNT(DISTINCT vendor_name) AS vendor_count,
			COALESCE(SUM(total_cost), 0) AS total_cost,
			COALESCE(SUM(previous_cost), 0) AS previous_cost,
			COALESCE(SUM(latest_cost), 0) AS latest_cost,
			COALESCE(SUM(final_cost), 0) AS final_cost,
			COALESCE(SUM(pending_cost), 0) AS pending_cost,
			COALESCE(SUM(rejected_cost), 0) AS rejected_cost,
			COALESCE(MAX(latest_date), '') AS latest_date
		FROM work_order_summary
		WHERE `+whereSQL+`
		GROUP BY project_name
		ORDER BY `+sortCol+` `+dir+`
	`, args...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type projectSummary struct {
		ProjectName  string  `json:"project_name"`
		JOCode       string  `json:"jo_code"`
		ShipName     string  `json:"ship_name"`
		WOCount      int     `json:"wo_count"`
		VendorCount  int     `json:"vendor_count"`
		TotalCost    float64 `json:"total_cost"`
		PreviousCost float64 `json:"previous_cost"`
		LatestCost   float64 `json:"latest_cost"`
		FinalCost    float64 `json:"final_cost"`
		PendingCost  float64 `json:"pending_cost"`
		RejectedCost float64 `json:"rejected_cost"`
		LatestDate   string  `json:"latest_date"`
	}
	items := []projectSummary{}
	for rows.Next() {
		var item projectSummary
		if rows.Scan(&item.ProjectName, &item.JOCode, &item.ShipName, &item.WOCount, &item.VendorCount, &item.TotalCost, &item.PreviousCost, &item.LatestCost, &item.FinalCost, &item.PendingCost, &item.RejectedCost, &item.LatestDate) == nil {
			items = append(items, item)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"data": items, "total": len(items)})
}

func GetProjectWorkOrderDetail(w http.ResponseWriter, r *http.Request) {
	projectName := strings.TrimSpace(r.URL.Query().Get("project"))
	if projectName == "" {
		http.Error(w, `{"error": "project query is required"}`, http.StatusBadRequest)
		return
	}
	query := r.Clone(r.Context())
	q := query.URL.Query()
	q.Set("project", projectName)
	query.URL.RawQuery = q.Encode()
	whereSQL, args, _, _ := workOrderSummaryFilters(query)

	rows, err := db.Query(`
		SELECT wo_id, wo_code, jo_code, project_name, vendor_name, ship_name, status_approval, derived_status,
			COALESCE(latest_date, ''), pending_cost, final_cost, latest_cost, previous_cost, rejected_cost, total_cost,
			COALESCE(created_source_at, ''), COALESCE(updated_source_at, '')
		FROM work_order_summary
		WHERE `+whereSQL+`
		ORDER BY latest_date DESC
	`, args...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	items := scanWorkOrderSummaryRows(rows)
	rows.Close()

	vendors := map[string]map[string]interface{}{}
	statusCounts := map[string]int{}
	timeline := map[string]map[string]interface{}{}
	var total, previous, latest, final, pending, rejected float64
	for _, item := range items {
		total += item.TotalCost
		previous += item.PreviousCost
		latest += item.LatestCost
		final += item.FinalCost
		pending += item.PendingCost
		rejected += item.RejectedCost
		statusCounts[item.DerivedStatus]++
		if vendors[item.VendorName] == nil {
			vendors[item.VendorName] = map[string]interface{}{"vendor_name": item.VendorName, "wo_count": 0, "total_cost": float64(0), "latest_cost": float64(0), "pending_cost": float64(0)}
		}
		vendors[item.VendorName]["wo_count"] = vendors[item.VendorName]["wo_count"].(int) + 1
		vendors[item.VendorName]["total_cost"] = vendors[item.VendorName]["total_cost"].(float64) + item.TotalCost
		vendors[item.VendorName]["latest_cost"] = vendors[item.VendorName]["latest_cost"].(float64) + item.LatestCost
		vendors[item.VendorName]["pending_cost"] = vendors[item.VendorName]["pending_cost"].(float64) + item.PendingCost
		if item.LatestDate != "" {
			key := item.LatestDate
			if timeline[key] == nil {
				timeline[key] = map[string]interface{}{"period": key, "cost": float64(0), "count": 0}
			}
			timeline[key]["cost"] = timeline[key]["cost"].(float64) + item.LatestCost
			timeline[key]["count"] = timeline[key]["count"].(int) + 1
		}
	}

	vendorList := make([]map[string]interface{}, 0, len(vendors))
	for _, value := range vendors {
		vendorList = append(vendorList, value)
	}
	sort.Slice(vendorList, func(i, j int) bool {
		return vendorList[i]["total_cost"].(float64) > vendorList[j]["total_cost"].(float64)
	})
	timelineKeys := make([]string, 0, len(timeline))
	for key := range timeline {
		timelineKeys = append(timelineKeys, key)
	}
	sort.Strings(timelineKeys)
	timelineList := make([]map[string]interface{}, 0, len(timelineKeys))
	for _, key := range timelineKeys {
		timelineList = append(timelineList, timeline[key])
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"project_name": projectName,
		"summary": map[string]interface{}{
			"wo_count":      len(items),
			"vendor_count":  len(vendors),
			"total_cost":    total,
			"previous_cost": previous,
			"latest_cost":   latest,
			"final_cost":    final,
			"pending_cost":  pending,
			"rejected_cost": rejected,
		},
		"work_orders":      items,
		"vendor_breakdown": vendorList,
		"status_breakdown": statusCounts,
		"timeline":         timelineList,
	})
}

func timelineKey(value string, group string) string {
	date := dateOnly(value)
	if date == "" {
		return ""
	}
	switch group {
	case "day", "daily":
		return date
	case "week", "weekly":
		t, err := time.Parse("2006-01-02", date)
		if err != nil {
			return date
		}
		weekday := int(t.Weekday())
		if weekday == 0 {
			weekday = 7
		}
		return t.AddDate(0, 0, -(weekday - 1)).Format("2006-01-02")
	case "year", "yearly":
		if len(date) >= 4 {
			return date[:4]
		}
	case "quarter", "quarterly":
		if len(date) >= 7 {
			t, err := time.Parse("2006-01", date[:7])
			if err == nil {
				q := ((int(t.Month()) - 1) / 3) + 1
				return fmt.Sprintf("%04d-Q%d", t.Year(), q)
			}
		}
	default:
		if len(date) >= 7 {
			return date[:7]
		}
	}
	return date
}
