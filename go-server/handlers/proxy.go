package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
	"strconv"

	"github.com/go-chi/chi/v5"

	"shipyard/db"
)

// GetWorkOrderDetail reads the detail from the local database
func GetWorkOrderDetail(w http.ResponseWriter, r *http.Request) {
	woID := chi.URLParam(r, "id")
	if woID == "" {
		http.Error(w, `{"error": "Missing Work Order ID"}`, http.StatusBadRequest)
		return
	}

	var rawJson string
	err := db.QueryRow("SELECT raw_json FROM work_order_details WHERE wo_id = ?", woID).Scan(&rawJson)
	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, `{"error": "Not synced yet"}`, http.StatusNotFound)
			return
		}
		http.Error(w, `{"error": "Database error"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(rawJson))
}

// SyncWorkOrderDetail fetches from API and saves to database
func SyncWorkOrderDetail(w http.ResponseWriter, r *http.Request) {
	woID := chi.URLParam(r, "id")
	if woID == "" {
		http.Error(w, `{"error": "Missing Work Order ID"}`, http.StatusBadRequest)
		return
	}

	// Try to get WorkOrderDetails config first, fallback to WorkOrders if not found
	var urlStr, headersStr string
	err := db.QueryRow("SELECT url, headers FROM sync_configs WHERE id = 'WorkOrderDetails'").Scan(&urlStr, &headersStr)
	if err != nil {
		// Fallback
		err = db.QueryRow("SELECT url, headers FROM sync_configs WHERE id = 'WorkOrders'").Scan(&urlStr, &headersStr)
		if err != nil {
			http.Error(w, `{"error": "API Config not found"}`, http.StatusInternalServerError)
			return
		}
	}

	// Build the fetch URL. If urlStr contains {{id}}, replace it. Otherwise append it.
	fetchUrl := urlStr
	if strings.Contains(urlStr, "{{id}}") {
		fetchUrl = strings.ReplaceAll(urlStr, "{{id}}", woID)
	} else if strings.Contains(urlStr, "{{WO_ID}}") {
		fetchUrl = strings.ReplaceAll(urlStr, "{{WO_ID}}", woID)
	} else if !strings.HasSuffix(urlStr, woID) {
		fetchUrl = fmt.Sprintf("%s/%s", strings.TrimRight(urlStr, "/"), woID)
	}

	var headers map[string]string
	if headersStr != "" {
		json.Unmarshal([]byte(headersStr), &headers)
	}

	req, err := http.NewRequest("GET", fetchUrl, nil)
	if err != nil {
		http.Error(w, `{"error": "Failed to create request"}`, http.StatusInternalServerError)
		return
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Proxy Error fetching WO %s: %v", woID, err)
		http.Error(w, `{"error": "Failed to fetch from remote API"}`, http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, `{"error": "Failed to read response"}`, http.StatusInternalServerError)
		return
	}

	// Save to Database
	_, err = db.Exec(
		"INSERT INTO work_order_details (wo_id, raw_json, last_sync) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(wo_id) DO UPDATE SET raw_json = excluded.raw_json, last_sync = CURRENT_TIMESTAMP",
		woID, string(bodyBytes),
	)
	if err != nil {
		log.Printf("Database Insert Error: %v", err)
		http.Error(w, `{"error": "Failed to save to database"}`, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(bodyBytes)
}

// GetPendingApprovals iterates over all synced Work Orders locally and calculates the sum
// of items not yet approved at level 5.
func GetPendingApprovals(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT wo_id, raw_json FROM work_order_details")
	if err != nil {
		http.Error(w, `{"error": "Database error"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	result := make(map[string]float64)

	for rows.Next() {
		var woID string
		var rawJson []byte
		if err := rows.Scan(&woID, &rawJson); err != nil {
			continue
		}

		var dynamic map[string]interface{}
		if err := json.Unmarshal(rawJson, &dynamic); err != nil {
			continue
		}

		var repairList []interface{}
		if dataMap, ok := dynamic["data"].(map[string]interface{}); ok {
			if rl, ok := dataMap["repair_list"].([]interface{}); ok {
				repairList = rl
			}
		} else if rl, ok := dynamic["repair_list"].([]interface{}); ok {
			repairList = rl
		}

		if len(repairList) == 0 {
			continue
		}


		var dataObj map[string]interface{}
		if d, ok := dynamic["data"].(map[string]interface{}); ok {
			dataObj = d
		} else {
			dataObj = dynamic
		}

		isGlobalApproved := false
		var rootMinApprovalLevel float64
		if val, ok := dataObj["min_approval_level"].(float64); ok {
			rootMinApprovalLevel = val
		}
		var rootStatusAppr string
		if val, ok := dataObj["status_approval"].(string); ok {
			rootStatusAppr = strings.ToLower(strings.TrimSpace(val))
		}

		// Also check root's approval level
		if rootMinApprovalLevel >= 5 || rootStatusAppr == "approved" || rootStatusAppr == "approved level 5" {
			isGlobalApproved = true
		}

		var sum float64
		if isGlobalApproved {
			sum = 0
		} else {
			var sumPending func(items []interface{})
			sumPending = func(items []interface{}) {
				for _, itemRaw := range items {
					item, ok := itemRaw.(map[string]interface{})
					if !ok {
						continue
					}
	
					matRaw, hasMat := item["material"].([]interface{})
					if hasMat && len(matRaw) > 0 {
						// Parent node, recurse into children
						sumPending(matRaw)
					} else {
						// Leaf node, check approval level and status
						approvedLevel := float64(0)
						if val, ok := item["approved_level"].(float64); ok {
							approvedLevel = val
						}
	
						statusAppr := ""
						if val, ok := item["status_approval"].(string); ok {
							statusAppr = strings.ToLower(strings.TrimSpace(val))
						}
		
						// Only sum if NOT fully approved (level 5 or exact 'approved')
						isRejected := statusAppr == "rejected"
						isAppr5 := !isRejected && (approvedLevel >= 5 || statusAppr == "approved" || statusAppr == "approved level 5")
						
						if !isRejected && !isAppr5 {
							baseCost := parseFloatAny(item["volume_cost_final"])
							if baseCost == 0 {
								baseCost = parseFloatAny(item["price"])
							}
							if baseCost > 0 {
								vol := float64(1)
								if v, hasVol := item["volume"]; hasVol {
									vol = parseFloatAny(v)
								}
								sum += baseCost * vol
							} else {
								tPrice := parseFloatAny(item["total_price"])
								if tPrice > 0 {
									sum += tPrice
								}
							}
						}
					}
				}
			}
			sumPending(repairList)
		}

		result[woID] = sum
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

type BulkPendingReq struct {
	IDs []string `json:"ids"`
}

func parseFloatAny(val interface{}) float64 {
	if val == nil {
		return 0
	}
	switch v := val.(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case int64:
		return float64(v)
	case string:
		if f, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
			return f
		}
	}
	return 0
}

// PostBulkPendingApprovals gets pending approval sum for specific IDs.
// If not in local DB, fetches from API concurrently.
func PostBulkPendingApprovals(w http.ResponseWriter, r *http.Request) {
	var reqBody BulkPendingReq
	if err := json.NewDecoder(r.Body).Decode(&reqBody); err != nil {
		http.Error(w, `{"error": "Invalid request body"}`, http.StatusBadRequest)
		return
	}

	if len(reqBody.IDs) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{}`))
		return
	}

	// 1. Get sync config
	var urlStr, headersStr string
	err := db.QueryRow("SELECT url, headers FROM sync_configs WHERE id = 'WorkOrderDetails'").Scan(&urlStr, &headersStr)
	if err != nil {
		db.QueryRow("SELECT url, headers FROM sync_configs WHERE id = 'WorkOrders'").Scan(&urlStr, &headersStr)
	}

	var reqHeaders map[string]string
	if headersStr != "" {
		json.Unmarshal([]byte(headersStr), &reqHeaders)
	}

	type BulkResult struct {
		Pending      float64  `json:"pending"`
		FinalCost    float64  `json:"final_cost"`
		LatestDate   *string  `json:"latest_date,omitempty"`
		LatestCost   *float64 `json:"latest_cost,omitempty"`
		PreviousCost *float64 `json:"previous_cost,omitempty"`
		RejectedCost float64  `json:"rejected_cost"`
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	result := make(map[string]BulkResult)

	// Semaphore to limit concurrent API requests (max 3 at a time)
	sem := make(chan struct{}, 3)

	for _, woID := range reqBody.IDs {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()

			// Inisialisasi default agar selalu ada balikan
			mu.Lock()
			result[id] = BulkResult{Pending: 0, FinalCost: 0}
			mu.Unlock()

			var rawJson []byte
			err := db.QueryRow("SELECT raw_json FROM work_order_details WHERE wo_id = ?", id).Scan(&rawJson)
			if err != nil {
				if urlStr != "" {
					fetchUrl := urlStr
					if strings.Contains(urlStr, "{{id}}") {
						fetchUrl = strings.ReplaceAll(urlStr, "{{id}}", id)
					} else if strings.Contains(urlStr, "{{WO_ID}}") {
						fetchUrl = strings.ReplaceAll(urlStr, "{{WO_ID}}", id)
					} else if !strings.HasSuffix(urlStr, id) {
						fetchUrl = fmt.Sprintf("%s/%s", strings.TrimRight(urlStr, "/"), id)
					}

					// Acquire semaphore slot
					sem <- struct{}{}
					defer func() { <-sem }()

					client := &http.Client{Timeout: 30 * time.Second}
					
					// Retry up to 2 times
					for attempt := 0; attempt < 2; attempt++ {
						req, reqErr := http.NewRequest("GET", fetchUrl, nil)
						if reqErr != nil {
							break
						}
						for k, v := range reqHeaders {
							req.Header.Set(k, v)
						}
						resp, doErr := client.Do(req)
						if doErr != nil {
							time.Sleep(500 * time.Millisecond)
							continue
						}
						if resp.StatusCode == 200 {
							bodyBytes, _ := io.ReadAll(resp.Body)
							resp.Body.Close()
							rawJson = bodyBytes
							db.Exec("INSERT INTO work_order_details (wo_id, raw_json, last_sync) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(wo_id) DO UPDATE SET raw_json = EXCLUDED.raw_json, last_sync = CURRENT_TIMESTAMP", id, string(bodyBytes))
							db.NormalizeWorkOrder(id, bodyBytes)
							break
						}
						resp.Body.Close()
						break
					}
				}
			}

			if len(rawJson) > 0 {
				var finalCost, pendingCost, rejectedCost float64
				var latestDate sql.NullString
				db.QueryRow("SELECT approved_cost, pending_cost, rejected_cost, latest_date FROM work_order_details WHERE wo_id = ?", id).Scan(&finalCost, &pendingCost, &rejectedCost, &latestDate)

				var ld *string
				if latestDate.Valid && latestDate.String != "" {
					ldStr := latestDate.String
					ld = &ldStr
				}

				mu.Lock()
				result[id] = BulkResult{
					Pending:      pendingCost,
					FinalCost:    finalCost,
					RejectedCost: rejectedCost,
					LatestDate:   ld,
				}
				mu.Unlock()
			}
		}(woID)
	}

	wg.Wait()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}
