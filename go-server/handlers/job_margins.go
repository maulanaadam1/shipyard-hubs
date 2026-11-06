package handlers

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"shipyard/db"
)

// Job Order margins: customer price (repair list) against vendor cost (WO
// items). A repair-list activity worked on by several WOs is priced once per
// Job Order; every WO adds its own cost. Margins are per Job Order: vendors
// often book all their cost under one activity, so per-activity margins
// mislead. Rejected items don't count as cost.

// jobMarginCTE: acts = one row per Job Order x activity (price once), jo =
// per Job Order totals, cost = vendor cost of the Job Order's WOs.
const jobMarginCTE = `
WITH acts AS (
	SELECT jo_id, activity_key, MAX(jo_code) AS jo_code, MAX(price) AS price, COUNT(DISTINCT wo_id) AS wo_n
	FROM wo_repair_activities WHERE COALESCE(jo_id, '') <> '' GROUP BY jo_id, activity_key
), jo AS (
	SELECT jo_id, MAX(jo_code) AS jo_code, SUM(price) AS price, COUNT(*) AS activities,
		SUM(CASE WHEN wo_n > 1 THEN 1 ELSE 0 END) AS shared, SUM(price * (wo_n - 1)) AS double_counted
	FROM acts GROUP BY jo_id
), wos AS (
	SELECT DISTINCT jo_id, wo_id FROM wo_repair_activities WHERE COALESCE(jo_id, '') <> ''
), cost AS (
	SELECT w.jo_id, COUNT(DISTINCT w.wo_id) AS wo_count,
		COALESCE(SUM(CASE WHEN i.status <> 'rejected' THEN i.total_cost ELSE 0 END), 0) AS cost,
		COALESCE(SUM(CASE WHEN i.status = 'approved' THEN i.total_cost ELSE 0 END), 0) AS cost_approved
	FROM wos w LEFT JOIN wo_items i ON i.wo_id = w.wo_id
	GROUP BY w.jo_id
)`

type jobMargin struct {
	JOID          string  `json:"jo_id"`
	JOCode        string  `json:"jo_code"`
	Price         float64 `json:"price"`
	Cost          float64 `json:"cost"`
	CostApproved  float64 `json:"cost_approved"`
	Margin        float64 `json:"margin"`
	MarginPct     float64 `json:"margin_pct"`
	Activities    int     `json:"activities"`
	Shared        int     `json:"shared_activities"`
	DoubleCounted float64 `json:"double_counted"` // what summing prices per WO would add
	WOCount       int     `json:"wo_count"`
}

func (m *jobMargin) finish() {
	m.Margin = m.Price - m.Cost
	if m.Price > 0 {
		m.MarginPct = m.Margin / m.Price * 100
	}
}

