package workers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"shipyard/db"
)

type SyncConfig struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	URL          string `json:"url"`
	Headers      string `json:"headers"`
	LastSync     string `json:"last_sync"`
	LastResponse string `json:"last_response"`
	IsActive     bool   `json:"is_active"`
}

func StartSyncWorker() {
	// Check every minute instead of every 5 minutes
	ticker := time.NewTicker(1 * time.Minute)
	go func() {
		for {
			<-ticker.C
			RunSyncJob(false, "")
		}
	}()
	log.Println("Background sync worker started (ticks every 1m)")
}

func RunSyncJob(force bool, targetId string) {
	query := "SELECT id, url, headers, COALESCE(last_sync, ''), COALESCE(interval_type, 'minutes'), COALESCE(interval_value, 5) FROM sync_configs WHERE is_active = true"
	var rows *sql.Rows
	var err error

	if targetId != "" {
		query += " AND id = ?"
		rows, err = db.Query(db.FormatQuery(query), targetId)
	} else {
		rows, err = db.Query(db.FormatQuery(query))
	}

	if err != nil {
		log.Printf("SyncWorker Error reading configs: %v", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id, urlStr, headersStr, lastSyncStr, intervalType string
		var intervalValue int
		if err := rows.Scan(&id, &urlStr, &headersStr, &lastSyncStr, &intervalType, &intervalValue); err != nil {
			continue
		}

		if urlStr == "" {
			continue
		}

		if !force && lastSyncStr != "" {
			lastSync, err := time.Parse("2006-01-02 15:04:05", lastSyncStr)
			if err == nil {
				var nextSync time.Time
				switch intervalType {
				case "hours":
					nextSync = lastSync.Add(time.Duration(intervalValue) * time.Hour)
				case "days":
					nextSync = lastSync.Add(time.Duration(intervalValue) * 24 * time.Hour)
				default:
					nextSync = lastSync.Add(time.Duration(intervalValue) * time.Minute)
				}
				
				if time.Now().Before(nextSync) {
					continue // Not time yet
				}
			}
		}

		var headers map[string]string
		if headersStr != "" {
			json.Unmarshal([]byte(headersStr), &headers)
		}

		req, err := http.NewRequest("GET", urlStr, nil)
		if err != nil {
			continue
		}

		for k, v := range headers {
			req.Header.Set(k, v)
		}

		if id == "JobOrders" {
			processJobOrdersIncremental(id, urlStr, headers, lastSyncStr)
			continue
		} else if id == "Locations" {
			processLocationsIncremental(id, urlStr, headers, lastSyncStr)
			continue
		} else if id == "Services" {
			processServicesIncremental(id, urlStr, headers, lastSyncStr)
			continue
		} else if id == "Employees" {
			processEmployeesIncremental(id, urlStr, headers, lastSyncStr)
			continue
		} else if id == "Vendors" {
			processVendorsIncremental(id, urlStr, headers, lastSyncStr)
			continue
		} else if id == "Companies" {
			processCompaniesIncremental(id, urlStr, headers, lastSyncStr)
			continue
		} else if id == "Ships" {
			processShipsIncremental(id, urlStr, headers, lastSyncStr)
			continue
		} else if id == "ShipTypes" {
			processShipTypesIncremental(id, urlStr, headers, lastSyncStr)
			continue
		} else if id == "MasterComponents" {
			processComponentsIncremental(id, urlStr, headers, lastSyncStr)
			continue
		}

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			log.Printf("SyncWorker HTTP error for %s: %v", urlStr, err)
			continue
		}

		bodyBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err == nil {
			now := time.Now().Format("2006-01-02 15:04:05")
			
			if db.RDB != nil {
				// Store massive JSON in Redis
				cacheKey := "cache:" + id
				db.RDB.Set(db.Ctx, cacheKey, string(bodyBytes), 0)
				
				// Update ONLY last_sync in SQL to prevent bloat
				_, err = db.Exec("UPDATE sync_configs SET last_sync = ? WHERE id = ?", now, id)
			} else {
				// Fallback: save to SQL directly
				_, err = db.Exec("UPDATE sync_configs SET last_sync = ?, last_response = ? WHERE id = ?", now, string(bodyBytes), id)
			}
			
			if err != nil {
				log.Printf("SyncWorker DB error updating %s: %v", id, err)
			} else {
				log.Printf("SyncWorker successfully updated data for: %s", id)
			}
		}
	}
}

