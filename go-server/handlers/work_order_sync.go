package handlers

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"shipyard/db"
	"shipyard/workers"
)

// ---------------------------------------------------------------------------
// WO list → work_order_summary
// ---------------------------------------------------------------------------

// summaryListColumns are the summary fields owned by the WO list. Financial
// columns are owned by the detail and are never touched here.
const summaryListColumns = "wo_id, wo_code, jo_code, project_name, vendor_name, ship_name, status_approval, derived_status, total_cost, created_source_at, updated_source_at, latest_date, project_type"

// ProcessWorkOrderList upserts the list fields of every WO whose list data
// changed. Registered as the "WorkOrders" list processor in main.
func ProcessWorkOrderList(body []byte) error {
	var parsed interface{}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return fmt.Errorf("parse WO list: %w", err)
	}
	var list []interface{}
	switch value := parsed.(type) {
	case []interface{}:
		list = value
	case map[string]interface{}:
		list, _ = value["data"].([]interface{})
	}
	if len(list) == 0 {
		return nil
	}

	existing := map[string]workOrderSummary{}
	rows, err := db.Query(`SELECT wo_id, COALESCE(wo_code, ''), COALESCE(jo_code, ''), COALESCE(project_name, ''), COALESCE(vendor_name, ''),
		COALESCE(ship_name, ''), COALESCE(status_approval, ''), COALESCE(derived_status, ''), COALESCE(total_cost, 0),
		COALESCE(created_source_at, ''), COALESCE(updated_source_at, ''), COALESCE(project_type, '') FROM work_order_summary`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var s workOrderSummary
		if rows.Scan(&s.WOID, &s.WOCode, &s.JOCode, &s.ProjectName, &s.VendorName, &s.ShipName, &s.StatusApproval,
			&s.DerivedStatus, &s.TotalCost, &s.CreatedSourceAt, &s.UpdatedSourceAt, &s.ProjectType) == nil {
			existing[s.WOID] = s
		}
	}
	rows.Close()

	changed := make([]workOrderSummary, 0)
	seen := map[string]bool{}
	for _, raw := range list {
		item, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		s := summaryFromWorkOrderListItem(item)
		if s.WOID == "" || seen[s.WOID] {
			continue
		}
		seen[s.WOID] = true
		if old, ok := existing[s.WOID]; ok && sameListFields(old, s) {
			continue
		}
		changed = append(changed, s)
	}
	if len(changed) == 0 {
		return nil
	}
	if err := upsertSummaryListFields(changed); err != nil {
		return err
	}
	log.Printf("[WO LIST] %d of %d work orders new or changed", len(changed), len(seen))
	return nil
}

func sameListFields(a, b workOrderSummary) bool {
	return a.WOCode == b.WOCode && a.JOCode == b.JOCode && a.ProjectName == b.ProjectName &&
		a.VendorName == b.VendorName && a.ShipName == b.ShipName && a.StatusApproval == b.StatusApproval &&
		a.DerivedStatus == b.DerivedStatus && math.Abs(a.TotalCost-b.TotalCost) < 0.005 &&
		a.CreatedSourceAt == b.CreatedSourceAt && a.UpdatedSourceAt == b.UpdatedSourceAt &&
		// internal is sticky: a list fetched without the internal URL (e.g. by an
		// older server) must not flip it back to external.
		(a.ProjectType == b.ProjectType || a.ProjectType == "internal")
}

