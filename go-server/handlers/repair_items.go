package handlers

import (
	"net/http"
	"sort"
	"strconv"
	"strings"

	"shipyard/db"
)

// ResourceRepairItems is the RBAC resource of the Item Repair List menu:
// every repair list activity of every Job Order, the marketing twin of Item
// Pekerjaan WO. Prices in it also need Harga Penawaran.
const ResourceRepairItems = "Item Repair List"

// repairItemsBase selects the activities (leaves) of current, error-free
// repair lists with their Job Order. Columns are picked by the caller.
const repairItemsBase = `
	WITH jo AS (
		SELECT CAST(p.id_siaga AS TEXT) AS jo_id, MAX(COALESCE(p.idproject, '')) AS code, MAX(COALESCE(p.shipname, '')) AS ship,
			MAX(COALESCE(p.cust_company, '')) AS customer, MAX(COALESCE(ms.name, '')) AS service, MAX(COALESCE(p.est_start, '')) AS est_start
		FROM projects p LEFT JOIN master_services ms ON CAST(ms.id AS TEXT) = p.docking_type
		WHERE p.id_siaga IS NOT NULL AND p.id_siaga > 0
		GROUP BY CAST(p.id_siaga AS TEXT)
	)
	SELECT %s
	FROM jo_repair_items i
	JOIN jo_repair_lists l ON l.jo_id = i.jo_id
	LEFT JOIN jo ON jo.jo_id = i.jo_id
	WHERE i.is_leaf AND COALESCE(l.error, '') = '' AND COALESCE(l.format, 0) >= 3`

const repairItemHasWO = `EXISTS (SELECT 1 FROM wo_repair_activities a WHERE a.jo_id = i.jo_id AND a.activity_key = i.uniqcode)`

// repairItemsFilter turns the query string into SQL conditions:
// q, year, service, customer, jo_id, version (utama|tambahan), wo (with|without),
// work_type, size, unit, recognized (yes|no), component.
func repairItemsFilter(r *http.Request) (string, []interface{}) {
	q := r.URL.Query()
	var where []string
	var args []interface{}
	if s := strings.ToLower(strings.TrimSpace(q.Get("q"))); s != "" {
		for _, w := range strings.Fields(s) {
			where = append(where, `LOWER(COALESCE(i.full_name, '') || ' ' || COALESCE(jo.code, '') || ' ' || COALESCE(jo.ship, '') || ' ' || COALESCE(i.work_type, '')) LIKE ?`)
			args = append(args, "%"+w+"%")
		}
	}
	eq := map[string]string{"service": "COALESCE(jo.service, '')", "customer": "COALESCE(jo.customer, '')", "jo_id": "i.jo_id",
		"work_type": "COALESCE(i.work_type, '')", "size": "COALESCE(i.size, '')", "unit": "COALESCE(i.unit, '')", "component": "COALESCE(i.component, '')"}
	for _, key := range []string{"service", "customer", "jo_id", "work_type", "size", "unit", "component"} {
		if v := q.Get(key); v != "" {
			where = append(where, eq[key]+" = ?")
			args = append(args, v)
		}
	}
	if y := strings.TrimSpace(q.Get("year")); len(y) == 4 {
		where = append(where, "SUBSTR(COALESCE(jo.est_start, ''), 1, 4) = ?")
		args = append(args, y)
	}
	switch q.Get("version") {
	case "utama":
		where = append(where, "COALESCE(i.full_name, '') NOT LIKE 'Repair list tambahan versi %'")
	case "tambahan":
		where = append(where, "COALESCE(i.full_name, '') LIKE 'Repair list tambahan versi %'")
	}
	switch q.Get("wo") {
	case "with":
		where = append(where, repairItemHasWO)
	case "without":
		where = append(where, "NOT "+repairItemHasWO)
	}
	switch q.Get("recognized") {
	case "yes":
		where = append(where, "COALESCE(i.recognized, false)")
	case "no":
		where = append(where, "NOT COALESCE(i.recognized, false)")
	}
	if len(where) == 0 {
		return "", nil
	}
	return " AND " + strings.Join(where, " AND "), args
}