func processJobOrdersIncremental(configId, baseUrl string, headers map[string]string, lastSyncStr string) {
	// Drop old 3-column schema if exists to upgrade to flattened 46-column AI-ready table
	db.Exec("DROP TABLE IF EXISTS sync_job_orders")

	_, err := db.Exec(`CREATE TABLE IF NOT EXISTS sync_job_orders (
		id TEXT PRIMARY KEY,
		code TEXT,
		project TEXT,
		approval_status TEXT,
		m_customer_id INTEGER,
		m_customer_name TEXT,
		m_ship_id INTEGER,
		m_ship_name TEXT,
		m_service_id INTEGER,
		m_slipway_id INTEGER,
		m_branch_id INTEGER,
		m_employee_id TEXT,
		agent TEXT,
		est_start TEXT,
		est_finish TEXT,
		est_arrival_date TEXT,
		est_departure_date TEXT,
		est_docking_date TEXT,
		est_undocking_date TEXT,
		est_trial_date TEXT,
		act_start_date TEXT,
		act_finish_date TEXT,
		act_arrival_date TEXT,
		act_departure_date TEXT,
		act_trial_date TEXT,
		docking_date TEXT,
		undocking_date TEXT,
		floating_before_docking TEXT,
		floating_after_docking TEXT,
		floating_before_undocking TEXT,
		floating_after_undocking TEXT,
		total_price TEXT,
		total_price_additional TEXT,
		adjusted_total NUMERIC,
		adjusted_total_additional NUMERIC,
		price_adjustment TEXT,
		price_adjustment_additional TEXT,
		t_quotation_id INTEGER,
		t_quotation_code TEXT,
		t_repair_list_id INTEGER,
		latest_version INTEGER,
		flag_rq BOOLEAN,
		created_at TIMESTAMP,
		created_by INTEGER,
		updated_at TIMESTAMP,
		modified_by INTEGER
	)`)
	if err != nil {
		log.Printf("IncrementalSync DB error: %v", err)
		return
	}

	var lastSync time.Time
	if lastSyncStr != "" {
		lastSync, _ = time.Parse("2006-01-02 15:04:05", lastSyncStr)
	}

	page := 1
	hasMore := true
	client := &http.Client{Timeout: 30 * time.Second}
	
	newestUpdatedAt := lastSync

	for hasMore {
		pageUrl := baseUrl
		if strings.Contains(pageUrl, "?") {
			pageUrl += fmt.Sprintf("&page=%d", page)
		} else {
			pageUrl += fmt.Sprintf("?page=%d", page)
		}

		req, err := http.NewRequest("GET", pageUrl, nil)
		if err != nil {
			break
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}

		resp, err := client.Do(req)
		if err != nil {
			log.Printf("IncrementalSync HTTP error %s: %v", pageUrl, err)
			break
		}

		bodyBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			break
		}

		var payload interface{}
		err = json.Unmarshal(bodyBytes, &payload)
		if err != nil {
			break
		}

		var items []interface{}
		switch v := payload.(type) {
		case []interface{}:
			items = v
		case map[string]interface{}:
			if dataObj, ok := v["data"].([]interface{}); ok {
				items = dataObj
			} else if recordsObj, ok := v["records"].([]interface{}); ok {
				items = recordsObj
			} else if itemsObj, ok := v["items"].([]interface{}); ok {
				items = itemsObj
			} else if dataMap, ok := v["data"].(map[string]interface{}); ok {
				if itemSlice, ok := dataMap["item"].([]interface{}); ok {
					items = itemSlice
				} else if itemsSlice, ok := dataMap["items"].([]interface{}); ok {
					items = itemsSlice
				}
			}
		}

		if len(items) == 0 {
			hasMore = false
			break
		}

		allOlder := true
		tx, err := db.DB.Begin()
		if err != nil {
			break
		}

		stmt, err := tx.Prepare(db.FormatQuery(`INSERT INTO sync_job_orders (
			id, code, project, approval_status, m_customer_id, m_customer_name, m_ship_id, m_ship_name, 
			m_service_id, m_slipway_id, m_branch_id, m_employee_id, agent, est_start, est_finish, 
			est_arrival_date, est_departure_date, est_docking_date, est_undocking_date, est_trial_date, 
			act_start_date, act_finish_date, act_arrival_date, act_departure_date, act_trial_date, 
			docking_date, undocking_date, floating_before_docking, floating_after_docking, 
			floating_before_undocking, floating_after_undocking, total_price, total_price_additional, 
			adjusted_total, adjusted_total_additional, price_adjustment, price_adjustment_additional, 
			t_quotation_id, t_quotation_code, t_repair_list_id, latest_version, flag_rq, 
			created_at, created_by, updated_at, modified_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`))
			
		stmtProjects, errProj := tx.Prepare(db.FormatQuery(`INSERT INTO projects (
			id, id_siaga, idproject, shipname, cust_company, approval_status, 
			est_start, est_finish, est_docking_date, est_undocking_date, 
			est_trial_date, est_arrival_date, est_departure_date, 
			create_date, updated_at, year, status, price_contract, location, docking_type, m_employee_id) 
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET 
				idproject=excluded.idproject,
				shipname=excluded.shipname,
				cust_company=excluded.cust_company,
				approval_status=excluded.approval_status,
				est_start=excluded.est_start,
				est_finish=excluded.est_finish,
				est_docking_date=excluded.est_docking_date,
				est_undocking_date=excluded.est_undocking_date,
				est_trial_date=excluded.est_trial_date,
				est_arrival_date=excluded.est_arrival_date,
				est_departure_date=excluded.est_departure_date,
				updated_at=excluded.updated_at,
				year=excluded.year,
				status=excluded.status,
				price_contract=excluded.price_contract,
				location=excluded.location,
				docking_type=excluded.docking_type,
				m_employee_id=excluded.m_employee_id`))

		if errProj != nil {
			log.Printf("IncrementalSync ERROR preparing projects statement: %v", errProj)
		}

		if err == nil {
			for _, item := range items {
				itemMap, ok := item.(map[string]interface{})
				if !ok {
					continue
				}

				var itemId string
				if val, ok := itemMap["id"]; ok {
					itemId = fmt.Sprintf("%v", val)
				} else if val, ok := itemMap["code"]; ok {
					itemId = fmt.Sprintf("%v", val)
				} else {
					continue 
				}

				itemUpdatedStr := ""
				if val, ok := itemMap["updated_at"].(string); ok {
					itemUpdatedStr = val
				} else if val, ok := itemMap["created_at"].(string); ok {
					itemUpdatedStr = val
				}

				var itemUpdated time.Time
				if itemUpdatedStr != "" {
					t, err := time.Parse("2006-01-02 15:04:05", itemUpdatedStr)
					if err == nil {
						itemUpdated = t
					}
				}

				if itemUpdated.After(newestUpdatedAt) {
					newestUpdatedAt = itemUpdated
				}

				if itemUpdatedStr != "" && !itemUpdated.IsZero() && !lastSync.IsZero() {
					if itemUpdated.After(lastSync) {
						allOlder = false 
					}
				} else {
					allOlder = false 
				}

				// Helper getters
				getStrNull := func(k string) interface{} {
					if v, ok := itemMap[k]; ok && v != nil {
						s := strings.TrimSpace(fmt.Sprintf("%v", v))
						if s != "" && s != "<nil>" { return s }
					}
					return nil
				}
				getInt := func(k string) int {
					if v, ok := itemMap[k].(float64); ok { return int(v) }
					return 0
				}
				getFloat := func(k string) float64 {
					if v, ok := itemMap[k].(float64); ok { return v }
					return 0
				}
				getBool := func(k string) bool {
					if v, ok := itemMap[k].(bool); ok { return v }
					return false
				}

				tx.Exec(db.FormatQuery("DELETE FROM sync_job_orders WHERE id = ?"), itemId)
				if stmt != nil {
					stmt.Exec(
						itemId, getStrNull("code"), getStrNull("project"), getStrNull("approval_status"),
						getInt("m_customer_id"), getStrNull("m_customer_name"), getInt("m_ship_id"), getStrNull("m_ship_name"),
						getInt("m_service_id"), getInt("m_slipway_id"), getInt("m_branch_id"), getStrNull("m_employee_id"), getStrNull("agent"),
						getStrNull("est_start"), getStrNull("est_finish"), getStrNull("est_arrival_date"), getStrNull("est_departure_date"),
						getStrNull("est_docking_date"), getStrNull("est_undocking_date"), getStrNull("est_trial_date"),
						getStrNull("act_start_date"), getStrNull("act_finish_date"), getStrNull("act_arrival_date"), getStrNull("act_departure_date"), getStrNull("act_trial_date"),
						getStrNull("docking_date"), getStrNull("undocking_date"), getStrNull("floating_before_docking"), getStrNull("floating_after_docking"),
						getStrNull("floating_before_undocking"), getStrNull("floating_after_undocking"), getStrNull("total_price"), getStrNull("total_price_additional"),
						getFloat("adjusted_total"), getFloat("adjusted_total_additional"), getStrNull("price_adjustment"), getStrNull("price_adjustment_additional"),
						getInt("t_quotation_id"), getStrNull("t_quotation_code"), getInt("t_repair_list_id"), getInt("latest_version"), getBool("flag_rq"),
						getStrNull("created_at"), getInt("created_by"), getStrNull("updated_at"), getInt("modified_by"),
					)
				}

				// Map to Projects table
				if errProj == nil && stmtProjects != nil {
					idStr := fmt.Sprintf("JO-%v", itemId)
					
					id_siaga := 0
					if val, ok := itemMap["id"].(float64); ok {
						id_siaga = int(val)
					}

					idproject := ""
					if val, ok := itemMap["code"].(string); ok {
						idproject = val
					}

					// Jangan masukkan Work Order ke tabel Master Projects (Job Orders)
					if strings.HasPrefix(strings.ToUpper(strings.TrimSpace(idproject)), "WO") {
						continue
					}

					shipname := ""
					if val, ok := itemMap["m_ship_name"].(string); ok {
						shipname = val
					}

					cust_company := ""
					if val, ok := itemMap["m_customer_name"].(string); ok {
						cust_company = val
					}

					approval_status := ""
					if val, ok := itemMap["approval_status"].(string); ok {
						approval_status = val
					}

					getString := func(key string) string {
						if val, ok := itemMap[key].(string); ok {
							return val
						}
						return ""
					}

					est_start := getString("est_start")
					est_finish := getString("est_finish")
					est_docking_date := getString("est_docking_date")
					est_undocking_date := getString("est_undocking_date")
					est_trial_date := getString("est_trial_date")
					est_arrival_date := getString("est_arrival_date")
					est_departure_date := getString("est_departure_date")
					create_date := getString("created_at")

					year := time.Now().Year()
					if len(create_date) >= 4 {
						fmt.Sscanf(create_date[:4], "%d", &year)
					} else if len(est_start) >= 4 {
						fmt.Sscanf(est_start[:4], "%d", &year)
					}

					status := "Active"
					if approval_status == "approved" {
						status = "Active"
					} else if approval_status == "completed" || approval_status == "done" {
						status = "Completed"
					}

					price_contract := 0.0
					if valStr, ok := itemMap["total_price"].(string); ok {
						fmt.Sscanf(valStr, "%f", &price_contract)
					} else if valFloat, ok := itemMap["total_price"].(float64); ok {
						price_contract = valFloat
					}

					location := ""
					if valStr, ok := itemMap["m_slipway_id"].(string); ok {
						location = valStr
					} else if valFloat, ok := itemMap["m_slipway_id"].(float64); ok {
						location = fmt.Sprintf("%.0f", valFloat)
					}

					docking_type := ""
					if valStr, ok := itemMap["m_service_id"].(string); ok {
						docking_type = valStr
					} else if valFloat, ok := itemMap["m_service_id"].(float64); ok {
						docking_type = fmt.Sprintf("%.0f", valFloat)
					}

					m_employee_id := ""
					if valStr, ok := itemMap["m_employee_id"].(string); ok {
						m_employee_id = valStr
					} else if valFloat, ok := itemMap["m_employee_id"].(float64); ok {
						m_employee_id = fmt.Sprintf("%.0f", valFloat)
					}

					stmtProjects.Exec(
						idStr, id_siaga, idproject, shipname, cust_company, approval_status,
						est_start, est_finish, est_docking_date, est_undocking_date,
						est_trial_date, est_arrival_date, est_departure_date,
						create_date, itemUpdatedStr, year, status, price_contract, location, docking_type, m_employee_id,
					)
				}
			}
			stmt.Close()
			if stmtProjects != nil {
				stmtProjects.Close()
			}
		}
		tx.Commit()

		if lastSync.IsZero() {
			allOlder = false
		}

		if allOlder {
			log.Printf("IncrementalSync hit old data at page %d. Stopping.", page)
			hasMore = false
			break
		}

		if page >= 50 {
			log.Printf("IncrementalSync reached max pages safeguard (50). Stopping.")
			hasMore = false
			break
		}

		if !newestUpdatedAt.IsZero() {
			now := time.Now().Format("2006-01-02 15:04:05")
			db.Exec("UPDATE sync_configs SET last_sync = ? WHERE id = ?", now, configId)
		}

		page++
	}

	now := time.Now().Format("2006-01-02 15:04:05")
	db.Exec("UPDATE sync_configs SET last_sync = ?, last_response = ? WHERE id = ?", now, `{"status": "Incremental Sync Active", "tables": "sync_job_orders"}`, configId)
	log.Printf("IncrementalSync finished for %s. Pages processed: %d", configId, page-1)
}

