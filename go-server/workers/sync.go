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
	query := "SELECT id, url, headers, IFNULL(last_sync, ''), IFNULL(interval_type, 'minutes'), IFNULL(interval_value, 5) FROM sync_configs WHERE is_active = 1"
	var rows *sql.Rows
	var err error

	if targetId != "" {
		query += " AND id = ?"
		rows, err = db.DB.Query(query, targetId)
	} else {
		rows, err = db.DB.Query(query)
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
			_, err = db.DB.Exec("UPDATE sync_configs SET last_sync = ?, last_response = ? WHERE id = ?", now, string(bodyBytes), id)
			if err != nil {
				log.Printf("SyncWorker DB error updating %s: %v", id, err)
			} else {
				log.Printf("SyncWorker successfully updated data for: %s", id)
			}
		}
	}
}

func processJobOrdersIncremental(configId, baseUrl string, headers map[string]string, lastSyncStr string) {
	_, err := db.DB.Exec(`CREATE TABLE IF NOT EXISTS sync_job_orders (
		id TEXT PRIMARY KEY,
		updated_at DATETIME,
		raw_data TEXT
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
			} else {
				hasMore = false
				continue
			}
		default:
			hasMore = false
			continue
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

		stmt, err := tx.Prepare(`INSERT INTO sync_job_orders (id, updated_at, raw_data) VALUES (?, ?, ?) 
			ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at, raw_data=excluded.raw_data`)
			
		stmtProjects, errProj := tx.Prepare(`INSERT INTO projects (
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
				m_employee_id=excluded.m_employee_id`)

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

				itemJson, _ := json.Marshal(itemMap)
				stmt.Exec(itemId, itemUpdatedStr, string(itemJson))

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
			db.DB.Exec("UPDATE sync_configs SET last_sync = ? WHERE id = ?", now, configId)
		}

		page++
	}

	now := time.Now().Format("2006-01-02 15:04:05")
	db.DB.Exec("UPDATE sync_configs SET last_sync = ?, last_response = ? WHERE id = ?", now, `{"status": "Incremental Sync Active", "tables": "sync_job_orders"}`, configId)
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
		db.DB.Exec("UPDATE sync_configs SET last_sync = ? WHERE id = ?", now, configId)
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
		db.DB.Exec("UPDATE sync_configs SET last_sync = ? WHERE id = ?", now, configId)
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
		db.DB.Exec("UPDATE sync_configs SET last_sync = ? WHERE id = ?", nowStr, configId)
	}
}
