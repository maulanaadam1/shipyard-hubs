package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"shipyard/db"
	"shipyard/workers"
)

// Repair lists: the full repair list of each Job Order, pulled from SIAGA
// (/api/v2/repair-lists/{jo id}/activities) with the credentials of the WO
// detail sync (API Sync Config), latest version, every page. WO details only
// carry the activities a WO works on; this has all of them, so the customer
// price of a Job Order is complete and each activity shows whether a WO exists.

// ResourceRepairList is the menu (Role Management) that shows repair lists.
// Prices in it also need the Harga Penawaran permission.
const ResourceRepairList = "Repair List"

// repairListURL builds the SIAGA URL: a "RepairLists" API Sync Config with
// {{id}}, {{version}} and {{page}} when there is one, otherwise the host of
// the WO detail config.
func repairListURL(src detailSource, override string, joID string, version, page int) (string, error) {
	if override != "" {
		u := strings.NewReplacer("{{id}}", joID, "{{version}}", strconv.Itoa(version), "{{page}}", strconv.Itoa(page)).Replace(override)
		return u, nil
	}
	base, err := url.Parse(src.url)
	if err != nil || base.Host == "" {
		return "", fmt.Errorf("URL API Sync Config tidak valid")
	}
	return fmt.Sprintf("%s://%s/api/v2/repair-lists/%s/activities?modul_id=t_job_orders&version=%d&page=%d",
		base.Scheme, base.Host, url.PathEscape(joID), version, page), nil
}

type repairListPage struct {
	CurrentPage int                      `json:"current_page"`
	LastPage    int                      `json:"last_page"`
	Data        []map[string]interface{} `json:"data"`
}

type repairItem struct {
	Uniq, Parent, Path, Description, FullName, Unit string
	Seq, Depth, Version                             int
	Quantity, UnitPrice, TotalPrice                 float64
	Leaf                                            bool
}

// flattenRepairList turns the activity tree into rows in display order.
func flattenRepairList(top []map[string]interface{}) []repairItem {
	var out []repairItem
	seen := map[string]bool{}
	var walk func(n map[string]interface{}, parent string, names []string, depth int)
	walk = func(n map[string]interface{}, parent string, names []string, depth int) {
		desc := strings.TrimSpace(firstString(n, "description"))
		uniq := firstString(n, "uniqcode", "id")
		if uniq == "" {
			uniq = fmt.Sprintf("%s#%d", firstString(n, "path"), len(out))
		}
		kids, _ := n["children"].([]interface{})
		full := append(append([]string{}, names...), desc)
		if !seen[uniq] {
			seen[uniq] = true
			qty := parseFloatAny(n["quantity"])
			unitPrice := parseFloatAny(n["price"])
			total := 0.0
			if p, ok := n["parameter"].(map[string]interface{}); ok {
				total = parseFloatAny(p["total_price"])
			}
			if total == 0 {
				total = unitPrice * qty
			}
			out = append(out, repairItem{
				Uniq: uniq, Parent: parent, Path: firstString(n, "path"), Description: desc, FullName: strings.Join(full, " > "),
				Unit: firstString(n, "unit"), Seq: len(out), Depth: depth, Version: int(parseFloatAny(n["version"])),
				Quantity: qty, UnitPrice: unitPrice, TotalPrice: total, Leaf: len(kids) == 0,
			})
		}
		for _, k := range kids {
			if child, ok := k.(map[string]interface{}); ok {
				walk(child, uniq, full, depth+1)
			}
		}
	}
	for _, n := range top {
		walk(n, "", nil, 0)
	}
	return out
}

var repairListClient = &http.Client{Timeout: 60 * time.Second}

// repairListOverride reads an active "RepairLists" API Sync Config: its URL
// template replaces the default one, and its headers, when set, replace the
// WO detail config's.
func repairListOverride(src *detailSource) string {
	var u, hdrs string
	if db.QueryRow(`SELECT COALESCE(url, ''), COALESCE(headers, '') FROM sync_configs WHERE id = 'RepairLists' AND is_active = true`).Scan(&u, &hdrs) != nil {
		return ""
	}
	var h map[string]string
	if strings.TrimSpace(hdrs) != "" && json.Unmarshal([]byte(hdrs), &h) == nil && len(h) > 0 {
		src.headers = h
	}
	return strings.TrimSpace(u)
}