func processLocationsIncremental(configId, baseUrl string, headers map[string]string, lastSyncStr string) {
	var lastSync time.Time
	if lastSyncStr != "" {
		lastSync, _ = time.Parse("2006-01-02 15:04:05", lastSyncStr)
	}

	page := 1
	hasMore := true
	client := &http.Client{Timeout: 30 * time.Second}
	var newestUpdatedAt time.Time

	for hasMore {
		url := baseUrl
		if strings.Contains(url, "?") {
			url = fmt.Sprintf("%s&page=%d", url, page)
		} else {
			url = fmt.Sprintf("%s?page=%d", url, page)
		}

		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			break
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}

		resp, err := client.Do(req)
		if err != nil {
			break
		}

		bodyBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			break
		}

		var payload map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &payload); err != nil {
			var payloadArray []interface{}
			if err2 := json.Unmarshal(bodyBytes, &payloadArray); err2 == nil {
				payload = map[string]interface{}{
					"data": payloadArray,
				}
			} else {
				break
			}
		}

		var items []interface{}
		if data, ok := payload["data"].([]interface{}); ok {
			items = data
		} else if records, ok := payload["records"].([]interface{}); ok {
			items = records
		} else {
			hasMore = false
			break
		}

		if len(items) == 0 {
			hasMore = false
			break
		}

		allOlder := true
		tx, err := db.DB.Begin()
		if err != nil {
			break
		}

		stmt, err := tx.Prepare(`INSERT INTO master_locations (id, name, size, description, status) VALUES (?, ?, ?, ?, ?) 
			ON CONFLICT(id) DO UPDATE SET name=excluded.name, size=excluded.size, description=excluded.description, status=excluded.status`)

		if err == nil {
			for _, item := range items {
				itemMap, ok := item.(map[string]interface{})
				if !ok {
					continue
				}

				var itemId string
				if val, ok := itemMap["id"]; ok {
					itemId = fmt.Sprintf("%v", val)
				} else {
					continue 
				}

				itemUpdatedStr := ""
				if val, ok := itemMap["updated_at"].(string); ok {
					itemUpdatedStr = val
				} else if val, ok := itemMap["created_at"].(string); ok {
					itemUpdatedStr = val
				}

				var itemUpdated time.Time
				if itemUpdatedStr != "" {
					t, err := time.Parse("2006-01-02 15:04:05", itemUpdatedStr)
					if err == nil {
						itemUpdated = t
					}
				}

				if itemUpdated.After(newestUpdatedAt) {
					newestUpdatedAt = itemUpdated
				}

				if itemUpdatedStr != "" && !itemUpdated.IsZero() && !lastSync.IsZero() {
					if itemUpdated.After(lastSync) {
						allOlder = false 
					}
				} else {
					allOlder = false 
				}

				name := ""
				if val, ok := itemMap["name"].(string); ok {
					name = val
				}
				
				length := "0"
				if val, ok := itemMap["length"].(string); ok {
					length = val
				} else if val, ok := itemMap["length"].(float64); ok {
					length = fmt.Sprintf("%v", val)
				}

				width := "0"
				if val, ok := itemMap["width"].(string); ok {
					width = val
				} else if val, ok := itemMap["width"].(float64); ok {
					width = fmt.Sprintf("%v", val)
				}
				
				size := fmt.Sprintf("%s x %s", length, width)
				
				desc := ""
				if slipwayType, ok := itemMap["m_slipway_type"].(map[string]interface{}); ok {
					if typeName, ok2 := slipwayType["name"].(string); ok2 {
						desc = typeName
					}
				}

				status := "Active"

				stmt.Exec(itemId, name, size, desc, status)
			}
			stmt.Close()
		}
		tx.Commit()

		if allOlder {
			log.Printf("LocationsSync hit old data at page %d. Stopping.", page)
			hasMore = false
			break
		}
		page++
	}

	if !newestUpdatedAt.IsZero() {
		now := time.Now().Format("2006-01-02 15:04:05")
		db.Exec("UPDATE sync_configs SET last_sync = ? WHERE id = ?", now, configId)
	}
}