// repairItemVersion names the repair list an activity belongs to, from its
// full name: version 1 (main) or an additional version.
func repairItemVersion(fullName string) int {
	const prefix = "Repair list tambahan versi "
	if strings.HasPrefix(fullName, prefix) {
		rest := fullName[len(prefix):]
		if i := strings.Index(rest, " "); i > 0 {
			rest = rest[:i]
		}
		if n, err := strconv.Atoi(rest); err == nil {
			return n
		}
	}
	return 1
}

// repairItemGroup is the activity's group path without the version heading.
func repairItemGroup(fullName string) string {
	return strings.Join(repairGroups(fullName), " > ")
}

// GetRepairItems lists repair list activities. Query: the filters of
// repairItemsFilter, sort (default Job Order, newest first; total_price,
// unit_price), page, limit (up to 500; 20000 with all=1 for the export).
func GetRepairItems(w http.ResponseWriter, r *http.Request) {
	showPrice := HasResourcePermission(r, ResourceRepairPrices, "view")
	where, args := repairItemsFilter(r)
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	maxLimit := 500
	if q.Get("all") == "1" {
		maxLimit = 20000
	}
	if limit <= 0 || limit > maxLimit {
		limit = 50
	}
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	order := "COALESCE(jo.est_start, '') DESC, i.jo_id DESC, i.seq"
	if showPrice {
		switch q.Get("sort") {
		case "total_price":
			order = "COALESCE(i.total_price, 0) DESC, i.jo_id, i.seq"
		case "unit_price":
			order = "COALESCE(i.unit_price, 0) DESC, i.jo_id, i.seq"
		}
	}

	var total int
	var totalPrice float64
	if err := db.QueryRow(strings.Replace(repairItemsBase, "%s", "COUNT(*), COALESCE(SUM(i.total_price), 0)", 1)+where, args...).Scan(&total, &totalPrice); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	rows, err := db.Query(strings.Replace(repairItemsBase, "%s", `i.jo_id, i.uniqcode, COALESCE(jo.code, ''), COALESCE(jo.ship, ''), COALESCE(jo.customer, ''),
		COALESCE(jo.service, ''), COALESCE(jo.est_start, ''), COALESCE(i.path, ''), COALESCE(i.description, ''), COALESCE(i.full_name, ''),
		COALESCE(i.work_type, ''), COALESCE(i.size, ''), COALESCE(i.component, ''), COALESCE(i.recognized, false), COALESCE(i.unit, ''),
		COALESCE(i.quantity, 0), COALESCE(i.unit_price, 0), COALESCE(i.total_price, 0)`, 1)+where+
		" ORDER BY "+order+" LIMIT "+strconv.Itoa(limit)+" OFFSET "+strconv.Itoa((page-1)*limit), args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	type key struct{ jo, uniq string }
	items := []map[string]interface{}{}
	index := map[key]map[string]interface{}{}
	jos := map[string]bool{}
	for rows.Next() {
		var jo, uniq, code, ship, customer, service, start, path, desc, full, work, size, comp, unit string
		var recognized bool
		var qty, unitPrice, totalP float64
		if rows.Scan(&jo, &uniq, &code, &ship, &customer, &service, &start, &path, &desc, &full, &work, &size, &comp, &recognized, &unit,
			&qty, &unitPrice, &totalP) != nil {
			continue
		}
		it := map[string]interface{}{"jo_id": jo, "jo_code": code, "ship": ship, "customer": customer, "service": service, "est_start": start,
			"version": repairItemVersion(full), "no": path, "activity": desc, "group": repairItemGroup(full), "work_type": work, "size": size,
			"component": comp, "recognized": recognized, "unit": unit, "quantity": qty, "wos": []string{}}
		if showPrice {
			it["unit_price"], it["total_price"] = unitPrice, totalP
		}
		items = append(items, it)
		index[key{jo, uniq}] = it
		jos[jo] = true
	}
	rows.Close()

	// The WOs carrying the listed activities.
	if len(jos) > 0 {
		ids := make([]string, 0, len(jos))
		marks := make([]string, 0, len(jos))
		woArgs := []interface{}{}
		for id := range jos {
			ids = append(ids, id)
			marks = append(marks, "?")
			woArgs = append(woArgs, id)
		}
		if wr, err := db.Query(`SELECT a.jo_id, a.activity_key, COALESCE(MAX(s.wo_code), a.wo_id) FROM wo_repair_activities a
			LEFT JOIN work_order_summary s ON s.wo_id = a.wo_id
			WHERE a.jo_id IN (`+strings.Join(marks, ", ")+`) GROUP BY a.jo_id, a.activity_key, a.wo_id`, woArgs...); err == nil {
			for wr.Next() {
				var jo, act, code string
				if wr.Scan(&jo, &act, &code) == nil {
					if it, ok := index[key{jo, act}]; ok {
						it["wos"] = append(it["wos"].([]string), code)
					}
				}
			}
			wr.Close()
		}
	}
	out := map[string]interface{}{"items": items, "total": total, "page": page, "limit": limit, "show_price": showPrice}
	if showPrice {
		out["total_price"] = totalPrice
	}
	writeJSON(w, http.StatusOK, out)
}

// repairSummaryKeys are the summary views and the columns they group by.
var repairSummaryKeys = map[string][]string{
	"job_order":      {"jo_code", "ship", "customer"},
	"group":          {"group"},
	"work_type":      {"work_type"},
	"work_type_size": {"work_type", "size", "unit"},
	"customer":       {"customer"},
	"service":        {"service"},
}

// GetRepairItemSummary groups the filtered activities. Query: the filters of
// repairItemsFilter, by (job_order, group, work_type, work_type_size,
// customer, service), sort (total_price, activities, job_orders), limit.
// Unit prices (median, min, max) are given per work type, size and unit.
func GetRepairItemSummary(w http.ResponseWriter, r *http.Request) {
	showPrice := HasResourcePermission(r, ResourceRepairPrices, "view")
	by := r.URL.Query().Get("by")
	cols, ok := repairSummaryKeys[by]
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "by tidak dikenal"})
		return
	}
	where, args := repairItemsFilter(r)
	rows, err := db.Query(strings.Replace(repairItemsBase, "%s", `i.jo_id, COALESCE(jo.code, ''), COALESCE(jo.ship, ''), COALESCE(jo.customer, ''),
		COALESCE(jo.service, ''), COALESCE(i.full_name, ''), COALESCE(i.work_type, ''), COALESCE(i.size, ''), COALESCE(i.unit, ''),
		COALESCE(i.quantity, 0), COALESCE(i.unit_price, 0), COALESCE(i.total_price, 0), `+repairItemHasWO, 1)+where, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	type group struct {
		keys       map[string]string
		activities int
		withWO     int
		jos        map[string]bool
		qty, total float64
		prices     []float64
	}
	groups := map[string]*group{}
	var order []string
	for rows.Next() {
		var jo, code, ship, customer, service, full, work, size, unit string
		var qty, unitPrice, totalP float64
		var hasWO bool
		if rows.Scan(&jo, &code, &ship, &customer, &service, &full, &work, &size, &unit, &qty, &unitPrice, &totalP, &hasWO) != nil {
			continue
		}
		top := ""
		if g := repairGroups(full); len(g) > 0 {
			top = g[0]
		}
		vals := map[string]string{"jo_code": code, "ship": ship, "customer": customer, "service": service, "group": top,
			"work_type": work, "size": size, "unit": unit}
		if by == "job_order" {
			vals["jo_id"] = jo
		}
		parts := make([]string, 0, len(cols)+1)
		for _, c := range cols {
			parts = append(parts, vals[c])
		}
		if by == "job_order" {
			parts = append(parts, jo)
		}
		k := strings.Join(parts, "\x00")
		g := groups[k]
		if g == nil {
			g = &group{keys: map[string]string{}, jos: map[string]bool{}}
			for _, c := range cols {
				g.keys[c] = vals[c]
			}
			if by == "job_order" {
				g.keys["jo_id"] = jo
			}
			groups[k] = g
			order = append(order, k)
		}
		g.activities++
		if hasWO {
			g.withWO++
		}
		g.jos[jo] = true
		g.qty += qty
		g.total += totalP
		if unitPrice > 0 {
			g.prices = append(g.prices, unitPrice)
		}
	}
	rows.Close()

	out := make([]map[string]interface{}, 0, len(groups))
	var grandTotal float64
	grandActivities := 0
	for _, k := range order {
		g := groups[k]
		row := map[string]interface{}{"activities": g.activities, "activities_with_wo": g.withWO, "job_orders": len(g.jos)}
		for c, v := range g.keys {
			row[c] = v
		}
		if by == "work_type_size" {
			row["quantity"] = g.qty
		}
		if showPrice {
			row["total_price"] = g.total
			if by == "work_type_size" && len(g.prices) > 0 {
				sort.Float64s(g.prices)
				n := len(g.prices)
				median := g.prices[n/2]
				if n%2 == 0 {
					median = (g.prices[n/2-1] + g.prices[n/2]) / 2
				}
				row["unit_price_median"], row["unit_price_min"], row["unit_price_max"], row["priced"] = median, g.prices[0], g.prices[n-1], n
			}
		}
		grandTotal += g.total
		grandActivities += g.activities
		out = append(out, row)
	}
	sortBy := r.URL.Query().Get("sort")
	if !showPrice && sortBy == "total_price" {
		sortBy = ""
	}
	num := func(m map[string]interface{}, k string) float64 {
		switch v := m[k].(type) {
		case int:
			return float64(v)
		case float64:
			return v
		}
		return 0
	}
	switch sortBy {
	case "activities", "job_orders":
	case "":
		if showPrice {
			sortBy = "total_price"
		} else {
			sortBy = "activities"
		}
	default:
		sortBy = "total_price"
	}
	sort.SliceStable(out, func(i, j int) bool { return num(out[i], sortBy) > num(out[j], sortBy) })
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 5000 {
		limit = 500
	}
	groupsCount := len(out)
	if len(out) > limit {
		out = out[:limit]
	}
	res := map[string]interface{}{"rows": out, "groups": groupsCount, "activities": grandActivities, "show_price": showPrice}
	if showPrice {
		res["total_price"] = grandTotal
	}
	writeJSON(w, http.StatusOK, res)
}

// GetRepairItemFacets lists the filter values: years, job types, customers
// and work types, with how many activities each has.
func GetRepairItemFacets(w http.ResponseWriter, r *http.Request) {
	facet := func(expr string, limit int) []map[string]interface{} {
		out := []map[string]interface{}{}
		rows, err := db.Query(strings.Replace(repairItemsBase, "%s", expr+" AS v, COUNT(*)", 1) + " GROUP BY 1 ORDER BY 2 DESC LIMIT " + strconv.Itoa(limit))
		if err != nil {
			return out
		}
		defer rows.Close()
		for rows.Next() {
			var v string
			var n int
			if rows.Scan(&v, &n) == nil && v != "" {
				out = append(out, map[string]interface{}{"value": v, "count": n})
			}
		}
		return out
	}
	years := facet("SUBSTR(COALESCE(jo.est_start, ''), 1, 4)", 30)
	sort.Slice(years, func(i, j int) bool { return years[i]["value"].(string) > years[j]["value"].(string) })
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"years":      years,
		"services":   facet("COALESCE(jo.service, '')", 30),
		"customers":  facet("COALESCE(jo.customer, '')", 500),
		"work_types": facet("COALESCE(i.work_type, '')", 2000),
	})
}
