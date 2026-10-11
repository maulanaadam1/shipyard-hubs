package handlers

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"shipyard/db"
)

// Work item search over wo_items (leaf items flattened from WO details),
// joined with work_order_summary for WO / project / vendor context.

// woItemFilters builds the WHERE clause shared by the item list and summaries.
func woItemFilters(q url.Values) (string, []interface{}) {
	where := []string{"1=1"}
	args := []interface{}{}
	if search := strings.ToLower(strings.TrimSpace(q.Get("search"))); search != "" {
		like := "%" + search + "%"
		where = append(where, "(LOWER(i.label) LIKE ? OR LOWER(i.activity_name) LIKE ?)")
		args = append(args, like, like)
	}
	if wo := strings.ToLower(strings.TrimSpace(q.Get("wo"))); wo != "" {
		where = append(where, "LOWER(s.wo_code) LIKE ?")
		args = append(args, "%"+wo+"%")
	}
	for param, column := range map[string]string{"project": "s.project_name", "category": "i.category", "activity": "i.activity_name", "label": "i.label", "status": "i.status", "unit": "i.unit"} {
		if v := strings.TrimSpace(q.Get(param)); v != "" && v != "All" {
			where = append(where, column+" = ?")
			args = append(args, v)
		}
	}
	if vendor := strings.TrimSpace(q.Get("vendor")); vendor == noVendorLabel {
		where = append(where, "COALESCE(s.vendor_name, '') = ''")
	} else if vendor != "" && vendor != "All" {
		where = append(where, "s.vendor_name = ?")
		args = append(args, vendor)
	}
	if clause := projectTypeClause("s.", q.Get("project_type")); clause != "" {
		where = append(where, clause)
	}
	if start := strings.TrimSpace(q.Get("start_date")); start != "" {
		where = append(where, "i.approval_date >= ?")
		args = append(args, start)
	}
	if end := strings.TrimSpace(q.Get("end_date")); end != "" {
		where = append(where, "i.approval_date <= ?")
		args = append(args, end)
	}
	return strings.Join(where, " AND "), args
}

func pageParams(q url.Values, defLimit, maxLimit int) (int, int) {
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > maxLimit {
		limit = defLimit
	}
	return page, limit
}

func sortDir(q url.Values) string {
	if strings.EqualFold(q.Get("dir"), "asc") {
		return "ASC"
	}
	return "DESC"
}