func processServicesIncremental(configId, baseUrl string, headers map[string]string, lastSyncStr string) {
	var lastSync time.Time
	if lastSyncStr != "" {
		lastSync, _ = time.Parse("2006-01-02 15:04:05", lastSyncStr)
	}

	page := 1
	hasMore := true
	client := &http.Client{Timeout: 30 * time.Second}
	var newestUpdatedAt time.Time

	for hasMore {
		url := baseUrl
		if strings.Contains(url, "?") {
			url = fmt.Sprintf("%s&page=%d", url, page)
		} else {
			url = fmt.Sprintf("%s?page=%d", url, page)
		}

		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			break
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}

		resp, err := client.Do(req)
		if err != nil {
			break
		}

		bodyBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			break
		}

		var payload map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &payload); err != nil {
			var payloadArray []interface{}
			if err2 := json.Unmarshal(bodyBytes, &payloadArray); err2 == nil {
				payload = map[string]interface{}{
					"data": payloadArray,
				}
			} else {
				break
			}
		}

		var items []interface{}
		if data, ok := payload["data"].([]interface{}); ok {
			items = data
		} else if records, ok := payload["records"].([]interface{}); ok {
			items = records
		} else if rawArray, ok := payload["data"].([]interface{}); ok {
			items = rawArray
		} else {
			// Maybe the payload ITSELF is the array!
			// Check if we manually mapped it in the Unmarshal step earlier.
			if data, ok := payload["data"].([]interface{}); ok {
				items = data
			}
		}

		log.Printf("ServicesSync page %d: found %d items", page, len(items))

		if len(items) == 0 {
			hasMore = false
			break
		}

		allOlder := true
		tx, err := db.DB.Begin()
		if err != nil {
			log.Printf("ServicesSync error starting tx: %v", err)
			break
		}

		stmt, err := tx.Prepare(`INSERT INTO master_services (id, code, name, status) VALUES (?, ?, ?, ?) 
			ON CONFLICT(id) DO UPDATE SET code=excluded.code, name=excluded.name, status=excluded.status`)

		if err != nil {
			log.Printf("ServicesSync error preparing statement: %v", err)
		} else {
			for _, item := range items {
				itemMap, ok := item.(map[string]interface{})
				if !ok {
					continue
				}

				var itemId string
				if val, ok := itemMap["id"]; ok {
					itemId = fmt.Sprintf("%v", val)
				} else {
					continue 
				}

				itemUpdatedStr := ""
				if val, ok := itemMap["updated_at"].(string); ok {
					itemUpdatedStr = val
				} else if val, ok := itemMap["created_at"].(string); ok {
					itemUpdatedStr = val
				}

				var itemUpdated time.Time
				if itemUpdatedStr != "" {
					t, err := time.Parse("2006-01-02 15:04:05", itemUpdatedStr)
					if err == nil {
						itemUpdated = t
					}
				}

				if itemUpdated.After(newestUpdatedAt) {
					newestUpdatedAt = itemUpdated
				}

				if itemUpdatedStr != "" && !itemUpdated.IsZero() && !lastSync.IsZero() {
					if itemUpdated.After(lastSync) {
						allOlder = false 
					}
				} else {
					allOlder = false 
				}

				code := ""
				if val, ok := itemMap["code"].(string); ok {
					code = val
				}
				
				name := ""
				if val, ok := itemMap["name"].(string); ok {
					name = val
				}

				status := "Active"

				stmt.Exec(itemId, code, name, status)
			}
			stmt.Close()
		}
		tx.Commit()

		if allOlder {
			log.Printf("ServicesSync hit old data at page %d. Stopping.", page)
			hasMore = false
			break
		}
		page++
	}

	if !newestUpdatedAt.IsZero() {
		now := time.Now().Format("2006-01-02 15:04:05")
		db.Exec("UPDATE sync_configs SET last_sync = ? WHERE id = ?", now, configId)
	}
}