// GetJobMargins lists Job Orders with price, cost and margin.
// Query: q (Job Order / ship), sort (margin|price|cost|pct|code), dir, limit.
func GetJobMargins(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where, args := "", []interface{}{}
	if text := strings.TrimSpace(q.Get("q")); text != "" {
		where = " WHERE LOWER(jo.jo_code) LIKE ?"
		args = append(args, "%"+strings.ToLower(text)+"%")
	}
	order := map[string]string{
		"margin": "(jo.price - cost.cost)", "price": "jo.price", "cost": "cost.cost", "code": "jo.jo_code",
		"pct": "CASE WHEN jo.price > 0 THEN (jo.price - cost.cost) / jo.price ELSE 0 END",
	}[q.Get("sort")]
	if order == "" {
		order = "jo.price"
	}
	dir := " DESC"
	if q.Get("dir") == "asc" {
		dir = " ASC"
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	list := []jobMargin{}
	var total jobMargin
	count := 0
	rows, err := db.Query(jobMarginCTE+`
		SELECT jo.jo_id, COALESCE(jo.jo_code, ''), COALESCE(jo.price, 0), COALESCE(cost.cost, 0), COALESCE(cost.cost_approved, 0),
			jo.activities, COALESCE(jo.shared, 0), COALESCE(jo.double_counted, 0), COALESCE(cost.wo_count, 0)
		FROM jo LEFT JOIN cost ON cost.jo_id = jo.jo_id`+where+` ORDER BY `+order+dir, args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var m jobMargin
		if err := rows.Scan(&m.JOID, &m.JOCode, &m.Price, &m.Cost, &m.CostApproved, &m.Activities, &m.Shared, &m.DoubleCounted, &m.WOCount); err != nil {
			continue
		}
		m.finish()
		count++
		total.Price += m.Price
		total.Cost += m.Cost
		total.CostApproved += m.CostApproved
		total.Activities += m.Activities
		total.Shared += m.Shared
		total.DoubleCounted += m.DoubleCounted
		total.WOCount += m.WOCount
		if len(list) < limit {
			list = append(list, m)
		}
	}
	total.finish()
	writeJSON(w, http.StatusOK, map[string]interface{}{"job_orders": list, "total": total, "count": count})
}

type jobMarginActivity struct {
	Key       string  `json:"key"`
	Name      string  `json:"name"`
	Unit      string  `json:"unit"`
	Quantity  float64 `json:"quantity"`
	UnitPrice float64 `json:"unit_price"`
	Price     float64 `json:"price"`
	Cost      float64 `json:"cost"`
	WOs       []struct {
		WOID   string  `json:"wo_id"`
		WOCode string  `json:"wo_code"`
		Vendor string  `json:"vendor"`
		Cost   float64 `json:"cost"`
	} `json:"wos"`
}

// GetJobMarginDetail returns one Job Order: its activities (price once, the
// WOs that carry them and the cost each booked under it) and its WOs.
func GetJobMarginDetail(w http.ResponseWriter, r *http.Request) {
	joID := strings.TrimSpace(r.URL.Query().Get("jo_id"))
	if joID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "jo_id wajib diisi"})
		return
	}
	var m jobMargin
	err := db.QueryRow(jobMarginCTE+`
		SELECT jo.jo_id, COALESCE(jo.jo_code, ''), COALESCE(jo.price, 0), COALESCE(cost.cost, 0), COALESCE(cost.cost_approved, 0),
			jo.activities, COALESCE(jo.shared, 0), COALESCE(jo.double_counted, 0), COALESCE(cost.wo_count, 0)
		FROM jo LEFT JOIN cost ON cost.jo_id = jo.jo_id WHERE jo.jo_id = ?`, joID).
		Scan(&m.JOID, &m.JOCode, &m.Price, &m.Cost, &m.CostApproved, &m.Activities, &m.Shared, &m.DoubleCounted, &m.WOCount)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Job Order tidak ditemukan"})
		return
	}
	m.finish()

	acts := []*jobMarginActivity{}
	byKey := map[string]*jobMarginActivity{}
	rows, err := db.Query(`SELECT a.activity_key, MAX(a.name), MAX(a.unit), MAX(a.quantity), MAX(a.unit_price), MAX(a.price), MIN(a.activity_path)
		FROM wo_repair_activities a WHERE a.jo_id = ? GROUP BY a.activity_key ORDER BY MIN(a.activity_path)`, joID)
	if err == nil {
		for rows.Next() {
			a := &jobMarginActivity{}
			var path string
			if rows.Scan(&a.Key, &a.Name, &a.Unit, &a.Quantity, &a.UnitPrice, &a.Price, &path) == nil {
				acts = append(acts, a)
				byKey[a.Key] = a
			}
		}
		rows.Close()
	}
	rows, err = db.Query(`SELECT a.activity_key, a.wo_id, COALESCE(MAX(s.wo_code), ''), COALESCE(MAX(s.vendor_name), ''),
			COALESCE(SUM(CASE WHEN i.status <> 'rejected' THEN i.total_cost ELSE 0 END), 0)
		FROM wo_repair_activities a
		LEFT JOIN wo_items i ON i.wo_id = a.wo_id AND i.activity_path = a.activity_path
		LEFT JOIN work_order_summary s ON s.wo_id = a.wo_id
		WHERE a.jo_id = ? GROUP BY a.activity_key, a.wo_id ORDER BY 3`, joID)
	if err == nil {
		for rows.Next() {
			var key string
			var wo struct {
				WOID   string  `json:"wo_id"`
				WOCode string  `json:"wo_code"`
				Vendor string  `json:"vendor"`
				Cost   float64 `json:"cost"`
			}
			if rows.Scan(&key, &wo.WOID, &wo.WOCode, &wo.Vendor, &wo.Cost) == nil && byKey[key] != nil {
				byKey[key].WOs = append(byKey[key].WOs, wo)
				byKey[key].Cost += wo.Cost
			}
		}
		rows.Close()
	}

	type woRow struct {
		WOID         string  `json:"wo_id"`
		WOCode       string  `json:"wo_code"`
		Vendor       string  `json:"vendor"`
		Status       string  `json:"status"`
		Cost         float64 `json:"cost"`
		CostApproved float64 `json:"cost_approved"`
	}
	wos := []woRow{}
	rows, err = db.Query(`SELECT w.wo_id, COALESCE(MAX(s.wo_code), ''), COALESCE(MAX(s.vendor_name), ''), COALESCE(MAX(s.derived_status), ''),
			COALESCE(SUM(CASE WHEN i.status <> 'rejected' THEN i.total_cost ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN i.status = 'approved' THEN i.total_cost ELSE 0 END), 0)
		FROM (SELECT DISTINCT wo_id FROM wo_repair_activities WHERE jo_id = ?) w
		LEFT JOIN wo_items i ON i.wo_id = w.wo_id
		LEFT JOIN work_order_summary s ON s.wo_id = w.wo_id
		GROUP BY w.wo_id ORDER BY 2`, joID)
	if err == nil {
		for rows.Next() {
			var x woRow
			if rows.Scan(&x.WOID, &x.WOCode, &x.Vendor, &x.Status, &x.Cost, &x.CostApproved) == nil {
				wos = append(wos, x)
			}
		}
		rows.Close()
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"job_order": m, "activities": acts, "work_orders": wos})
}

