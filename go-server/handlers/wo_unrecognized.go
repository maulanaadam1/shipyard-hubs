package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"shipyard/db"
)

// Work items whose type is still unknown, grouped by the activity they belong
// to: the activity tells what the work is about, its items are the detail.
// Activities with many unknown items, or much cost in them, are where the
// item parser needs new words (or SIAGA a clearer description).

// GetUnrecognizedActivities lists activities with unrecognized items, by cost.
// Query: search (activity, category or item text), page, limit.
func GetUnrecognizedActivities(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, limit := pageParams(q, 25, 200)
	where := "NOT COALESCE(p.recognized, false)"
	args := []interface{}{}
	if search := strings.ToLower(strings.TrimSpace(q.Get("search"))); search != "" {
		like := "%" + search + "%"
		where += " AND (LOWER(i.activity_name) LIKE ? OR LOWER(i.category) LIKE ? OR LOWER(i.label) LIKE ?)"
		args = append(args, like, like, like)
	}
	from := ` FROM wo_item_parsed p JOIN wo_items i ON i.wo_id = p.wo_id AND i.item_id = p.item_id WHERE ` + where

	var items, wos int
	var cost, allCost float64
	var allItems int
	db.QueryRow(`SELECT COUNT(*), COUNT(DISTINCT i.wo_id), COALESCE(SUM(i.total_cost), 0)`+from, args...).Scan(&items, &wos, &cost)
	db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(total_cost), 0) FROM wo_items`).Scan(&allItems, &allCost)

	rows, err := db.Query(`SELECT COALESCE(i.activity_name, ''), COALESCE(i.category, ''), COUNT(*), COUNT(DISTINCT i.wo_id),
			COALESCE(SUM(i.total_cost), 0), COALESCE(MAX(i.approval_date), ''), COUNT(*) OVER ()`+from+`
		GROUP BY 1, 2 ORDER BY 5 DESC, 3 DESC, 1 LIMIT ? OFFSET ?`, append(args, limit, (page-1)*limit)...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	type activity struct {
		Activity   string  `json:"activity"`
		Category   string  `json:"category"`
		ItemCount  int     `json:"item_count"`
		WOCount    int     `json:"wo_count"`
		TotalCost  float64 `json:"total_cost"`
		LatestDate string  `json:"latest_date"`
	}
	list := []activity{}
	total := 0
	for rows.Next() {
		var a activity
		if rows.Scan(&a.Activity, &a.Category, &a.ItemCount, &a.WOCount, &a.TotalCost, &a.LatestDate, &total) == nil {
			list = append(list, a)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data": list, "total": total, "page": page, "limit": limit,
		"items": items, "wo_count": wos, "total_cost": cost, "all_items": allItems, "all_cost": allCost,
	})
}

// GetUnrecognizedActivityItems lists the unrecognized items of one activity
// (activity and category as listed), costliest first.
func GetUnrecognizedActivityItems(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	_, limit := pageParams(q, 50, 200)
	rows, err := db.Query(`SELECT i.wo_id, COALESCE(s.wo_code, ''), COALESCE(s.project_name, ''), COALESCE(i.label, ''), COALESCE(i.unit, ''),
			COALESCE(i.volume, 0), COALESCE(i.unit_cost, 0), COALESCE(i.total_cost, 0), COALESCE(i.status, ''), COALESCE(i.approval_date, '')
		FROM wo_item_parsed p JOIN wo_items i ON i.wo_id = p.wo_id AND i.item_id = p.item_id
		LEFT JOIN work_order_summary s ON s.wo_id = i.wo_id
		WHERE NOT COALESCE(p.recognized, false) AND COALESCE(i.activity_name, '') = ? AND COALESCE(i.category, '') = ?
		ORDER BY i.total_cost DESC, i.wo_id, i.path LIMIT ?`, q.Get("activity"), q.Get("category"), limit)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	type item struct {
		WOID         string  `json:"wo_id"`
		WOCode       string  `json:"wo_code"`
		ProjectName  string  `json:"project_name"`
		Label        string  `json:"label"`
		Unit         string  `json:"unit"`
		Volume       float64 `json:"volume"`
		UnitCost     float64 `json:"unit_cost"`
		TotalCost    float64 `json:"total_cost"`
		Status       string  `json:"status"`
		ApprovalDate string  `json:"approval_date"`
	}
	list := []item{}
	for rows.Next() {
		var it item
		if rows.Scan(&it.WOID, &it.WOCode, &it.ProjectName, &it.Label, &it.Unit, &it.Volume, &it.UnitCost, &it.TotalCost, &it.Status, &it.ApprovalDate) == nil {
			list = append(list, it)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"data": list})
}