func processEmployeesIncremental(configId, baseUrl string, headers map[string]string, lastSyncStr string) {
	var lastSync time.Time
	if lastSyncStr != "" {
		lastSync, _ = time.Parse("2006-01-02 15:04:05", lastSyncStr)
	}

	page := 1
	hasMore := true
	client := &http.Client{Timeout: 30 * time.Second}
	newestUpdatedAt := lastSync

	for hasMore {
		pageUrl := baseUrl
		if strings.Contains(pageUrl, "?") {
			pageUrl += fmt.Sprintf("&page=%d", page)
		} else {
			pageUrl += fmt.Sprintf("?page=%d", page)
		}

		req, err := http.NewRequest("GET", pageUrl, nil)
		if err != nil {
			break
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}

		resp, err := client.Do(req)
		if err != nil {
			log.Printf("EmployeesSync HTTP error %s: %v", pageUrl, err)
			break
		}

		bodyBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			break
		}

		var payload map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &payload); err != nil {
			var payloadArray []interface{}
			if err2 := json.Unmarshal(bodyBytes, &payloadArray); err2 == nil {
				payload = map[string]interface{}{
					"data": payloadArray,
				}
			} else {
				break
			}
		}

		var items []interface{}
		if data, ok := payload["data"].([]interface{}); ok {
			items = data
		} else if records, ok := payload["records"].([]interface{}); ok {
			items = records
		} else if rawArray, ok := payload["data"].([]interface{}); ok {
			items = rawArray
		} else {
			if data, ok := payload["data"].([]interface{}); ok {
				items = data
			}
		}

		log.Printf("EmployeesSync page %d: found %d items", page, len(items))

		if len(items) == 0 {
			hasMore = false
			break
		}

		allOlder := true
		tx, err := db.DB.Begin()
		if err != nil {
			log.Printf("EmployeesSync error starting tx: %v", err)
			break
		}

		stmt, err := tx.Prepare(`INSERT INTO master_employees 
			(id, code, name, address, email, phone, mobile_phone, is_active, position, m_branch_id, m_department_id, m_city_id, type) 
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
			ON CONFLICT(id) DO UPDATE SET 
				code=excluded.code, name=excluded.name, address=excluded.address, 
				email=excluded.email, phone=excluded.phone, mobile_phone=excluded.mobile_phone, 
				is_active=excluded.is_active, position=excluded.position, m_branch_id=excluded.m_branch_id, 
				m_department_id=excluded.m_department_id, m_city_id=excluded.m_city_id, type=excluded.type`)

		if err != nil {
			log.Printf("EmployeesSync error preparing statement: %v", err)
		} else {
			for _, item := range items {
				itemMap, ok := item.(map[string]interface{})
				if !ok {
					continue
				}

				var itemId string
				if val, ok := itemMap["id"]; ok {
					itemId = fmt.Sprintf("%v", val)
				} else {
					continue 
				}

				itemUpdatedStr := ""
				if val, ok := itemMap["updated_at"].(string); ok {
					itemUpdatedStr = val
				} else if val, ok := itemMap["created_at"].(string); ok {
					itemUpdatedStr = val
				}

				var itemUpdated time.Time
				if itemUpdatedStr != "" {
					t, err := time.Parse("2006-01-02 15:04:05", itemUpdatedStr)
					if err == nil {
						itemUpdated = t
					}
				}

				if itemUpdated.After(newestUpdatedAt) {
					newestUpdatedAt = itemUpdated
				}

				if itemUpdatedStr != "" && !itemUpdated.IsZero() && !lastSync.IsZero() {
					if itemUpdated.After(lastSync) {
						allOlder = false 
					}
				} else {
					allOlder = false 
				}

				getString := func(key string) string {
					if val, ok := itemMap[key]; ok && val != nil {
						str := fmt.Sprintf("%v", val)
						return strings.TrimSpace(str)
					}
					return ""
				}

				getInt := func(key string) int {
					if val, ok := itemMap[key].(float64); ok {
						return int(val)
					} else if valStr, ok := itemMap[key].(string); ok {
						var parsed int
						fmt.Sscanf(valStr, "%d", &parsed)
						return parsed
					}
					return 0
				}

				code := getString("code")
				name := getString("name")
				address := getString("address")
				email := getString("email")
				phone := getString("phone")
				mobilePhone := getString("mobile_phone")
				isActive := getString("is_active")
				position := getString("position")
				branchId := getInt("m_branch_id")
				deptId := getInt("m_department_id")
				cityId := getInt("m_city_id")
				empType := getString("type")

				stmt.Exec(itemId, code, name, address, email, phone, mobilePhone, isActive, position, branchId, deptId, cityId, empType)
			}
			stmt.Close()
		}
		tx.Commit()

		if lastSync.IsZero() {
			allOlder = false
		}

		if allOlder {
			log.Printf("EmployeesSync hit old data at page %d. Stopping.", page)
			hasMore = false
			break
		}

		if page >= 50 {
			log.Printf("EmployeesSync reached max pages safeguard (50). Stopping.")
			hasMore = false
			break
		}

		page++
	}

	if !newestUpdatedAt.IsZero() {
		nowStr := time.Now().Format("2006-01-02 15:04:05")
		db.Exec("UPDATE sync_configs SET last_sync = ? WHERE id = ?", nowStr, configId)
	}
}