// upsertSummaryListFields writes list-owned columns in multi-row batches inside
// one transaction. latest_date is only filled when the row has none yet, since
// the detail derives a more precise one.
func upsertSummaryListFields(items []workOrderSummary) error {
	tx, err := db.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	const batchSize = 200
	for start := 0; start < len(items); start += batchSize {
		end := start + batchSize
		if end > len(items) {
			end = len(items)
		}
		placeholders := make([]string, 0, end-start)
		args := make([]interface{}, 0, (end-start)*12)
		for _, s := range items[start:end] {
			placeholders = append(placeholders, "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
			args = append(args, s.WOID, s.WOCode, s.JOCode, s.ProjectName, s.VendorName, s.ShipName,
				s.StatusApproval, s.DerivedStatus, s.TotalCost, s.CreatedSourceAt, s.UpdatedSourceAt, s.LatestDate, s.ProjectType)
		}
		query := `INSERT INTO work_order_summary (` + summaryListColumns + `) VALUES ` + strings.Join(placeholders, ", ") + `
			ON CONFLICT(wo_id) DO UPDATE SET
				wo_code = excluded.wo_code,
				jo_code = excluded.jo_code,
				project_name = excluded.project_name,
				vendor_name = excluded.vendor_name,
				ship_name = excluded.ship_name,
				status_approval = excluded.status_approval,
				derived_status = excluded.derived_status,
				total_cost = excluded.total_cost,
				created_source_at = excluded.created_source_at,
				updated_source_at = excluded.updated_source_at,
				latest_date = CASE WHEN COALESCE(work_order_summary.latest_date, '') = '' THEN excluded.latest_date ELSE work_order_summary.latest_date END,
				project_type = CASE WHEN work_order_summary.project_type = 'internal' THEN 'internal' ELSE excluded.project_type END,
				updated_at = CURRENT_TIMESTAMP`
		if _, err := tx.Exec(db.FormatQuery(query), args...); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	InvalidateWorkOrderCache()
	return nil
}

// ---------------------------------------------------------------------------
// WO detail fetch + store
// ---------------------------------------------------------------------------

type detailSource struct {
	configID string
	url      string
	headers  map[string]string
	rawHdrs  string
	active   bool
}

// loadDetailSource reads the WorkOrderDetails config, falling back to WorkOrders.
func loadDetailSource() (detailSource, error) {
	var src detailSource
	err := db.QueryRow("SELECT id, url, COALESCE(headers, ''), is_active FROM sync_configs WHERE id = 'WorkOrderDetails'").
		Scan(&src.configID, &src.url, &src.rawHdrs, &src.active)
	if err != nil {
		err = db.QueryRow("SELECT id, url, COALESCE(headers, ''), is_active FROM sync_configs WHERE id = 'WorkOrders'").
			Scan(&src.configID, &src.url, &src.rawHdrs, &src.active)
		if err != nil {
			return src, fmt.Errorf("API Config not found")
		}
	}
	if src.rawHdrs != "" {
		json.Unmarshal([]byte(src.rawHdrs), &src.headers)
	}
	return src, nil
}

func (src detailSource) detailURL(woID string) string {
	switch {
	case strings.Contains(src.url, "{{id}}"):
		return strings.ReplaceAll(src.url, "{{id}}", woID)
	case strings.Contains(src.url, "{{WO_ID}}"):
		return strings.ReplaceAll(src.url, "{{WO_ID}}", woID)
	case strings.HasSuffix(src.url, woID):
		return src.url
	default:
		return fmt.Sprintf("%s/%s", strings.TrimRight(src.url, "/"), woID)
	}
}

var detailHTTPClient = &http.Client{Timeout: 30 * time.Second}

// fetchRemoteWorkOrderDetail returns the body only for HTTP 200; any other
// status comes back as *workers.HTTPStatusError and nothing is stored.
func fetchRemoteWorkOrderDetail(src detailSource, woID string) ([]byte, error) {
	fetchURL := src.detailURL(woID)
	req, err := http.NewRequest("GET", fetchURL, nil)
	if err != nil {
		return nil, err
	}
	for k, v := range src.headers {
		req.Header.Set(k, v)
	}
	resp, err := detailHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, &workers.HTTPStatusError{URL: fetchURL, Code: resp.StatusCode}
	}
	return body, nil
}

// storeWorkOrderDetail saves the raw detail and refreshes the summary
// financials and daily ledger.
func storeWorkOrderDetail(woID string, body []byte) error {
	if _, err := db.Exec(
		"INSERT INTO work_order_details (wo_id, raw_json, last_sync) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(wo_id) DO UPDATE SET raw_json = excluded.raw_json, last_sync = CURRENT_TIMESTAMP",
		woID, string(body),
	); err != nil {
		return err
	}
	if err := writeDetailDerived([]detailDerived{deriveFromDetail(woID, body)}); err != nil {
		log.Printf("[WO SUMMARY ERROR] %s: %v", woID, err)
	}
	return nil
}

// detailDerived is everything the dashboard needs from one stored detail.
type detailDerived struct {
	summary         workOrderSummary
	detailUpdatedAt string
}

func deriveFromDetail(woID string, raw []byte) detailDerived {
	d := detailDerived{summary: applyFinancialsFromDetail(workOrderSummary{WOID: woID}, raw)}
	if data, err := dataObject(raw); err == nil {
		d.detailUpdatedAt = firstString(data, "updated_at", "last_updated")
	}
	return d
}

// writeDetailDerived writes detail-owned summary columns (financials,
// latest_date, detail_updated_at) and replaces each WO's per-day ledger, in one
// transaction with multi-row statements. List-owned columns (codes, vendor,
// status, updated_source_at, total_cost) are only filled when still empty: the
// list is authoritative for them, and leaving updated_source_at alone is what
// lets a stale stored detail still be detected as changed.
func writeDetailDerived(items []detailDerived) error {
	if len(items) == 0 {
		return nil
	}
	tx, err := db.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	const summaryBatch = 200
	for start := 0; start < len(items); start += summaryBatch {
		chunk := items[start:min(start+summaryBatch, len(items))]
		placeholders := make([]string, 0, len(chunk))
		idMarks := make([]string, 0, len(chunk))
		idArgs := make([]interface{}, 0, len(chunk))
		args := make([]interface{}, 0, len(chunk)*18)
		for _, d := range chunk {
			s := d.summary
			placeholders = append(placeholders, "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)")
			idMarks = append(idMarks, "?")
			idArgs = append(idArgs, s.WOID)
			args = append(args, s.WOID, s.WOCode, s.JOCode, s.ProjectName, s.VendorName, s.ShipName, s.StatusApproval, s.DerivedStatus,
				s.LatestDate, s.PendingCost, s.FinalCost, s.LatestCost, s.PreviousCost, s.RejectedCost, s.TotalCost,
				s.CreatedSourceAt, s.UpdatedSourceAt, d.detailUpdatedAt)
		}
		if _, err := tx.Exec(db.FormatQuery(`
			INSERT INTO work_order_summary (
				wo_id, wo_code, jo_code, project_name, vendor_name, ship_name, status_approval, derived_status,
				latest_date, pending_cost, final_cost, latest_cost, previous_cost, rejected_cost, total_cost,
				created_source_at, updated_source_at, detail_updated_at, updated_at
			) VALUES `+strings.Join(placeholders, ", ")+`
			ON CONFLICT(wo_id) DO UPDATE SET
				wo_code = COALESCE(NULLIF(work_order_summary.wo_code, ''), excluded.wo_code),
				jo_code = CASE WHEN COALESCE(work_order_summary.jo_code, '') IN ('', 'N/A') THEN excluded.jo_code ELSE work_order_summary.jo_code END,
				project_name = CASE WHEN COALESCE(work_order_summary.project_name, '') IN ('', 'N/A - N/A') THEN excluded.project_name ELSE work_order_summary.project_name END,
				vendor_name = COALESCE(NULLIF(work_order_summary.vendor_name, ''), excluded.vendor_name),
				ship_name = CASE WHEN COALESCE(work_order_summary.ship_name, '') IN ('', 'N/A') THEN excluded.ship_name ELSE work_order_summary.ship_name END,
				status_approval = COALESCE(NULLIF(work_order_summary.status_approval, ''), excluded.status_approval),
				derived_status = COALESCE(NULLIF(work_order_summary.derived_status, ''), excluded.derived_status),
				latest_date = COALESCE(NULLIF(excluded.latest_date, ''), work_order_summary.latest_date),
				pending_cost = excluded.pending_cost,
				final_cost = excluded.final_cost,
				latest_cost = excluded.latest_cost,
				previous_cost = excluded.previous_cost,
				rejected_cost = excluded.rejected_cost,
				total_cost = CASE WHEN COALESCE(work_order_summary.total_cost, 0) > 0 THEN work_order_summary.total_cost ELSE excluded.total_cost END,
				created_source_at = COALESCE(NULLIF(work_order_summary.created_source_at, ''), excluded.created_source_at),
				updated_source_at = COALESCE(NULLIF(work_order_summary.updated_source_at, ''), excluded.updated_source_at),
				detail_updated_at = excluded.detail_updated_at,
				updated_at = CURRENT_TIMESTAMP`), args...); err != nil {
			return err
		}

		if _, err := tx.Exec(db.FormatQuery("DELETE FROM work_order_daily_costs WHERE wo_id IN ("+strings.Join(idMarks, ", ")+")"), idArgs...); err != nil {
			return err
		}

		const ledgerBatch = 500
		var rows []string
		var rowArgs []interface{}
		flush := func() error {
			if len(rows) == 0 {
				return nil
			}
			_, err := tx.Exec(db.FormatQuery("INSERT INTO work_order_daily_costs (wo_id, cost_date, approved_cost) VALUES "+strings.Join(rows, ", ")), rowArgs...)
			rows, rowArgs = rows[:0], rowArgs[:0]
			return err
		}
		for _, d := range chunk {
			for date, cost := range d.summary.DailyCosts {
				if cost == 0 || date == "" {
					continue
				}
				rows = append(rows, "(?, ?, ?)")
				rowArgs = append(rowArgs, d.summary.WOID, date, cost)
				if len(rows) >= ledgerBatch {
					if err := flush(); err != nil {
						return err
					}
				}
			}
		}
		if err := flush(); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	InvalidateWorkOrderCache()
	return nil
}

// ---------------------------------------------------------------------------
// Rebuild derived data from stored details (no SIAGA calls)
// ---------------------------------------------------------------------------

// derivedDataVersion changes whenever the way summary financials or the daily
// ledger are computed changes; a mismatch triggers a one-time local rebuild.
const derivedDataVersion = "2026-10-11.daily-costs"

type rebuildProgress struct {
	Running    bool   `json:"running"`
	Done       int    `json:"done"`
	Total      int    `json:"total"`
	StartedAt  string `json:"started_at"`
	FinishedAt string `json:"finished_at"`
	Error      string `json:"error"`
}

var rebuildState = struct {
	sync.Mutex
	rebuildProgress
}{}

func rebuildSnapshot() rebuildProgress {
	rebuildState.Lock()
	defer rebuildState.Unlock()
	return rebuildState.rebuildProgress
}

// RebuildWorkOrderDerived recomputes summary financials and the daily ledger
// for every stored detail, reading work_order_details in batches by wo_id.
func RebuildWorkOrderDerived() error {
	rebuildState.Lock()
	if rebuildState.Running {
		rebuildState.Unlock()
		return fmt.Errorf("rebuild already running")
	}
	rebuildState.rebuildProgress = rebuildProgress{Running: true, StartedAt: time.Now().Format("2006-01-02 15:04:05")}
	rebuildState.Unlock()

	err := rebuildWorkOrderDerived()

	rebuildState.Lock()
	rebuildState.Running = false
	rebuildState.FinishedAt = time.Now().Format("2006-01-02 15:04:05")
	if err != nil {
		rebuildState.Error = err.Error()
	}
	rebuildState.Unlock()
	return err
}

// ReprocessStoredWorkOrderList applies the WO list already stored by the last
// successful list sync (sync_configs.last_response) to the summary, without
// calling SIAGA. Older code only stored that blob, so codes, status and
// total_cost of recent WOs could lag behind it.
func ReprocessStoredWorkOrderList() error {
	var body string
	if err := db.QueryRow("SELECT COALESCE(last_response, '') FROM sync_configs WHERE id = 'WorkOrders'").Scan(&body); err != nil || body == "" {
		return nil
	}
	return ProcessWorkOrderList([]byte(body))
}

// ReprocessStoredWorkOrderListHandler is the Admin endpoint for the above.
func ReprocessStoredWorkOrderListHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if err := ReprocessStoredWorkOrderList(); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	w.Write([]byte(`{"success": true}`))
}

func rebuildWorkOrderDerived() error {
	// List fields first, so detail-derived rows land on current WO metadata.
	if err := ReprocessStoredWorkOrderList(); err != nil {
		log.Printf("[WO DERIVED] stored WO list not applied: %v", err)
	}

	var total int
	db.QueryRow("SELECT COUNT(*) FROM work_order_details").Scan(&total)
	rebuildState.Lock()
	rebuildState.Total = total
	rebuildState.Unlock()

	start := time.Now()
	last := ""
	for {
		rows, err := db.Query("SELECT wo_id, raw_json FROM work_order_details WHERE wo_id > ? ORDER BY wo_id LIMIT 200", last)
		if err != nil {
			return err
		}
		read := 0
		batch := make([]detailDerived, 0, 200)
		for rows.Next() {
			var id string
			var raw []byte
			if err := rows.Scan(&id, &raw); err != nil {
				rows.Close()
				return err
			}
			read++
			last = id
			if _, err := dataObject(raw); err != nil {
				continue // error bodies etc.; the detail worker re-fetches those
			}
			batch = append(batch, deriveFromDetail(id, raw))
		}
		rows.Close()
		if read == 0 {
			break
		}
		if err := writeDetailDerived(batch); err != nil {
			return err
		}
		rebuildState.Lock()
		rebuildState.Done += read
		rebuildState.Unlock()
	}
	db.Exec("DELETE FROM app_meta WHERE key = 'wo_derived_version'")
	db.Exec("INSERT INTO app_meta (key, value) VALUES ('wo_derived_version', ?)", derivedDataVersion)
	InvalidateWorkOrderCache()
	log.Printf("[WO DERIVED] rebuilt summary financials and daily costs for %d work orders in %s", total, time.Since(start).Round(time.Second))
	return nil
}

// maybeRebuildDerived runs the local rebuild once per derivedDataVersion.
func maybeRebuildDerived() {
	var version string
	db.QueryRow("SELECT COALESCE(value, '') FROM app_meta WHERE key = 'wo_derived_version'").Scan(&version)
	if version == derivedDataVersion {
		return
	}
	log.Printf("[WO DERIVED] version %q -> %q: rebuilding from stored details (no SIAGA calls)", version, derivedDataVersion)
	if err := RebuildWorkOrderDerived(); err != nil {
		log.Printf("[WO DERIVED] rebuild failed: %v", err)
	}
}

// RebuildWorkOrderDerivedHandler starts a local rebuild in the background.
func RebuildWorkOrderDerivedHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if rebuildSnapshot().Running {
		w.WriteHeader(http.StatusConflict)
		w.Write([]byte(`{"error": "Rebuild sedang berjalan"}`))
		return
	}
	go func() {
		if err := RebuildWorkOrderDerived(); err != nil {
			log.Printf("[WO DERIVED] rebuild failed: %v", err)
		}
	}()
	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte(`{"success": true, "message": "Rebuild dimulai"}`))
}

