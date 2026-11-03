package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"shipyard/db"
)

// Work item search over wo_items (leaf items flattened from WO details),
// joined with work_order_summary for WO / project / vendor context.

// itemDateExpr is an item's date for "newest first": its approval date, or for
// items not approved yet, the date its WO was last updated in SIAGA.
const itemDateExpr = "COALESCE(NULLIF(i.approval_date, ''), SUBSTR(COALESCE(s.updated_source_at, ''), 1, 10))"

const woItemFrom = ` FROM wo_items i JOIN work_order_summary s ON s.wo_id = i.wo_id WHERE `

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
	// unit_key (repeatable): normalized units, as listed in a volume_by_unit entry.
	if keys := q["unit_key"]; len(keys) > 0 {
		marks := make([]string, len(keys))
		for i, k := range keys {
			marks[i] = "?"
			args = append(args, k)
		}
		where = append(where, woItemUnitKey+" IN ("+strings.Join(marks, ", ")+")")
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

// woItemOrder is the ORDER BY of the item list and its export: the requested
// column (newest item first by default) with stable tie-breakers.
func woItemOrder(q url.Values) string {
	sortCols := map[string]string{
		"total_cost":    "i.total_cost",
		"unit_cost":     "i.unit_cost",
		"volume":        "i.volume",
		"approval_date": itemDateExpr,
		"item_date":     itemDateExpr,
		"label":         "i.label",
		"wo_code":       "s.wo_code",
		"project_name":  "s.project_name",
	}
	sortCol := sortCols[q.Get("sort")]
	if sortCol == "" {
		sortCol = itemDateExpr
	}
	return sortCol + " " + sortDir(q) + ", i.total_cost DESC, i.wo_id, i.path"
}

const woItemColumns = `SELECT i.wo_id, i.item_id, COALESCE(i.category, ''), COALESCE(i.activity_name, ''), COALESCE(i.path, ''),
		COALESCE(i.label, ''), COALESCE(i.unit, ''), COALESCE(i.volume, 0), COALESCE(i.unit_cost, 0), COALESCE(i.total_cost, 0),
		COALESCE(i.approved_level, 0), COALESCE(i.status, ''), COALESCE(i.approval_date, ''),
		COALESCE(s.wo_code, ''), COALESCE(s.jo_code, ''), COALESCE(s.project_name, ''), COALESCE(s.vendor_name, ''),
		COALESCE(s.ship_name, ''), COALESCE(s.project_type, 'external'), ` + itemDateExpr + ` AS item_date`

type woItemRow struct {
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
	ItemDate     string  `json:"item_date"`
}

func scanWoItem(rows *sql.Rows) (woItemRow, error) {
	var it woItemRow
	err := rows.Scan(&it.WOID, &it.ItemID, &it.Category, &it.ActivityName, &it.Path, &it.Label, &it.Unit, &it.Volume, &it.UnitCost,
		&it.TotalCost, &it.Level, &it.Status, &it.ApprovalDate, &it.WOCode, &it.JOCode, &it.ProjectName, &it.VendorName,
		&it.ShipName, &it.ProjectType, &it.ItemDate)
	return it, err
}

// GetWorkOrderItems lists leaf work items with their WO context.
func GetWorkOrderItems(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where, args := woItemFilters(q)
	page, limit := pageParams(q, 25, 200)

	from := woItemFrom + where
	// The totals and the page are independent scans: run them side by side.
	var total int
	var totalCost, totalVolume float64
	totalsDone := make(chan struct{})
	go func() {
		defer close(totalsDone)
		db.QueryRow("SELECT COUNT(*), COALESCE(SUM(i.total_cost), 0), COALESCE(SUM(i.volume), 0)"+from, args...).Scan(&total, &totalCost, &totalVolume)
	}()

	rows, err := db.Query(woItemColumns+from+` ORDER BY `+woItemOrder(q)+` LIMIT ? OFFSET ?`, append(args, limit, (page-1)*limit)...)
	if err != nil {
		<-totalsDone
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	data := []woItemRow{}
	for rows.Next() {
		if it, err := scanWoItem(rows); err == nil {
			data = append(data, it)
		}
	}
	<-totalsDone

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data": data, "total": total, "page": page, "limit": limit,
		"totalCost": totalCost, "totalVolume": totalVolume,
	})
}

type woItemGroup struct {
	keys   []string // SQL expressions grouped by
	labels []string // JSON names for those expressions
}

// keyList is the group's key expressions for SELECT and GROUP BY. On
// PostgreSQL they compare byte-wise (COLLATE "C"): almost every item is its own
// group, and sorting ~400k labels with the database's language collation took
// most of the query (Per Item 4.6 s, 1.5 s byte-wise). Groups are unchanged,
// since texts are only equal when their bytes are, under any collation.
func (g woItemGroup) keyList() string {
	if os.Getenv("DB_CONNECTION") != "postgres" {
		return strings.Join(g.keys, ", ")
	}
	keys := make([]string, len(g.keys))
	for i, k := range g.keys {
		keys[i] = k + ` COLLATE "C"`
	}
	return strings.Join(keys, ", ")
}

