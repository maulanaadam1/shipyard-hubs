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
	err := db.DB.QueryRow("SELECT raw_json FROM work_order_details WHERE wo_id = ?", woID).Scan(&rawJson)
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
	err := db.DB.QueryRow("SELECT url, headers FROM sync_configs WHERE id = 'WorkOrderDetails'").Scan(&urlStr, &headersStr)
	if err != nil {
		// Fallback
		err = db.DB.QueryRow("SELECT url, headers FROM sync_configs WHERE id = 'WorkOrders'").Scan(&urlStr, &headersStr)
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
	_, err = db.DB.Exec(
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
	rows, err := db.DB.Query("SELECT wo_id, raw_json FROM work_order_details")
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

		var sum float64
		var sumPending func(items []interface{})
		sumPending = func(items []interface{}) {
			for _, itemRaw := range items {
				item, ok := itemRaw.(map[string]interface{})
				if !ok {
					continue
				}

				approvedLevel := float64(0)
				if val, ok := item["approved_level"].(float64); ok {
					approvedLevel = val
				}

				// Only sum if NOT level 5 approved
				if approvedLevel < 5 {
					if cost, ok := item["volume_cost_final"].(float64); ok {
						sum += cost
					} else if cost, ok := item["total_price"].(float64); ok {
						sum += cost
					}
				}

				if matRaw, ok := item["material"].([]interface{}); ok {
					sumPending(matRaw)
				}
			}
		}

		sumPending(repairList)
		result[woID] = sum
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

type BulkPendingReq struct {
	IDs []string `json:"ids"`
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
	err := db.DB.QueryRow("SELECT url, headers FROM sync_configs WHERE id = 'WorkOrderDetails'").Scan(&urlStr, &headersStr)
	if err != nil {
		db.DB.QueryRow("SELECT url, headers FROM sync_configs WHERE id = 'WorkOrders'").Scan(&urlStr, &headersStr)
	}

	var reqHeaders map[string]string
	if headersStr != "" {
		json.Unmarshal([]byte(headersStr), &reqHeaders)
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	result := make(map[string]float64)

	for _, woID := range reqBody.IDs {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()

			var rawJson []byte
			err := db.DB.QueryRow("SELECT raw_json FROM work_order_details WHERE wo_id = ?", id).Scan(&rawJson)
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

					req, _ := http.NewRequest("GET", fetchUrl, nil)
					for k, v := range reqHeaders {
						req.Header.Set(k, v)
					}
					client := &http.Client{Timeout: 10 * time.Second}
					resp, reqErr := client.Do(req)
					if reqErr == nil {
						defer resp.Body.Close()
						if resp.StatusCode == 200 {
							bodyBytes, _ := io.ReadAll(resp.Body)
							rawJson = bodyBytes
							db.DB.Exec("INSERT INTO work_order_details (wo_id, raw_json, last_sync) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(wo_id) DO UPDATE SET raw_json = excluded.raw_json, last_sync = CURRENT_TIMESTAMP", id, string(bodyBytes))
						}
					}
				}
			}

			if len(rawJson) > 0 {
				var dynamic map[string]interface{}
				if err := json.Unmarshal(rawJson, &dynamic); err == nil {
					var repairList []interface{}
					if dataMap, ok := dynamic["data"].(map[string]interface{}); ok {
						if rl, ok := dataMap["repair_list"].([]interface{}); ok {
							repairList = rl
						}
					} else if rl, ok := dynamic["repair_list"].([]interface{}); ok {
						repairList = rl
					}

					var sum float64
					var sumPending func(items []interface{})
					sumPending = func(items []interface{}) {
						for _, itemRaw := range items {
							item, ok := itemRaw.(map[string]interface{})
							if !ok {
								continue
							}
							approvedLevel := float64(0)
							if val, ok := item["approved_level"].(float64); ok {
								approvedLevel = val
							}
							if approvedLevel < 5 {
								if cost, ok := item["volume_cost_final"].(float64); ok {
									sum += cost
								} else if cost, ok := item["total_price"].(float64); ok {
									sum += cost
								}
							}
							if matRaw, ok := item["material"].([]interface{}); ok {
								sumPending(matRaw)
							}
						}
					}
					sumPending(repairList)
					
					mu.Lock()
					result[id] = sum
					mu.Unlock()
				}
			}
		}(woID)
	}

	wg.Wait()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}