// fetchRepairPage pulls one page of a repair list version.
func fetchRepairPage(src detailSource, override, joID string, version, page int) (repairListPage, error) {
	var p repairListPage
	u, err := repairListURL(src, override, joID, version, page)
	if err != nil {
		return p, err
	}
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return p, err
	}
	for k, v := range src.headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("Accept", "application/json")
	resp, err := repairListClient.Do(req)
	if err != nil {
		return p, err
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<20))
	resp.Body.Close()
	if err != nil {
		return p, err
	}
	if resp.StatusCode != http.StatusOK {
		return p, &workers.HTTPStatusError{URL: u, Code: resp.StatusCode}
	}
	if err := json.Unmarshal(body, &p); err != nil {
		return p, fmt.Errorf("repair list %s tidak terbaca: %v", joID, err)
	}
	return p, nil
}

// latestRepairVersion finds the newest version when ShipHub doesn't know it
// (a Job Order only in Job Order / projects): versions with activities, from
// 1 up, until one is empty.
func latestRepairVersion(src detailSource, override, joID string) (int, error) {
	latest := 0
	for v := 1; v <= 20; v++ {
		p, err := fetchRepairPage(src, override, joID, v, 1)
		if err != nil {
			return latest, err
		}
		if len(p.Data) == 0 {
			break
		}
		latest = v
		time.Sleep(300 * time.Millisecond)
	}
	return latest, nil
}

// repairListFormat changes when the stored repair lists must be fetched again
// (2: every version, not only the latest).
const repairListFormat = 2

// fetchRepairList pulls one Job Order's repair list: every version from 1 to
// the latest, every page. In SIAGA, version 2 and up are additional repair
// lists (t_repair_list_additionals), not revisions of version 1, so they are
// added, each under its own group. Version 0 means unknown: the latest one is
// looked up first. It returns the latest version.
func fetchRepairList(src detailSource, override, joID string, version int) ([]repairItem, int, error) {
	if version <= 0 {
		v, err := latestRepairVersion(src, override, joID)
		if err != nil {
			return nil, 0, err
		}
		if v == 0 {
			return nil, 0, nil // no repair list in SIAGA
		}
		version = v
	}
	var roots []map[string]interface{}
	for v := 1; v <= version; v++ {
		var top []map[string]interface{}
		for page := 1; page <= 200; page++ {
			p, err := fetchRepairPage(src, override, joID, v, page)
			if err != nil {
				return nil, version, err
			}
			top = append(top, p.Data...)
			if p.LastPage <= page || len(p.Data) == 0 {
				break
			}
			time.Sleep(300 * time.Millisecond)
		}
		if version == 1 {
			roots = top // a single repair list: no version groups
			break
		}
		if len(top) == 0 {
			continue
		}
		label := "Repair list versi 1"
		if v > 1 {
			label = fmt.Sprintf("Repair list tambahan versi %d", v)
		}
		children := make([]interface{}, len(top))
		for i, n := range top {
			children[i] = n
		}
		roots = append(roots, map[string]interface{}{"uniqcode": fmt.Sprintf("version-%d", v), "description": label, "version": float64(v), "children": children})
		time.Sleep(300 * time.Millisecond)
	}
	return flattenRepairList(roots), version, nil
}