// ---------------------------------------------------------------------------
// Background detail worker
// ---------------------------------------------------------------------------

func envInt(key string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil && v > 0 {
		return v
	}
	return def
}

var detailWorker = struct {
	sync.Mutex
	pausedHeaders string    // hash of headers that were rejected (401/403)
	pausedAt      time.Time // when the auth pause started
	retryAfter    map[string]time.Time
	failures      map[string]int
}{retryAfter: map[string]time.Time{}, failures: map[string]int{}}

func headersHash(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return fmt.Sprintf("%x", sum[:8])
}

// openResyncHours is the optional periodic re-check window for open WOs. Off (0)
// by default: change detection via updated_at already catches WO changes, so
// this only adds SIAGA traffic. Set WO_OPEN_RESYNC_HOURS to enable it.
func openResyncHours() int {
	if v, err := strconv.Atoi(os.Getenv("WO_OPEN_RESYNC_HOURS")); err == nil && v > 0 {
		return v
	}
	return 0
}

// staleOpenClause matches open (not Level 5) WOs whose detail is older than the
// re-check window (never, when hours is 0); timestamp arithmetic differs per dialect.
func staleOpenClause(hours int) string {
	if hours <= 0 {
		return "(1 = 0)"
	}
	if os.Getenv("DB_CONNECTION") == "postgres" {
		return fmt.Sprintf("(COALESCE(s.derived_status, '') <> 'Approval Level 5' AND d.last_sync < LOCALTIMESTAMP - INTERVAL '%d hours')", hours)
	}
	return fmt.Sprintf("(COALESCE(s.derived_status, '') <> 'Approval Level 5' AND d.last_sync < datetime('now', '-%d hours'))", hours)
}