func processVendorsIncremental(configId, baseUrl string, headers map[string]string, lastSyncStr string) {
	var lastSync time.Time
	if lastSyncStr != "" {
		lastSync, _ = time.Parse("2006-01-02 15:04:05", lastSyncStr)
	}

	page := 1
	hasMore := true
	client := &http.Client{Timeout: 30 * time.Second}
	var newestUpdatedAt time.Time

	for hasMore {
		url := baseUrl
		if strings.Contains(url, "?") {
			url = fmt.Sprintf("%s&page=%d", url, page)
		} else {
			url = fmt.Sprintf("%s?page=%d", url, page)
		}

		req, err := http.NewRequest("GET", url, nil)
		if err != nil { break }
		for k, v := range headers { req.Header.Set(k, v) }

		resp, err := client.Do(req)
		if err != nil { break }

		bodyBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil { break }

		var payload map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &payload); err != nil {
			var payloadArray []interface{}
			if err2 := json.Unmarshal(bodyBytes, &payloadArray); err2 == nil {
				payload = map[string]interface{}{"data": payloadArray}
			} else { break }
		}

		var items []interface{}
		if data, ok := payload["data"].([]interface{}); ok {
			items = data
		} else if records, ok := payload["records"].([]interface{}); ok {
			items = records
		} else {
			hasMore = false
			break
		}

		if len(items) == 0 {
			hasMore = false
			break
		}

		allOlder := true
		tx, err := db.DB.Begin()
		if err != nil { break }

		stmt, err := tx.Prepare(`INSERT INTO vendors (id, vendor, nama_pt, whatapps, category, jumlah_anggota, status) 
			VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET 
			vendor=excluded.vendor, nama_pt=excluded.nama_pt, whatapps=excluded.whatapps, 
			category=excluded.category, jumlah_anggota=excluded.jumlah_anggota, status=excluded.status`)

		if err == nil {
			for _, item := range items {
				itemMap, ok := item.(map[string]interface{})
				if !ok { continue }

				var itemId string
				if val, ok := itemMap["id"]; ok {
					itemId = fmt.Sprintf("%v", val)
				} else { continue }

				itemUpdatedStr := ""
				if val, ok := itemMap["updated_at"].(string); ok {
					itemUpdatedStr = val
				} else if val, ok := itemMap["created_at"].(string); ok {
					itemUpdatedStr = val
				}

				var itemUpdated time.Time
				if itemUpdatedStr != "" {
					t, err := time.Parse("2006-01-02 15:04:05", itemUpdatedStr)
					if err == nil { itemUpdated = t }
				}

				if itemUpdated.After(newestUpdatedAt) { newestUpdatedAt = itemUpdated }

				if itemUpdatedStr != "" && !itemUpdated.IsZero() && !lastSync.IsZero() {
					if itemUpdated.After(lastSync) { allOlder = false }
				} else { allOlder = false }

				getString := func(k string) string {
					if v, ok := itemMap[k]; ok && v != nil {
						return strings.TrimSpace(fmt.Sprintf("%v", v))
					}
					return ""
				}

				vendor := getString("name")
				if vendor == "" { vendor = getString("vendor_name") }
				nama_pt := getString("company_name")
				if nama_pt == "" { nama_pt = getString("nama_pt") }
				whatapps := getString("phone")
				if whatapps == "" { whatapps = getString("whatsapp") }
				if whatapps == "" { whatapps = getString("whatapps") }
				category := getString("category")
				
				jumlah := 0
				if val, ok := itemMap["jumlah_anggota"].(float64); ok {
					jumlah = int(val)
				}

				status := "Active"

				stmt.Exec(itemId, vendor, nama_pt, whatapps, category, jumlah, status)
			}
			stmt.Close()
		}
		tx.Commit()

		if allOlder { hasMore = false; break }
		page++
	}

	if !newestUpdatedAt.IsZero() {
		now := time.Now().Format("2006-01-02 15:04:05")
		db.Exec("UPDATE sync_configs SET last_sync = ? WHERE id = ?", now, configId)
	}
}

func processCompaniesIncremental(configId, baseUrl string, headers map[string]string, lastSyncStr string) {
	var lastSync time.Time
	if lastSyncStr != "" { lastSync, _ = time.Parse("2006-01-02 15:04:05", lastSyncStr) }

	page := 1
	hasMore := true
	client := &http.Client{Timeout: 30 * time.Second}
	var newestUpdatedAt time.Time

	for hasMore {
		url := baseUrl
		if strings.Contains(url, "?") {
			url = fmt.Sprintf("%s&page=%d", url, page)
		} else {
			url = fmt.Sprintf("%s?page=%d", url, page)
		}

		req, err := http.NewRequest("GET", url, nil)
		if err != nil { break }
		for k, v := range headers { req.Header.Set(k, v) }

		resp, err := client.Do(req)
		if err != nil { break }

		bodyBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil { break }

		var payload map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &payload); err != nil {
			var payloadArray []interface{}
			if err2 := json.Unmarshal(bodyBytes, &payloadArray); err2 == nil {
				payload = map[string]interface{}{"data": payloadArray}
			} else { break }
		}

		var items []interface{}
		if data, ok := payload["data"].([]interface{}); ok {
			items = data
		} else if records, ok := payload["records"].([]interface{}); ok {
			items = records
		} else {
			hasMore = false; break
		}

		if len(items) == 0 { hasMore = false; break }

		allOlder := true
		tx, err := db.DB.Begin()
		if err != nil { break }

		stmt, err := tx.Prepare(`INSERT INTO companies (id, company_type, company_name, status) 
			VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET 
			company_type=excluded.company_type, company_name=excluded.company_name, status=excluded.status`)

		if err == nil {
			for _, item := range items {
				itemMap, ok := item.(map[string]interface{})
				if !ok { continue }

				var itemId string
				if val, ok := itemMap["id"]; ok {
					itemId = fmt.Sprintf("%v", val)
				} else { continue }

				itemUpdatedStr := ""
				if val, ok := itemMap["updated_at"].(string); ok {
					itemUpdatedStr = val
				} else if val, ok := itemMap["created_at"].(string); ok {
					itemUpdatedStr = val
				}

				var itemUpdated time.Time
				if itemUpdatedStr != "" {
					t, err := time.Parse("2006-01-02 15:04:05", itemUpdatedStr)
					if err == nil { itemUpdated = t }
				}

				if itemUpdated.After(newestUpdatedAt) { newestUpdatedAt = itemUpdated }
				if itemUpdatedStr != "" && !itemUpdated.IsZero() && !lastSync.IsZero() {
					if itemUpdated.After(lastSync) { allOlder = false }
				} else { allOlder = false }

				getString := func(k string) string {
					if v, ok := itemMap[k]; ok && v != nil {
						return strings.TrimSpace(fmt.Sprintf("%v", v))
					}
					return ""
				}

				cType := getString("type")
				if cType == "" { cType = getString("company_type") }
				cName := getString("name")
				if cName == "" { cName = getString("company_name") }
				status := "Active"

				stmt.Exec(itemId, cType, cName, status)
			}
			stmt.Close()
		}
		tx.Commit()

		if allOlder { hasMore = false; break }
		page++
	}

	if !newestUpdatedAt.IsZero() {
		now := time.Now().Format("2006-01-02 15:04:05")
		db.Exec("UPDATE sync_configs SET last_sync = ? WHERE id = ?", now, configId)
	}
}