// storeRepairList replaces one Job Order's stored repair list.
func storeRepairList(joID string, version int, items []repairItem) error {
	tx, err := db.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(db.FormatQuery("DELETE FROM jo_repair_items WHERE jo_id = ?"), joID); err != nil {
		return err
	}
	total := 0.0
	const batch = 200
	var rows []string
	var args []interface{}
	flush := func() error {
		if len(rows) == 0 {
			return nil
		}
		_, err := tx.Exec(db.FormatQuery(`INSERT INTO jo_repair_items (jo_id, uniqcode, parent_uniqcode, seq, depth, path, description, full_name,
			unit, quantity, unit_price, total_price, is_leaf, version) VALUES `+strings.Join(rows, ", ")+` ON CONFLICT(jo_id, uniqcode) DO NOTHING`), args...)
		rows, args = rows[:0], args[:0]
		return err
	}
	for _, it := range items {
		if it.Leaf {
			total += it.TotalPrice
		}
		rows = append(rows, "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
		args = append(args, joID, it.Uniq, it.Parent, it.Seq, it.Depth, it.Path, it.Description, it.FullName, it.Unit,
			it.Quantity, it.UnitPrice, it.TotalPrice, it.Leaf, it.Version)
		if len(rows) >= batch {
			if err := flush(); err != nil {
				return err
			}
		}
	}
	if err := flush(); err != nil {
		return err
	}
	if _, err := tx.Exec(db.FormatQuery("DELETE FROM jo_repair_lists WHERE jo_id = ?"), joID); err != nil {
		return err
	}
	if _, err := tx.Exec(db.FormatQuery(`INSERT INTO jo_repair_lists (jo_id, version, items, total_price, fetched_at, error, format) VALUES (?, ?, ?, ?, ?, '', ?)`),
		joID, version, len(items), total, time.Now().Format("2006-01-02 15:04:05"), repairListFormat); err != nil {
		return err
	}
	return tx.Commit()
}

func recordRepairListError(joID, msg string) {
	var n int
	db.QueryRow("SELECT COUNT(*) FROM jo_repair_lists WHERE jo_id = ?", joID).Scan(&n)
	if n == 0 {
		db.Exec(`INSERT INTO jo_repair_lists (jo_id, fetched_at, error) VALUES (?, ?, ?)`, joID, time.Now().Format("2006-01-02 15:04:05"), msg)
		return
	}
	db.Exec(`UPDATE jo_repair_lists SET error = ?, fetched_at = ? WHERE jo_id = ?`, msg, time.Now().Format("2006-01-02 15:04:05"), joID)
}

// repairListJobs lists Job Orders to fetch with their latest version (0 =
// unknown): from the WOs' details, the Job Order sync and the Job Order menu
// (projects.id_siaga), so Job Orders without a WO yet are included.
func repairListJobs() map[string]int {
	jobs := map[string]int{}
	if rows, err := db.Query(`SELECT jo_id, MAX(COALESCE(jo_version, 0)) FROM wo_repair_activities WHERE COALESCE(jo_id, '') <> '' GROUP BY jo_id`); err == nil {
		for rows.Next() {
			var id string
			var v int
			if rows.Scan(&id, &v) == nil {
				jobs[id] = v
			}
		}
		rows.Close()
	}
	if rows, err := db.Query(`SELECT id, COALESCE(latest_version, 0) FROM sync_job_orders`); err == nil {
		for rows.Next() {
			var id string
			var v int
			if rows.Scan(&id, &v) == nil && v > jobs[id] {
				jobs[id] = v
			}
		}
		rows.Close()
	}
	if rows, err := db.Query(`SELECT DISTINCT CAST(id_siaga AS TEXT) FROM projects WHERE id_siaga IS NOT NULL AND id_siaga > 0`); err == nil {
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil && id != "" {
				if _, ok := jobs[id]; !ok {
					jobs[id] = 0
				}
			}
		}
		rows.Close()
	}
	return jobs
}

var repairListRun sync.Mutex