// GetWorkOrderItems lists leaf work items with their WO context.
func GetWorkOrderItems(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where, args := woItemFilters(q)
	page, limit := pageParams(q, 25, 200)
	sortCols := map[string]string{
		"total_cost":    "i.total_cost",
		"unit_cost":     "i.unit_cost",
		"volume":        "i.volume",
		"approval_date": "i.approval_date",
		"label":         "i.label",
		"wo_code":       "s.wo_code",
		"project_name":  "s.project_name",
	}
	sortCol := sortCols[q.Get("sort")]
	if sortCol == "" {
		sortCol = "i.total_cost"
	}

	from := ` FROM wo_items i JOIN work_order_summary s ON s.wo_id = i.wo_id WHERE ` + where
	var total int
	var totalCost, totalVolume float64
	db.QueryRow("SELECT COUNT(*), COALESCE(SUM(i.total_cost), 0), COALESCE(SUM(i.volume), 0)"+from, args...).Scan(&total, &totalCost, &totalVolume)

	rows, err := db.Query(`SELECT i.wo_id, i.item_id, COALESCE(i.category, ''), COALESCE(i.activity_name, ''), COALESCE(i.path, ''),
			COALESCE(i.label, ''), COALESCE(i.unit, ''), COALESCE(i.volume, 0), COALESCE(i.unit_cost, 0), COALESCE(i.total_cost, 0),
			COALESCE(i.approved_level, 0), COALESCE(i.status, ''), COALESCE(i.approval_date, ''),
			COALESCE(s.wo_code, ''), COALESCE(s.jo_code, ''), COALESCE(s.project_name, ''), COALESCE(s.vendor_name, ''),
			COALESCE(s.ship_name, ''), COALESCE(s.project_type, 'external')`+from+`
		ORDER BY `+sortCol+` `+sortDir(q)+`, i.wo_id, i.path LIMIT ? OFFSET ?`, append(args, limit, (page-1)*limit)...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type itemRow struct {
		WOID         string  `json:"wo_id"`
		ItemID       string  `json:"item_id"`
		Category     string  `json:"category"`
		ActivityName string  `json:"activity_name"`
		Path         string  `json:"path"`
		Label        string  `json:"label"`
		Unit         string  `json:"unit"`
		Volume       float64 `json:"volume"`
		UnitCost     float64 `json:"unit_cost"`
		TotalCost    float64 `json:"total_cost"`
		Level        int     `json:"approved_level"`
		Status       string  `json:"status"`
		ApprovalDate string  `json:"approval_date"`
		WOCode       string  `json:"wo_code"`
		JOCode       string  `json:"jo_code"`
		ProjectName  string  `json:"project_name"`
		VendorName   string  `json:"vendor_name"`
		ShipName     string  `json:"ship_name"`
		ProjectType  string  `json:"project_type"`
	}
	data := []itemRow{}
	for rows.Next() {
		var it itemRow
		if rows.Scan(&it.WOID, &it.ItemID, &it.Category, &it.ActivityName, &it.Path, &it.Label, &it.Unit, &it.Volume, &it.UnitCost,
			&it.TotalCost, &it.Level, &it.Status, &it.ApprovalDate, &it.WOCode, &it.JOCode, &it.ProjectName, &it.VendorName,
			&it.ShipName, &it.ProjectType) == nil {
			data = append(data, it)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data": data, "total": total, "page": page, "limit": limit,
		"totalCost": totalCost, "totalVolume": totalVolume,
	})
}

// woItemGroups are the supported groupings for the summary: key expressions
// and the label columns returned for each.
var woItemGroups = map[string]struct {
	keys   []string // SQL expressions grouped by
	labels []string // JSON names for those expressions
}{
	"category":         {[]string{"COALESCE(i.category, '')"}, []string{"category"}},
	"activity":         {[]string{"COALESCE(i.activity_name, '')"}, []string{"activity_name"}},
	"item":             {[]string{"COALESCE(i.label, '')", "COALESCE(i.unit, '')"}, []string{"label", "unit"}},
	"project":          {[]string{"COALESCE(s.project_name, '')"}, []string{"project_name"}},
	"vendor":           {[]string{"COALESCE(s.vendor_name, '')"}, []string{"vendor_name"}},
	"project_activity": {[]string{"COALESCE(s.project_name, '')", "COALESCE(i.activity_name, '')"}, []string{"project_name", "activity_name"}},
	"project_item":     {[]string{"COALESCE(s.project_name, '')", "COALESCE(i.label, '')", "COALESCE(i.unit, '')"}, []string{"project_name", "label", "unit"}},
	"vendor_activity":  {[]string{"COALESCE(s.vendor_name, '')", "COALESCE(i.activity_name, '')"}, []string{"vendor_name", "activity_name"}},
}

// GetWorkOrderItemSummary aggregates items by the requested group: item and WO
// counts, total volume and cost, and min / volume-weighted average / max unit cost.
func GetWorkOrderItemSummary(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	group, ok := woItemGroups[q.Get("group")]
	if !ok {
		group = woItemGroups["activity"]
	}
	where, args := woItemFilters(q)
	page, limit := pageParams(q, 25, 200)
	sortCols := map[string]string{
		"total_cost": "total_cost", "item_count": "item_count", "wo_count": "wo_count",
		"total_volume": "total_volume", "avg_cost": "avg_cost", "max_cost": "max_cost", "min_cost": "min_cost",
	}
	sortCol := sortCols[q.Get("sort")]
	if sortCol == "" {
		sortCol = "total_cost"
	}

	keyList := strings.Join(group.keys, ", ")
	from := ` FROM wo_items i JOIN work_order_summary s ON s.wo_id = i.wo_id WHERE ` + where
	var totalGroups int
	db.QueryRow("SELECT COUNT(*) FROM (SELECT 1"+from+" GROUP BY "+keyList+") g", args...).Scan(&totalGroups)

	rows, err := db.Query(`SELECT `+keyList+`,
			COUNT(*) AS item_count,
			COUNT(DISTINCT i.wo_id) AS wo_count,
			COALESCE(SUM(i.volume), 0) AS total_volume,
			COALESCE(SUM(i.total_cost), 0) AS total_cost,
			COALESCE(MIN(CASE WHEN i.unit_cost > 0 THEN i.unit_cost END), 0) AS min_cost,
			CASE WHEN SUM(CASE WHEN i.unit_cost > 0 THEN i.volume ELSE 0 END) > 0
				THEN SUM(CASE WHEN i.unit_cost > 0 THEN i.total_cost ELSE 0 END) / SUM(CASE WHEN i.unit_cost > 0 THEN i.volume ELSE 0 END)
				ELSE 0 END AS avg_cost,
			COALESCE(MAX(i.unit_cost), 0) AS max_cost`+from+`
		GROUP BY `+keyList+`
		ORDER BY `+sortCol+` `+sortDir(q)+`
		LIMIT ? OFFSET ?`, append(args, limit, (page-1)*limit)...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	data := []map[string]interface{}{}
	for rows.Next() {
		keys := make([]string, len(group.keys))
		var itemCount, woCount int
		var volume, cost, minCost, avgCost, maxCost float64
		dest := make([]interface{}, 0, len(keys)+7)
		for i := range keys {
			dest = append(dest, &keys[i])
		}
		dest = append(dest, &itemCount, &woCount, &volume, &cost, &minCost, &avgCost, &maxCost)
		if rows.Scan(dest...) != nil {
			continue
		}
		row := map[string]interface{}{
			"item_count": itemCount, "wo_count": woCount, "total_volume": volume, "total_cost": cost,
			"min_cost": minCost, "avg_cost": avgCost, "max_cost": maxCost,
		}
		for i, name := range group.labels {
			row[name] = keys[i]
		}
		data = append(data, row)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"data": data, "total": totalGroups, "page": page, "limit": limit, "group": q.Get("group")})
}

// GetWorkOrderItemFacets returns the filter options for the item page.
func GetWorkOrderItemFacets(w http.ResponseWriter, r *http.Request) {
	result := map[string]interface{}{}
	collect := func(key, query string) {
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
		result[key] = values
	}
	collect("categories", `SELECT DISTINCT category FROM wo_items WHERE COALESCE(category, '') <> '' ORDER BY 1`)
	collect("units", `SELECT unit FROM wo_items WHERE COALESCE(unit, '') <> '' GROUP BY unit ORDER BY COUNT(*) DESC LIMIT 50`)
	var items, wos int
	db.QueryRow(`SELECT COUNT(*), COUNT(DISTINCT wo_id) FROM wo_items`).Scan(&items, &wos)
	result["itemCount"] = items
	result["woCount"] = wos
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}