func processShipsIncremental(configId, baseUrl string, headers map[string]string, lastSyncStr string) {
	var lastSync time.Time
	if lastSyncStr != "" { lastSync, _ = time.Parse("2006-01-02 15:04:05", lastSyncStr) }

	page := 1
	hasMore := true
	client := &http.Client{Timeout: 30 * time.Second}
	var newestUpdatedAt time.Time

	for hasMore {
		url := baseUrl
		if strings.Contains(url, "?") {
			url = fmt.Sprintf("%s&page=%d", url, page)
		} else {
			url = fmt.Sprintf("%s?page=%d", url, page)
		}

		req, err := http.NewRequest("GET", url, nil)
		if err != nil { break }
		for k, v := range headers { req.Header.Set(k, v) }

		resp, err := client.Do(req)
		if err != nil { break }

		bodyBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil { break }

		var payload map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &payload); err != nil {
			var payloadArray []interface{}
			if err2 := json.Unmarshal(bodyBytes, &payloadArray); err2 == nil {
				payload = map[string]interface{}{"data": payloadArray}
			} else { break }
		}

		var items []interface{}
		if data, ok := payload["data"].([]interface{}); ok {
			items = data
		} else if records, ok := payload["records"].([]interface{}); ok {
			items = records
		} else {
			hasMore = false; break
		}

		if len(items) == 0 { hasMore = false; break }

		allOlder := true
		tx, err := db.DB.Begin()
		if err != nil { break }

		stmt, err := tx.Prepare(`INSERT INTO ships (id, type, shipname, company, loa, breadth, depth, draft, gt, buid) 
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET 
			type=excluded.type, shipname=excluded.shipname, company=excluded.company, loa=excluded.loa, 
			breadth=excluded.breadth, depth=excluded.depth, draft=excluded.draft, gt=excluded.gt, buid=excluded.buid`)

		if err == nil {
			for _, item := range items {
				itemMap, ok := item.(map[string]interface{})
				if !ok { continue }

				var itemId string
				if val, ok := itemMap["id"]; ok {
					itemId = fmt.Sprintf("%v", val)
				} else { continue }

				itemUpdatedStr := ""
				if val, ok := itemMap["updated_at"].(string); ok {
					itemUpdatedStr = val
				} else if val, ok := itemMap["created_at"].(string); ok {
					itemUpdatedStr = val
				}

				var itemUpdated time.Time
				if itemUpdatedStr != "" {
					t, err := time.Parse("2006-01-02 15:04:05", itemUpdatedStr)
					if err == nil { itemUpdated = t }
				}

				if itemUpdated.After(newestUpdatedAt) { newestUpdatedAt = itemUpdated }
				if itemUpdatedStr != "" && !itemUpdated.IsZero() && !lastSync.IsZero() {
					if itemUpdated.After(lastSync) { allOlder = false }
				} else { allOlder = false }

				getString := func(k string) string {
					if v, ok := itemMap[k]; ok && v != nil {
						return strings.TrimSpace(fmt.Sprintf("%v", v))
					}
					return ""
				}

				getFloat := func(k string) float64 {
					if v, ok := itemMap[k].(float64); ok {
						return v
					} else if vStr, ok := itemMap[k].(string); ok {
						var f float64
						fmt.Sscanf(vStr, "%f", &f)
						return f
					}
					return 0
				}

				sType := getString("type")
				
				if typeId, ok := itemMap["m_ship_type_id"]; ok && typeId != nil {
					sType = fmt.Sprintf("st_%v", typeId)
				} else if typeObj, ok := itemMap["m_ship_type"].(map[string]interface{}); ok {
					if tId, ok := typeObj["id"]; ok && tId != nil {
						sType = fmt.Sprintf("st_%v", tId)
					}
				}

				sName := getString("name")
				if sName == "" { sName = getString("shipname") }
				
				company := getString("company_name")
				if company == "" { company = getString("company") }
				if company == "" { 
					if compObj, ok := itemMap["m_customer"].(map[string]interface{}); ok {
						if cName, ok := compObj["name"].(string); ok { company = cName }
					}
				}

				loa := getFloat("loa")
				breadth := getFloat("breadth")
				depth := getFloat("depth")
				draft := getFloat("draft")
				gt := getFloat("gt")
				buid := getString("buid")

				stmt.Exec(itemId, sType, sName, company, loa, breadth, depth, draft, gt, buid)
			}
			stmt.Close()
		}
		tx.Commit()

		if allOlder { hasMore = false; break }
		page++
	}

	if !newestUpdatedAt.IsZero() {
		now := time.Now().Format("2006-01-02 15:04:05")
		db.Exec("UPDATE sync_configs SET last_sync = ? WHERE id = ?", now, configId)
	}
}