// syncRepairLists fetches the repair lists due: never fetched, a newer
// version, or, for active Job Orders (a WO changed in the last
// REPAIR_LIST_ACTIVE_DAYS, 30, or in the Job Order sync), older than
// REPAIR_LIST_REFRESH_HOURS (24). Finished Job Orders are not fetched again
// unless their version changes: a repair list can be several MB. It stops at
// an authentication error (the credentials in API Sync Config need renewing).
func syncRepairLists() (int, error) {
	if !repairListRun.TryLock() {
		return 0, nil
	}
	defer repairListRun.Unlock()
	src, err := loadDetailSource()
	if err != nil || !src.active || src.url == "" {
		return 0, err
	}
	override := repairListOverride(&src)

	type storedList struct {
		version int
		at      string
		failed  bool
		format  int
	}
	stored := map[string]storedList{}
	if rows, err := db.Query(`SELECT jo_id, COALESCE(version, 0), COALESCE(fetched_at, ''), COALESCE(error, '') <> '', COALESCE(format, 0) FROM jo_repair_lists`); err == nil {
		for rows.Next() {
			var s storedList
			var id string
			if rows.Scan(&id, &s.version, &s.at, &s.failed, &s.format) == nil {
				stored[id] = s
			}
		}
		rows.Close()
	}
	cutoff := time.Now().Add(-time.Duration(envInt("REPAIR_LIST_REFRESH_HOURS", 24)) * time.Hour).Format("2006-01-02 15:04:05")
	active := map[string]bool{}
	activeSince := time.Now().AddDate(0, 0, -envInt("REPAIR_LIST_ACTIVE_DAYS", 30)).Format("2006-01-02")
	if rows, err := db.Query(`SELECT DISTINCT a.jo_id FROM wo_repair_activities a JOIN work_order_summary s ON s.wo_id = a.wo_id
		WHERE COALESCE(s.updated_source_at, '') >= ? UNION SELECT id FROM sync_job_orders`, activeSince); err == nil {
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil {
				active[id] = true
			}
		}
		rows.Close()
	}
	pause := time.Duration(envInt("REPAIR_LIST_PAUSE_MS", 1500)) * time.Millisecond
	done := 0
	for joID, version := range repairListJobs() {
		if s, ok := stored[joID]; ok {
			if s.failed && s.at >= cutoff {
				continue // failed or no repair list: tried again after a day
			}
			if !s.failed && s.format == repairListFormat && s.version >= version && (!active[joID] || s.at >= cutoff) {
				continue
			}
		}
		items, used, err := fetchRepairList(src, override, joID, version)
		if err != nil {
			var status *workers.HTTPStatusError
			if se, ok := err.(*workers.HTTPStatusError); ok {
				status = se
			}
			if status != nil && (status.Code == http.StatusUnauthorized || status.Code == http.StatusForbidden) {
				return done, fmt.Errorf("SIAGA menolak akses (HTTP %d); perbarui kredensial di API Sync Config", status.Code)
			}
			recordRepairListError(joID, err.Error())
			log.Printf("[REPAIR LIST] %s: %v", joID, err)
		} else if used == 0 {
			recordRepairListError(joID, "tidak ada repair list di SIAGA")
		} else if err := storeRepairList(joID, used, items); err != nil {
			return done, err
		} else {
			done++
		}
		time.Sleep(pause)
	}
	if done > 0 {
		InvalidateWorkOrderCache()
	}
	return done, nil
}