const detailChangedClause = "(s.detail_updated_at IS NULL OR s.detail_updated_at <> COALESCE(s.updated_source_at, ''))"

// initDetailUpdatedAt fills detail_updated_at from the stored raw JSON for rows
// that don't have it yet, so existing details aren't all treated as changed.
// The JSON is parsed inside the database.
func initDetailUpdatedAt() {
	var pending int
	db.QueryRow(`SELECT COUNT(*) FROM work_order_summary s JOIN work_order_details d ON d.wo_id = s.wo_id WHERE s.detail_updated_at IS NULL`).Scan(&pending)
	if pending == 0 {
		return
	}
	start := time.Now()
	var err error
	if os.Getenv("DB_CONNECTION") == "postgres" {
		_, err = db.Exec(`
			UPDATE work_order_summary s
			SET detail_updated_at = COALESCE(d.j->'data'->>'updated_at', d.j->>'updated_at', '')
			FROM (SELECT wo_id, raw_json::text::jsonb AS j FROM work_order_details WHERE raw_json::text LIKE '{%') d
			WHERE d.wo_id = s.wo_id AND s.detail_updated_at IS NULL`)
	} else {
		_, err = db.Exec(`
			UPDATE work_order_summary
			SET detail_updated_at = (
				SELECT COALESCE(json_extract(d.raw_json, '$.data.updated_at'), json_extract(d.raw_json, '$.updated_at'), '')
				FROM work_order_details d WHERE d.wo_id = work_order_summary.wo_id AND json_valid(d.raw_json))
			WHERE detail_updated_at IS NULL AND wo_id IN (SELECT wo_id FROM work_order_details)`)
	}
	if err != nil {
		log.Printf("[WO DETAIL] init detail_updated_at failed: %v", err)
		return
	}
	// Unparseable details get '' so they're re-fetched instead of re-scanned every tick.
	db.Exec(`UPDATE work_order_summary SET detail_updated_at = '' WHERE detail_updated_at IS NULL AND wo_id IN (SELECT wo_id FROM work_order_details)`)
	log.Printf("[WO DETAIL] initialised detail_updated_at for %d work orders in %s", pending, time.Since(start).Round(time.Millisecond))
}

