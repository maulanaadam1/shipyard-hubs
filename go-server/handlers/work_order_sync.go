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
const summaryListColumns = "wo_id, wo_code, jo_code, project_name, vendor_name, ship_name, status_approval, derived_status, total_cost, created_source_at, updated_source_at, latest_date"

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
		COALESCE(created_source_at, ''), COALESCE(updated_source_at, '') FROM work_order_summary`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var s workOrderSummary
		if rows.Scan(&s.WOID, &s.WOCode, &s.JOCode, &s.ProjectName, &s.VendorName, &s.ShipName, &s.StatusApproval,
			&s.DerivedStatus, &s.TotalCost, &s.CreatedSourceAt, &s.UpdatedSourceAt) == nil {
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
		a.CreatedSourceAt == b.CreatedSourceAt && a.UpdatedSourceAt == b.UpdatedSourceAt
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
			placeholders = append(placeholders, "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
			args = append(args, s.WOID, s.WOCode, s.JOCode, s.ProjectName, s.VendorName, s.ShipName,
				s.StatusApproval, s.DerivedStatus, s.TotalCost, s.CreatedSourceAt, s.UpdatedSourceAt, s.LatestDate)
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
				updated_at = CURRENT_TIMESTAMP`
		if _, err := tx.Exec(db.FormatQuery(query), args...); err != nil {
			return err
		}
	}
	return tx.Commit()
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
// financials. The AI tables are refreshed synchronously when syncETL is set
// (background worker) and in a goroutine otherwise (interactive request).
func storeWorkOrderDetail(woID string, body []byte, syncETL bool) error {
	if _, err := db.Exec(
		"INSERT INTO work_order_details (wo_id, raw_json, last_sync) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(wo_id) DO UPDATE SET raw_json = excluded.raw_json, last_sync = CURRENT_TIMESTAMP",
		woID, string(body),
	); err != nil {
		return err
	}
	if err := upsertSummaryFromDetail(woID, body); err != nil {
		log.Printf("[WO SUMMARY ERROR] %s: %v", woID, err)
	}
	if syncETL {
		if err := workers.ExtractToAITables(woID, body); err != nil {
			log.Printf("[AI ETL ERROR] %s: %v", woID, err)
		}
	} else {
		go workers.ExtractToAITables(woID, body)
	}
	return nil
}

// upsertSummaryFromDetail writes detail-owned columns (financials, latest_date,
// detail_updated_at). List-owned columns are only filled when still empty, so a
// detail never blanks out vendor/status/codes that came from the list.
func upsertSummaryFromDetail(woID string, raw []byte) error {
	s := applyFinancialsFromDetail(workOrderSummary{WOID: woID}, raw)
	detailUpdatedAt := ""
	if data, err := dataObject(raw); err == nil {
		detailUpdatedAt = firstString(data, "updated_at", "last_updated")
	}
	_, err := db.Exec(`
		INSERT INTO work_order_summary (
			wo_id, wo_code, jo_code, project_name, vendor_name, ship_name, status_approval, derived_status,
			latest_date, pending_cost, final_cost, latest_cost, previous_cost, rejected_cost, total_cost,
			created_source_at, updated_source_at, detail_updated_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT(wo_id) DO UPDATE SET
			wo_code = COALESCE(NULLIF(work_order_summary.wo_code, ''), excluded.wo_code),
			jo_code = CASE WHEN COALESCE(work_order_summary.jo_code, '') IN ('', 'N/A') THEN excluded.jo_code ELSE work_order_summary.jo_code END,
			project_name = CASE WHEN COALESCE(work_order_summary.project_name, '') IN ('', 'N/A - N/A') THEN excluded.project_name ELSE work_order_summary.project_name END,
			vendor_name = COALESCE(NULLIF(work_order_summary.vendor_name, ''), excluded.vendor_name),
			ship_name = CASE WHEN COALESCE(work_order_summary.ship_name, '') IN ('', 'N/A') THEN excluded.ship_name ELSE work_order_summary.ship_name END,
			status_approval = COALESCE(NULLIF(excluded.status_approval, ''), work_order_summary.status_approval),
			derived_status = COALESCE(NULLIF(excluded.derived_status, ''), work_order_summary.derived_status),
			latest_date = COALESCE(NULLIF(excluded.latest_date, ''), work_order_summary.latest_date),
			pending_cost = excluded.pending_cost,
			final_cost = excluded.final_cost,
			latest_cost = excluded.latest_cost,
			previous_cost = excluded.previous_cost,
			rejected_cost = excluded.rejected_cost,
			total_cost = CASE WHEN excluded.total_cost > 0 THEN excluded.total_cost ELSE work_order_summary.total_cost END,
			created_source_at = COALESCE(NULLIF(work_order_summary.created_source_at, ''), excluded.created_source_at),
			updated_source_at = COALESCE(NULLIF(excluded.updated_source_at, ''), work_order_summary.updated_source_at),
			detail_updated_at = excluded.detail_updated_at,
			updated_at = CURRENT_TIMESTAMP
	`, s.WOID, s.WOCode, s.JOCode, s.ProjectName, s.VendorName, s.ShipName, s.StatusApproval, s.DerivedStatus,
		s.LatestDate, s.PendingCost, s.FinalCost, s.LatestCost, s.PreviousCost, s.RejectedCost, s.TotalCost,
		s.CreatedSourceAt, s.UpdatedSourceAt, detailUpdatedAt)
	return err
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

// staleOpenClause matches open (not Level 5) WOs whose detail is older than the
// re-check window; the timestamp arithmetic differs per dialect.
func staleOpenClause(hours int) string {
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
//  3. open (not Level 5) WOs not re-checked within WO_OPEN_RESYNC_HOURS, as a
//     safety net.
//
// It pauses on 401/403 until the config headers change (or 30 min pass).
func StartWorkOrderDetailWorker() {
	interval := time.Duration(envInt("WO_DETAIL_INTERVAL_SECONDS", 60)) * time.Second
	go func() {
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
	openHours := envInt("WO_OPEN_RESYNC_HOURS", 72)

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
				err = storeWorkOrderDetail(woID, body, true)
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
	openHours := envInt("WO_OPEN_RESYNC_HOURS", 72)
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
		"queue": map[string]int{
			"missing":   missing,
			"changed":   changed,
			"staleOpen": staleOpen,
		},
	})
}