// StartRepairListWorker syncs repair lists 10 minutes after start and then
// every REPAIR_LIST_HOURS (6).
func StartRepairListWorker() {
	every := time.Duration(envInt("REPAIR_LIST_HOURS", 6)) * time.Hour
	go func() {
		time.Sleep(time.Duration(envInt("REPAIR_LIST_START_MINUTES", 10)) * time.Minute)
		for {
			start := time.Now()
			n, err := syncRepairLists()
			if err != nil {
				log.Printf("[REPAIR LIST] stopped after %d Job Orders: %v", n, err)
			} else if n > 0 {
				log.Printf("[REPAIR LIST] fetched %d Job Orders in %s", n, time.Since(start).Round(time.Second))
			}
			time.Sleep(every)
		}
	}()
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

// GetRepairLists lists Job Orders with a repair list: code, ship, version,
// items, total and how much of it already has a WO. Query: q, limit.
func GetRepairLists(w http.ResponseWriter, r *http.Request) {
	showPrice := HasResourcePermission(r, ResourceRepairPrices, "view")
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 1000 {
		limit = 300
	}
	where, args := "", []interface{}{}
	if q != "" {
		where = " AND LOWER(COALESCE(c.jo_code, '')) LIKE ?"
		args = append(args, "%"+strings.ToLower(q)+"%")
	}
	rows, err := db.Query(`
		WITH c AS (
			SELECT l.jo_id, COALESCE(MAX(a.jo_code), MAX(j.code || ' - ' || COALESCE(j.m_ship_name, '')),
				MAX(p.idproject || ' - ' || COALESCE(p.shipname, '')), '') AS jo_code
			FROM jo_repair_lists l
			LEFT JOIN wo_repair_activities a ON a.jo_id = l.jo_id
			LEFT JOIN sync_job_orders j ON j.id = l.jo_id
			LEFT JOIN projects p ON CAST(p.id_siaga AS TEXT) = l.jo_id
			GROUP BY l.jo_id
		), inwo AS (
			SELECT i.jo_id, COUNT(*) AS n, COALESCE(SUM(i.total_price), 0) AS price
			FROM jo_repair_items i
			WHERE i.is_leaf AND EXISTS (SELECT 1 FROM wo_repair_activities a WHERE a.jo_id = i.jo_id AND a.activity_key = i.uniqcode)
			GROUP BY i.jo_id
		), leaf AS (
			SELECT jo_id, COUNT(*) AS n FROM jo_repair_items WHERE is_leaf GROUP BY jo_id
		)
		SELECT l.jo_id, c.jo_code, COALESCE(l.version, 0), COALESCE(leaf.n, 0), COALESCE(l.total_price, 0),
			COALESCE(inwo.n, 0), COALESCE(inwo.price, 0), COALESCE(l.fetched_at, ''), COALESCE(l.error, '')
		FROM jo_repair_lists l JOIN c ON c.jo_id = l.jo_id
		LEFT JOIN inwo ON inwo.jo_id = l.jo_id
		LEFT JOIN leaf ON leaf.jo_id = l.jo_id
		WHERE (COALESCE(l.items, 0) > 0 OR COALESCE(l.error, '') NOT IN ('', 'tidak ada repair list di SIAGA'))`+where+`
		ORDER BY l.total_price DESC LIMIT `+strconv.Itoa(limit), args...)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	list := []map[string]interface{}{}
	for rows.Next() {
		var id, code, at, failure string
		var version, items, inWO int
		var total, inWOPrice float64
		if rows.Scan(&id, &code, &version, &items, &total, &inWO, &inWOPrice, &at, &failure) != nil {
			continue
		}
		row := map[string]interface{}{"jo_id": id, "jo_code": code, "version": version, "items": items, "items_in_wo": inWO, "fetched_at": at, "error": failure}
		if showPrice {
			row["total_price"], row["price_in_wo"] = total, inWOPrice
		}
		list = append(list, row)
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"job_orders": list, "show_price": showPrice})
}