// StartWorkOrderDetailWorker keeps WO details fresh. Each tick it re-fetches a
// small batch, in priority order:
//  1. WOs with no stored detail,
//  2. WOs whose list updated_at differs from the stored detail's updated_at
//     (catches changes on WOs of any age),
//  3. only if WO_OPEN_RESYNC_HOURS is set: open (not Level 5) WOs not
//     re-checked within that window, as an extra safety net.
//
// It pauses on 401/403 until the config headers change (or 30 min pass).
func StartWorkOrderDetailWorker() {
	interval := time.Duration(envInt("WO_DETAIL_INTERVAL_SECONDS", 60)) * time.Second
	go func() {
		// Derived data first, from what's already stored; SIAGA is only asked
		// for details that are missing or changed afterwards.
		if err := ReprocessStoredWorkOrderList(); err != nil {
			log.Printf("[WO LIST] stored list not applied: %v", err)
		}
		maybeRebuildDerived()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			runDetailBatch()
			<-ticker.C
		}
	}()
	log.Printf("Work order detail worker started (every %s, batch %d, concurrency %d)",
		interval, envInt("WO_DETAIL_BATCH", 20), envInt("WO_DETAIL_CONCURRENCY", 3))
}

func runDetailBatch() {
	batch := envInt("WO_DETAIL_BATCH", 20)
	concurrency := envInt("WO_DETAIL_CONCURRENCY", 3)
	openHours := openResyncHours()

	src, err := loadDetailSource()
	if err != nil || !src.active || src.url == "" {
		return
	}

	detailWorker.Lock()
	if detailWorker.pausedHeaders != "" {
		if detailWorker.pausedHeaders == headersHash(src.rawHdrs) && time.Since(detailWorker.pausedAt) < 30*time.Minute {
			detailWorker.Unlock()
			return
		}
		detailWorker.pausedHeaders = ""
	}
	detailWorker.Unlock()

	// Cheap no-op once every stored detail has its updated_at recorded.
	initDetailUpdatedAt()

	rows, err := db.Query(`
		SELECT s.wo_id FROM work_order_summary s
		LEFT JOIN work_order_details d ON d.wo_id = s.wo_id
		WHERE d.wo_id IS NULL OR `+detailChangedClause+` OR `+staleOpenClause(openHours)+`
		ORDER BY CASE WHEN d.wo_id IS NULL THEN 0 WHEN `+detailChangedClause+` THEN 1 ELSE 2 END,
			s.updated_source_at DESC
		LIMIT ?`, batch*5)
	if err != nil {
		log.Printf("[WO DETAIL] queue query failed: %v", err)
		return
	}
	ids := make([]string, 0, batch)
	now := time.Now()
	detailWorker.Lock()
	for rows.Next() && len(ids) < batch {
		var id string
		if rows.Scan(&id) == nil && now.After(detailWorker.retryAfter[id]) {
			ids = append(ids, id)
		}
	}
	detailWorker.Unlock()
	rows.Close()
	if len(ids) == 0 {
		return
	}

	var authFailed atomic.Bool
	var okCount, failCount atomic.Int32
	var lastErr error // guarded by detailWorker's mutex
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	for _, id := range ids {
		if authFailed.Load() {
			break
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(woID string) {
			defer wg.Done()
			defer func() { <-sem }()
			if authFailed.Load() {
				return
			}
			body, err := fetchRemoteWorkOrderDetail(src, woID)
			if err == nil {
				err = storeWorkOrderDetail(woID, body)
			}
			detailWorker.Lock()
			defer detailWorker.Unlock()
			if err != nil {
				failCount.Add(1)
				lastErr = err
				if workers.IsAuthError(err) {
					authFailed.Store(true)
					return
				}
				log.Printf("[WO DETAIL] %s: %v", woID, err)
				var statusErr *workers.HTTPStatusError
				if !errors.As(err, &statusErr) {
					// Network/DB errors are transient: retry on the next tick.
					return
				}
				// SIAGA rejected this WO (e.g. deleted upstream): back off so it can't
				// block the queue: 15m, 30m, ... max 24h.
				detailWorker.failures[woID]++
				backoff := time.Duration(15<<min(detailWorker.failures[woID]-1, 7)) * time.Minute
				if backoff > 24*time.Hour {
					backoff = 24 * time.Hour
				}
				detailWorker.retryAfter[woID] = time.Now().Add(backoff)
				return
			}
			okCount.Add(1)
			delete(detailWorker.failures, woID)
			delete(detailWorker.retryAfter, woID)
		}(id)
	}
	wg.Wait()

	if authFailed.Load() {
		detailWorker.Lock()
		detailWorker.pausedHeaders = headersHash(src.rawHdrs)
		detailWorker.pausedAt = time.Now()
		detailWorker.Unlock()
		workers.SetSyncStatus(src.configID, lastErr)
		log.Printf("[WO DETAIL] SIAGA rejected credentials (%v); paused until API Sync Config headers change", lastErr)
		return
	}
	if okCount.Load() > 0 {
		workers.SetSyncStatus(src.configID, nil)
	} else if lastErr != nil {
		workers.SetSyncStatus(src.configID, lastErr)
	}
	log.Printf("[WO DETAIL] batch done: %d refreshed, %d failed", okCount.Load(), failCount.Load())
}

// ---------------------------------------------------------------------------
// Status endpoint
// ---------------------------------------------------------------------------

type syncConfigStatus struct {
	ID          string `json:"id"`
	LastSync    string `json:"last_sync"`
	LastStatus  string `json:"last_status"`
	LastError   string `json:"last_error"`
	LastErrorAt string `json:"last_error_at"`
}

func readSyncConfigStatus(id string) *syncConfigStatus {
	s := syncConfigStatus{ID: id}
	err := db.QueryRow(`SELECT COALESCE(last_sync, ''), COALESCE(last_status, ''), COALESCE(last_error, ''), COALESCE(last_error_at, '')
		FROM sync_configs WHERE id = ?`, id).Scan(&s.LastSync, &s.LastStatus, &s.LastError, &s.LastErrorAt)
	if err != nil {
		return nil
	}
	return &s
}

// GetWorkOrderSyncStatus reports list/detail sync health and the detail queue,
// so the dashboard can warn when SIAGA credentials have expired.
func GetWorkOrderSyncStatus(w http.ResponseWriter, r *http.Request) {
	openHours := openResyncHours()
	var missing, changed, staleOpen int
	db.QueryRow(`
		SELECT
			COALESCE(SUM(CASE WHEN d.wo_id IS NULL THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN d.wo_id IS NOT NULL AND `+detailChangedClause+` THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN d.wo_id IS NOT NULL AND NOT `+detailChangedClause+` AND `+staleOpenClause(openHours)+` THEN 1 ELSE 0 END), 0)
		FROM work_order_summary s LEFT JOIN work_order_details d ON d.wo_id = s.wo_id`).Scan(&missing, &changed, &staleOpen)

	detailStatus := readSyncConfigStatus("WorkOrderDetails")
	if detailStatus == nil {
		detailStatus = readSyncConfigStatus("WorkOrders")
	}
	detailWorker.Lock()
	paused := detailWorker.pausedHeaders != ""
	detailWorker.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"list":         readSyncConfigStatus("WorkOrders"),
		"detail":       detailStatus,
		"detailPaused": paused,
		"workersOn":    os.Getenv("DISABLE_WORKERS") != "true",
		"rebuild":      rebuildSnapshot(),
		"queue": map[string]int{
			"missing":   missing,
			"changed":   changed,
			"staleOpen": staleOpen,
		},
	})
}