// aiJobMarginTool: customer price vs vendor cost per Job Order for the AI.
func aiJobMarginTool() aiTool {
	return aiTool{
		Name: "job_order_margin",
		Description: "Customer price (harga penawaran from the repair list) against vendor cost (WO items) per Job Order, and the margin. " +
			"Call this when the user asks about harga penawaran, nilai kontrak per aktivitas, margin, untung/rugi, or price vs cost of a " +
			"Job Order or ship. A repair-list activity worked on by several WOs is priced once per Job Order (never sum prices per WO); " +
			"every WO adds its own cost; rejected items are not cost. Margins are only meaningful per Job Order, because vendors often book " +
			"all their cost under one activity. Search with query (Job Order code or ship name) for a list; pass jo_id of one result for " +
			"its activities and WOs.",
		Schema: aiSchema(map[string]interface{}{
			"query": aiString("Words in the Job Order code or ship name, e.g. \"PCI 404\" or \"IS26GSBG049\"."),
			"jo_id": aiString("jo_id of one Job Order from a list result, for its detail."),
			"sort":  aiString("List order (default price, highest first).", "price", "cost", "margin", "pct"),
			"order": aiString("asc for lowest first (e.g. the lowest margins).", "asc", "desc"),
			"limit": aiInteger("How many Job Orders to list (default 10).", 1, 50),
		}),
		Resource: ResourceRepairPrices,
		Run:      runJobMargin,
	}
}

func runJobMargin(r *http.Request, input json.RawMessage) (interface{}, error) {
	var in struct {
		Query string `json:"query"`
		JOID  string `json:"jo_id"`
		Sort  string `json:"sort"`
		Order string `json:"order"`
		Limit int    `json:"limit"`
	}
	if err := decodeAIInput(input, &in); err != nil {
		return nil, err
	}
	if err := oneOf("sort", in.Sort, "price", "cost", "margin", "pct"); err != nil {
		return nil, err
	}
	if err := oneOf("order", in.Order, "asc", "desc"); err != nil {
		return nil, err
	}
	if in.JOID != "" {
		return aiCall(GetJobMarginDetail, r, "/api/job-margins/detail", url.Values{"jo_id": {in.JOID}})
	}
	q := url.Values{"limit": {strconv.Itoa(limitOr(in.Limit, 10, 50))}}
	setIf(q, "q", in.Query)
	setIf(q, "sort", in.Sort)
	setIf(q, "dir", in.Order)
	res, err := aiCall(GetJobMargins, r, "/api/job-margins", q)
	if err != nil {
		return nil, err
	}
	// One match: give its detail right away.
	if list, ok := res["job_orders"].([]interface{}); ok && len(list) == 1 {
		if jo, ok := list[0].(map[string]interface{}); ok {
			if id, _ := jo["jo_id"].(string); id != "" {
				return aiCall(GetJobMarginDetail, r, "/api/job-margins/detail", url.Values{"jo_id": {id}})
			}
		}
	}
	return res, nil
}