// GetRepairList returns one Job Order's repair list in order, each activity
// with the WOs that carry it and the vendor cost booked under it.
func GetRepairList(w http.ResponseWriter, r *http.Request) {
	showPrice := HasResourcePermission(r, ResourceRepairPrices, "view")
	joID := chi.URLParam(r, "id")
	type woUse struct {
		WOID   string  `json:"wo_id"`
		WOCode string  `json:"wo_code"`
		Vendor string  `json:"vendor"`
		Cost   float64 `json:"cost"`
	}
	uses := map[string][]woUse{}
	if rows, err := db.Query(`SELECT a.activity_key, a.wo_id, COALESCE(MAX(s.wo_code), ''), COALESCE(MAX(s.vendor_name), ''),
			COALESCE(SUM(CASE WHEN i.status <> 'rejected' THEN i.total_cost ELSE 0 END), 0)
		FROM wo_repair_activities a
		LEFT JOIN wo_items i ON i.wo_id = a.wo_id AND i.activity_path = a.activity_path
		LEFT JOIN work_order_summary s ON s.wo_id = a.wo_id
		WHERE a.jo_id = ? GROUP BY a.activity_key, a.wo_id ORDER BY 3`, joID); err == nil {
		for rows.Next() {
			var key string
			var u woUse
			if rows.Scan(&key, &u.WOID, &u.WOCode, &u.Vendor, &u.Cost) == nil {
				if !showPrice {
					u.Cost = 0
				}
				uses[key] = append(uses[key], u)
			}
		}
		rows.Close()
	}

	items := []map[string]interface{}{}
	var total, inWO float64
	leaves, leavesInWO := 0, 0
	rows, err := db.Query(`SELECT uniqcode, COALESCE(parent_uniqcode, ''), depth, COALESCE(path, ''), COALESCE(description, ''),
			COALESCE(unit, ''), COALESCE(quantity, 0), COALESCE(unit_price, 0), COALESCE(total_price, 0), is_leaf
		FROM jo_repair_items WHERE jo_id = ? ORDER BY seq`, joID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	for rows.Next() {
		var uniq, parent, path, desc, unit string
		var depth int
		var qty, unitPrice, totalPrice float64
		var leaf bool
		if rows.Scan(&uniq, &parent, &depth, &path, &desc, &unit, &qty, &unitPrice, &totalPrice, &leaf) != nil {
			continue
		}
		wos := uses[uniq]
		if wos == nil {
			wos = []woUse{}
		}
		item := map[string]interface{}{"uniqcode": uniq, "parent": parent, "depth": depth, "path": path, "description": desc,
			"unit": unit, "quantity": qty, "leaf": leaf, "wos": wos}
		if showPrice {
			item["unit_price"], item["total_price"] = unitPrice, totalPrice
		}
		if leaf {
			leaves++
			total += totalPrice
			if len(wos) > 0 {
				leavesInWO++
				inWO += totalPrice
			}
		}
		items = append(items, item)
	}
	rows.Close()

	var version int
	var fetched, failure, code string
	db.QueryRow(`SELECT COALESCE(version, 0), COALESCE(fetched_at, ''), COALESCE(error, '') FROM jo_repair_lists WHERE jo_id = ?`, joID).Scan(&version, &fetched, &failure)
	db.QueryRow(`SELECT COALESCE(MAX(jo_code), '') FROM wo_repair_activities WHERE jo_id = ?`, joID).Scan(&code)
	if code == "" {
		db.QueryRow(`SELECT COALESCE(code, '') || ' - ' || COALESCE(m_ship_name, '') FROM sync_job_orders WHERE id = ?`, joID).Scan(&code)
	}
	if code == "" {
		db.QueryRow(`SELECT COALESCE(idproject, '') || ' - ' || COALESCE(shipname, '') FROM projects WHERE CAST(id_siaga AS TEXT) = ?`, joID).Scan(&code)
	}
	summary := map[string]interface{}{"jo_id": joID, "jo_code": code, "version": version, "fetched_at": fetched, "error": failure,
		"items": leaves, "items_in_wo": leavesInWO}
	if showPrice {
		var cost, approved float64
		db.QueryRow(`SELECT COALESCE(SUM(CASE WHEN i.status <> 'rejected' THEN i.total_cost ELSE 0 END), 0),
				COALESCE(SUM(CASE WHEN i.status = 'approved' THEN i.total_cost ELSE 0 END), 0)
			FROM wo_items i WHERE i.wo_id IN (SELECT DISTINCT wo_id FROM wo_repair_activities WHERE jo_id = ?)`, joID).Scan(&cost, &approved)
		summary["total_price"], summary["price_in_wo"], summary["price_without_wo"] = total, inWO, total-inWO
		summary["cost"], summary["cost_approved"], summary["margin"] = cost, approved, total-cost
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"summary": summary, "items": items, "show_price": showPrice})
}

// PostRepairListSync fetches one Job Order's repair list now.
func PostRepairListSync(w http.ResponseWriter, r *http.Request) {
	joID := chi.URLParam(r, "id")
	src, err := loadDetailSource()
	if err != nil || src.url == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "API Sync Config untuk Work Order belum diatur"})
		return
	}
	override := repairListOverride(&src)
	items, version, err := fetchRepairList(src, override, joID, repairListJobs()[joID])
	if err != nil {
		recordRepairListError(joID, err.Error())
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "Gagal menarik repair list dari SIAGA: " + err.Error()})
		return
	}
	if version == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Job Order ini tidak punya repair list di SIAGA"})
		return
	}
	if err := storeRepairList(joID, version, items); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	InvalidateWorkOrderCache()
	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "ok", "version": version, "items": len(items)})
}