// woItemGroups are the supported groupings for the summary: key expressions
// and the label columns returned for each.
var woItemGroups = map[string]woItemGroup{
	"category":         {[]string{"COALESCE(i.category, '')"}, []string{"category"}},
	"activity":         {[]string{"COALESCE(i.activity_name, '')"}, []string{"activity_name"}},
	"item":             {[]string{"COALESCE(i.label, '')", "COALESCE(i.unit, '')"}, []string{"label", "unit"}},
	"project":          {[]string{"COALESCE(s.project_name, '')"}, []string{"project_name"}},
	"vendor":           {[]string{"COALESCE(s.vendor_name, '')"}, []string{"vendor_name"}},
	"project_activity": {[]string{"COALESCE(s.project_name, '')", "COALESCE(i.activity_name, '')"}, []string{"project_name", "activity_name"}},
	"project_item":     {[]string{"COALESCE(s.project_name, '')", "COALESCE(i.label, '')", "COALESCE(i.unit, '')"}, []string{"project_name", "label", "unit"}},
	"vendor_activity":  {[]string{"COALESCE(s.vendor_name, '')", "COALESCE(i.activity_name, '')"}, []string{"vendor_name", "activity_name"}},
}

// woItemSummarySQL is the grouped query of a summary view, without paging:
// item and WO counts, total volume and cost, min / volume-weighted average /
// max unit cost and the newest item date, newest group first by default.
// withTotal adds total_groups (the number of groups before LIMIT), so a page
// and its group count come from one aggregation instead of two.
func woItemSummarySQL(q url.Values, group woItemGroup, where string, withTotal bool) string {
	sortCols := map[string]string{
		"total_cost": "total_cost", "item_count": "item_count", "wo_count": "wo_count",
		"total_volume": "total_volume", "avg_cost": "avg_cost", "max_cost": "max_cost", "min_cost": "min_cost",
		"latest_date": "latest_date",
	}
	sortCol := sortCols[q.Get("sort")]
	if sortCol == "" {
		sortCol = "latest_date"
	}
	keyList := group.keyList()
	totalCol := ""
	if withTotal {
		totalCol = ",\n\t\t\tCOUNT(*) OVER () AS total_groups"
	}
	return `SELECT ` + keyList + `,
			COUNT(*) AS item_count,
			COUNT(DISTINCT i.wo_id) AS wo_count,
			COALESCE(SUM(i.volume), 0) AS total_volume,
			COALESCE(SUM(i.total_cost), 0) AS total_cost,
			COALESCE(MIN(CASE WHEN i.unit_cost > 0 THEN i.unit_cost END), 0) AS min_cost,
			CASE WHEN SUM(CASE WHEN i.unit_cost > 0 THEN i.volume ELSE 0 END) > 0
				THEN SUM(CASE WHEN i.unit_cost > 0 THEN i.total_cost ELSE 0 END) / SUM(CASE WHEN i.unit_cost > 0 THEN i.volume ELSE 0 END)
				ELSE 0 END AS avg_cost,
			COALESCE(MAX(i.unit_cost), 0) AS max_cost,
			COALESCE(MAX(` + itemDateExpr + `), '') AS latest_date` + totalCol + woItemFrom + where + `
		GROUP BY ` + keyList + `
		ORDER BY ` + sortCol + ` ` + sortDir(q) + `, total_cost DESC, ` + keyList
}

type woItemSummaryRow struct {
	Keys                                    []string
	ItemCount, WOCount                      int
	Volume, Cost, MinCost, AvgCost, MaxCost float64
	LatestDate                              string
	TotalGroups                             int // only with woItemSummarySQL(..., true)
}

func scanWoItemSummary(rows *sql.Rows, group woItemGroup, withTotal bool) (woItemSummaryRow, error) {
	s := woItemSummaryRow{Keys: make([]string, len(group.keys))}
	dest := make([]interface{}, 0, len(group.keys)+9)
	for i := range s.Keys {
		dest = append(dest, &s.Keys[i])
	}
	dest = append(dest, &s.ItemCount, &s.WOCount, &s.Volume, &s.Cost, &s.MinCost, &s.AvgCost, &s.MaxCost, &s.LatestDate)
	if withTotal {
		dest = append(dest, &s.TotalGroups)
	}
	return s, rows.Scan(dest...)
}

// GetWorkOrderItemSummary aggregates items by the requested group.
func GetWorkOrderItemSummary(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	group, ok := woItemGroups[q.Get("group")]
	if !ok {
		group = woItemGroups["activity"]
	}
	where, args := woItemFilters(q)
	page, limit := pageParams(q, 25, 200)

	rows, err := db.Query(woItemSummarySQL(q, group, where, true)+` LIMIT ? OFFSET ?`, append(args, limit, (page-1)*limit)...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	totalGroups := -1
	data := []map[string]interface{}{}
	var pageKeys [][]string
	for rows.Next() {
		s, err := scanWoItemSummary(rows, group, true)
		if err != nil {
			continue
		}
		totalGroups = s.TotalGroups
		row := map[string]interface{}{
			"item_count": s.ItemCount, "wo_count": s.WOCount, "total_volume": s.Volume, "total_cost": s.Cost,
			"min_cost": s.MinCost, "avg_cost": s.AvgCost, "max_cost": s.MaxCost, "latest_date": s.LatestDate,
		}
		for i, name := range group.labels {
			row[name] = s.Keys[i]
		}
		data = append(data, row)
		pageKeys = append(pageKeys, s.Keys)
	}
	// Groups not split by unit get their volume per unit, for this page only.
	if !group.hasUnit() && len(pageKeys) > 0 {
		byUnit, err := woItemVolumeByUnit(group, where, args, pageKeys)
		if err != nil {
			http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
			return
		}
		for i, row := range data {
			row["volume_by_unit"] = byUnit[groupKeyString(pageKeys[i])]
		}
	}
	if totalGroups < 0 {
		// An empty page has no row to carry the count (e.g. a page past the end).
		totalGroups = 0
		if page > 1 {
			db.QueryRow("SELECT COUNT(*) FROM (SELECT 1"+woItemFrom+where+" GROUP BY "+group.keyList()+") g", args...).Scan(&totalGroups)
		}
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