func processShipTypesIncremental(configId, baseUrl string, headers map[string]string, lastSyncStr string) {
	var lastSync time.Time
	if lastSyncStr != "" { lastSync, _ = time.Parse("2006-01-02 15:04:05", lastSyncStr) }

	page := 1
	hasMore := true
	client := &http.Client{Timeout: 30 * time.Second}
	var newestUpdatedAt time.Time

	for hasMore {
		url := baseUrl
		if strings.Contains(url, "?") {
			url = fmt.Sprintf("%s&page=%d", url, page)
		} else {
			url = fmt.Sprintf("%s?page=%d", url, page)
		}

		req, err := http.NewRequest("GET", url, nil)
		if err != nil { break }
		for k, v := range headers { req.Header.Set(k, v) }

		resp, err := client.Do(req)
		if err != nil { break }

		bodyBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil { break }

		var payload map[string]interface{}
		if err := json.Unmarshal(bodyBytes, &payload); err != nil {
			var payloadArray []interface{}
			if err2 := json.Unmarshal(bodyBytes, &payloadArray); err2 == nil {
				payload = map[string]interface{}{"data": payloadArray}
			} else { break }
		}

		var items []interface{}
		if data, ok := payload["data"].([]interface{}); ok {
			items = data
		} else if records, ok := payload["records"].([]interface{}); ok {
			items = records
		} else {
			hasMore = false; break
		}

		if len(items) == 0 { hasMore = false; break }

		allOlder := true
		tx, err := db.DB.Begin()
		if err != nil { break }

		stmt, err := tx.Prepare(`INSERT INTO dropdown_configs (id, category, label, value, is_active) 
			VALUES (?, 'ship_types', ?, ?, 1) ON CONFLICT(id) DO UPDATE SET 
			label=excluded.label, value=excluded.value`)

		if err == nil {
			for _, item := range items {
				itemMap, ok := item.(map[string]interface{})
				if !ok { continue }

				var itemId string
				if val, ok := itemMap["id"]; ok {
					itemId = fmt.Sprintf("%v", val)
				} else { continue }

				itemUpdatedStr := ""
				if val, ok := itemMap["updated_at"].(string); ok {
					itemUpdatedStr = val
				} else if val, ok := itemMap["created_at"].(string); ok {
					itemUpdatedStr = val
				}

				var itemUpdated time.Time
				if itemUpdatedStr != "" {
					t, err := time.Parse("2006-01-02 15:04:05", itemUpdatedStr)
					if err == nil { itemUpdated = t }
				}

				if itemUpdated.After(newestUpdatedAt) { newestUpdatedAt = itemUpdated }
				if itemUpdatedStr != "" && !itemUpdated.IsZero() && !lastSync.IsZero() {
					if itemUpdated.After(lastSync) { allOlder = false }
				} else { allOlder = false }

				getString := func(k string) string {
					if v, ok := itemMap[k]; ok && v != nil {
						return strings.TrimSpace(fmt.Sprintf("%v", v))
					}
					return ""
				}

				code := getString("code")
				name := getString("name")
				if name == "" { name = getString("type_name") }
				if name == "" { name = getString("ship_type") }
				
				if code == "" { code = name } // Fallback

				if name != "" {
					safeId := fmt.Sprintf("st_%s", itemId)
					stmt.Exec(safeId, name, code)
				}
			}
			stmt.Close()
		}
		tx.Commit()

		if allOlder { hasMore = false; break }
		page++
	}

	if !newestUpdatedAt.IsZero() {
		now := time.Now().Format("2006-01-02 15:04:05")
		db.Exec("UPDATE sync_configs SET last_sync = ? WHERE id = ?", now, configId)
	}
}

func processComponentsIncremental(configId string, apiUrl string, headers map[string]string, lastSyncStr string) {
	var lastSync time.Time
	if lastSyncStr != "" {
		t, err := time.Parse("2006-01-02 15:04:05", lastSyncStr)
		if err == nil {
			lastSync = t
		}
	}

	page := 1
	hasMore := true
	var newestUpdatedAt time.Time

	for hasMore {
		pagedUrl := apiUrl
		if strings.Contains(pagedUrl, "?") {
			pagedUrl = fmt.Sprintf("%s&page=%d", pagedUrl, page)
		} else {
			pagedUrl = fmt.Sprintf("%s?page=%d", pagedUrl, page)
		}

		req, err := http.NewRequest("GET", pagedUrl, nil)
		if err != nil {
			break
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}

		client := &http.Client{Timeout: 30 * time.Second}
		resp, err := client.Do(req)
		if err != nil {
			break
		}

		bodyBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			break
		}

		var apiRes struct {
			Data []map[string]interface{} `json:"data"`
			Meta struct {
				CurrentPage int `json:"current_page"`
				LastPage    int `json:"last_page"`
			} `json:"meta"`
		}
		
		if err := json.Unmarshal(bodyBytes, &apiRes); err != nil {
			var altRes []map[string]interface{}
			if err := json.Unmarshal(bodyBytes, &altRes); err == nil {
				apiRes.Data = altRes
				hasMore = false
			} else {
				break
			}
		}

		if len(apiRes.Data) == 0 {
			break
		}

		if apiRes.Meta.CurrentPage >= apiRes.Meta.LastPage && apiRes.Meta.LastPage > 0 {
			hasMore = false
		}

		tx, err := db.DB.Begin()
		if err != nil {
			break
		}

		allOlder := true
		for _, item := range apiRes.Data {
			getString := func(k string) string {
				if v, ok := item[k]; ok && v != nil {
					return fmt.Sprintf("%v", v)
				}
				return ""
			}

			itemId := getString("id")
			if itemId == "" {
				continue
			}

			updatedAtStr := getString("updated_at")
			if updatedAtStr != "" {
				t, err := time.Parse("2006-01-02 15:04:05", updatedAtStr)
				if err == nil {
					if t.After(newestUpdatedAt) {
						newestUpdatedAt = t
					}
					if t.After(lastSync) || lastSync.IsZero() {
						allOlder = false
					}
				}
			}

			code := getString("code")
			description := getString("description")
			unit := getString("unit")
			flagActive := 1
			if val, ok := item["flag_active"]; ok && val != nil {
				strVal := fmt.Sprintf("%v", val)
				if strVal == "0" || strVal == "false" || strVal == "False" {
					flagActive = 0
				}
			}
			createdAt := getString("created_at")
			minimumStock := 0
			if val, ok := item["minimum_stock"].(float64); ok {
				minimumStock = int(val)
			}
			parentId := getString("parent_id")
			compType := getString("type")
			class := getString("class")
			remark := getString("remark")
			partNo := getString("part_no")
			branchId := getString("m_branch_id")
			itemCode := getString("itemcode")
			descriptionCode := getString("description_code")

			_, err = tx.Exec(`
				INSERT INTO master_components (
					id, code, description, unit, flag_active, created_at, updated_at,
					minimum_stock, parent_id, type, class, remark, part_no,
					m_branch_id, itemcode, description_code
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(id) DO UPDATE SET
					code=excluded.code,
					description=excluded.description,
					unit=excluded.unit,
					flag_active=excluded.flag_active,
					updated_at=excluded.updated_at,
					minimum_stock=excluded.minimum_stock,
					parent_id=excluded.parent_id,
					type=excluded.type,
					class=excluded.class,
					remark=excluded.remark,
					part_no=excluded.part_no,
					m_branch_id=excluded.m_branch_id,
					itemcode=excluded.itemcode,
					description_code=excluded.description_code
			`,
				itemId, code, description, unit, flagActive, createdAt, updatedAtStr,
				minimumStock, parentId, compType, class, remark, partNo,
				branchId, itemCode, descriptionCode,
			)
		}
		
		tx.Commit()

		if allOlder {
			hasMore = false
			break
		}
		page++
	}

	if !newestUpdatedAt.IsZero() {
		now := time.Now().Format("2006-01-02 15:04:05")
		db.Exec("UPDATE sync_configs SET last_sync = ? WHERE id = ?", now, configId)
	}
}
