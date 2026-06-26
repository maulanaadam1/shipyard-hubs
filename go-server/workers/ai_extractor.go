package workers

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"shipyard/db"
	"sync"
)

// MasterWO is a struct to find vendor and ship info from the main list
type MasterWO struct {
	ID             interface{} `json:"id"`
	Code           string      `json:"code"`
	JoCode         string      `json:"jo_code"`
	MVendorName    string      `json:"m_vendor_name"`
	MShipName      string      `json:"m_ship_name"`
	TotalCost      interface{} `json:"total_cost"`
	ApprovalStatus string      `json:"approval_status"`
}

// ExtractToAITables parses the raw Work Order detail JSON and flattens it into the 3 AI tables.
func ExtractToAITables(woID string, rawJsonBytes []byte) error {
	var detailData struct {
		ID           interface{} `json:"id"`
		Code         string      `json:"code"`
		TJobOrderID  interface{} `json:"t_job_order_id"`
		RepairList   []any       `json:"repair_list"`
		Requisitions []any       `json:"material_requisition"` 
	}

	// Dynamic parsing to unwrap {"data": {...}} if present
	var fullJson map[string]interface{}
	if err := json.Unmarshal(rawJsonBytes, &fullJson); err != nil {
		return err
	}

	var rootObj interface{} = fullJson
	if dataObj, ok := fullJson["data"]; ok {
		rootObj = dataObj
	}

	// Re-marshal the actual root object and parse into detailData
	innerBytes, _ := json.Marshal(rootObj)
	json.Unmarshal(innerBytes, &detailData)

	// 1. Fetch Master Work Order Info from sync_configs to get vendor and ship name
	var masterWOs []MasterWO
	var woMasterResp string
	err := db.QueryRow("SELECT COALESCE(last_response, '[]') FROM sync_configs WHERE id = 'WorkOrders'").Scan(&woMasterResp)
	if err == nil {
		var parsedRespItem struct {
			Data struct {
				Item []MasterWO `json:"item"`
			} `json:"data"`
		}
		var parsedRespArray struct {
			Data []MasterWO `json:"data"`
		}

		// Try {"data": {"item": [...]}}
		if err := json.Unmarshal([]byte(woMasterResp), &parsedRespItem); err == nil && len(parsedRespItem.Data.Item) > 0 {
			masterWOs = parsedRespItem.Data.Item
		} else if err := json.Unmarshal([]byte(woMasterResp), &parsedRespArray); err == nil && len(parsedRespArray.Data) > 0 {
			// Try {"data": [...]}
			masterWOs = parsedRespArray.Data
		} else {
			// Try flat array [...]
			json.Unmarshal([]byte(woMasterResp), &masterWOs)
		}
	}

	// Find the matching master WO
	var mWo MasterWO
	for _, m := range masterWOs {
		if fmt.Sprintf("%v", m.ID) == woID {
			mWo = m
			break
		}
	}

	joID := fmt.Sprintf("%v", detailData.TJobOrderID)
	if mWo.ID == "" {
		mWo.Code = detailData.Code
	}

	// Calculate total cost properly
	var totalCost float64
	switch v := mWo.TotalCost.(type) {
	case float64:
		totalCost = v
	case string:
		fmt.Sscanf(v, "%f", &totalCost)
	}

	// Start a transaction for massive performance boost
	tx, err := db.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() // Will be ignored if committed

	// Try to find approval date from JSON
	approvalDate := "-"
	if dataMap, ok := rootObj.(map[string]interface{}); ok {
		if ad, ok := dataMap["approval_date"]; ok && ad != nil {
			approvalDate = fmt.Sprintf("%v", ad)
		} else if aa, ok := dataMap["approved_at"]; ok && aa != nil {
			approvalDate = fmt.Sprintf("%v", aa)
		}
	}

	// Upsert into ai_work_orders
	tx.Exec(db.FormatQuery(`
		INSERT INTO ai_work_orders (wo_id, wo_code, jo_id, jo_code, vendor_name, ship_name, total_cost_contract, status_approval, approval_date, last_updated) 
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP) 
		ON CONFLICT(wo_id) DO UPDATE SET 
		wo_code = EXCLUDED.wo_code, vendor_name = EXCLUDED.vendor_name, ship_name = EXCLUDED.ship_name, 
		total_cost_contract = EXCLUDED.total_cost_contract, status_approval = EXCLUDED.status_approval,
		approval_date = EXCLUDED.approval_date, last_updated = CURRENT_TIMESTAMP
	`), woID, mWo.Code, joID, mWo.JoCode, mWo.MVendorName, mWo.MShipName, totalCost, mWo.ApprovalStatus, approvalDate)

	// Clean up old breakdown data for this WO
	tx.Exec(db.FormatQuery("DELETE FROM ai_wo_breakdowns WHERE wo_id = ?"), woID)

	// Update fullJson to point to the unwrapped rootObj so parsing repair_list works correctly
	if dataMap, ok := rootObj.(map[string]interface{}); ok {
		fullJson = dataMap
	}

	// Recursive function to parse repair_list and materials
	var parseRepairList func(items []interface{}, parentID string)
	parseRepairList = func(items []interface{}, parentID string) {
		for _, rawItem := range items {
			item, ok := rawItem.(map[string]interface{})
			if !ok {
				continue
			}

			id := fmt.Sprintf("%v", item["id"])
			path := fmt.Sprintf("%v", item["path"])
			label := fmt.Sprintf("%v", item["label"])
			if label == "<nil>" || label == "" {
				label = fmt.Sprintf("%v", item["code"]) // Fallback for root repair list
			}
			remark := fmt.Sprintf("%v", item["remark"])
			unit := fmt.Sprintf("%v", item["unit"])
			
			var volume float64
			if v, ok := item["volume"].(float64); ok {
				volume = v
			}

			var price float64
			if p, ok := item["price"]; ok && p != nil {
				switch pv := p.(type) {
				case float64:
					price = pv
				case string:
					fmt.Sscanf(pv, "%f", &price)
				}
			}

			totalPrice := volume * price
			if totalPrice == 0 && price > 0 { // For level 2 repair list where volume is usually not defined but price is
				totalPrice = price
			}

			// Try to find approval status
			approvedLevel := 0
			statusApproval := "Unknown"

			// We insert the breakdown
			parentRef := parentID
			if parentID == "" {
				tx.Exec(db.FormatQuery(`
					INSERT INTO ai_wo_breakdowns (id, wo_id, jo_id, vendor_name, ship_name, parent_id, path, label, remark, volume, unit, price, total_price, approved_level, status_approval, approval_date, last_updated) 
					VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
					ON CONFLICT(id) DO NOTHING
				`), id, woID, joID, mWo.MVendorName, mWo.MShipName, path, label, remark, volume, unit, price, totalPrice, approvedLevel, statusApproval, approvalDate)
			} else {
				tx.Exec(db.FormatQuery(`
					INSERT INTO ai_wo_breakdowns (id, wo_id, jo_id, vendor_name, ship_name, parent_id, path, label, remark, volume, unit, price, total_price, approved_level, status_approval, approval_date, last_updated) 
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
					ON CONFLICT(id) DO NOTHING
				`), id, woID, joID, mWo.MVendorName, mWo.MShipName, parentRef, path, label, remark, volume, unit, price, totalPrice, approvedLevel, statusApproval, approvalDate)
			}

			// Traverse deeper material
			if matArray, ok := item["material"].([]interface{}); ok && len(matArray) > 0 {
				parseRepairList(matArray, id)
			}
		}
	}

	if repairListRaw, ok := fullJson["repair_list"].([]interface{}); ok {
		parseRepairList(repairListRaw, "")
	}

	// Now parse material_requisitions (or whatever the array name is)
	// Usually the payload from user has array of requisitions at root, or nested somewhere.
	// Let's assume the user array is passed via fullJson directly if it's an array, or under a specific key.
	// We will try to find "t_delivery_details" inside the entire JSON tree to be safe.
	
	// Clean up old delivery data for this WO
	tx.Exec(db.FormatQuery("DELETE FROM ai_material_deliveries WHERE wo_id = ?"), woID)

	var parseDeliveries func(data interface{})
	parseDeliveries = func(data interface{}) {
		switch v := data.(type) {
		case []interface{}:
			for _, elem := range v {
				parseDeliveries(elem)
			}
		case map[string]interface{}:
			// Check if this map is a Requisition object containing t_delivery_details
			if deliveriesRaw, ok := v["t_delivery_details"].([]interface{}); ok {
				reqID := fmt.Sprintf("%v", v["t_requisition_id"])
				
				for _, delRaw := range deliveriesRaw {
					del, ok := delRaw.(map[string]interface{})
					if !ok { continue }

					delID := fmt.Sprintf("%v", del["id"])
					qtyStr := fmt.Sprintf("%v", del["quantity"])
					var qty float64
					fmt.Sscanf(qtyStr, "%f", &qty)

					var compCode, compName, partNo, unit string
					if compObj, ok := del["m_component"].(map[string]interface{}); ok {
						compCode = fmt.Sprintf("%v", compObj["code"])
						compName = fmt.Sprintf("%v", compObj["description"])
						partNo = fmt.Sprintf("%v", compObj["part_no"])
						unit = fmt.Sprintf("%v", compObj["unit"])
					}

					var unitPrice, totalPrice float64
					var currency string
					if rcvObj, ok := del["t_receiving_detail"].(map[string]interface{}); ok {
						if p, ok := rcvObj["unit_price"].(float64); ok {
							unitPrice = p
							totalPrice = p * qty
						}
						currency = fmt.Sprintf("%v", rcvObj["currency"])
					}

					var delCode, delDate, receiver, receiverVendor string
					if tdelObj, ok := del["t_delivery"].(map[string]interface{}); ok {
						delCode = fmt.Sprintf("%v", tdelObj["code"])
						delDate = fmt.Sprintf("%v", tdelObj["date"])
						receiver = fmt.Sprintf("%v", tdelObj["receiver"])
						receiverVendor = fmt.Sprintf("%v", tdelObj["receiver_vendor"])
					}

					tx.Exec(db.FormatQuery(`
						INSERT INTO ai_material_deliveries (id, wo_id, jo_id, vendor_name, ship_name, requisition_id, component_code, component_name, part_no, qty_delivered, unit, unit_price, total_price, currency, delivery_code, delivery_date, receiver_name, receiver_vendor) 
						VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(id) DO NOTHING
					`), delID, woID, joID, mWo.MVendorName, mWo.MShipName, reqID, compCode, compName, partNo, qty, unit, unitPrice, totalPrice, currency, delCode, delDate, receiver, receiverVendor)
				}
			}
			
			// Recursively parse keys
			for _, val := range v {
				parseDeliveries(val)
			}
		}
	}

	parseDeliveries(fullJson)

	if err := tx.Commit(); err != nil {
		return err
	}

	log.Printf("[AI ETL] Successfully flattened Work Order %s into AI tables", woID)
	return nil
}

// RunAIEtlBackfill checks if the AI tables are missing any data, and if so, runs the extraction.
func RunAIEtlBackfill() {
	var extractedCount, totalCount int
	
	db.QueryRow("SELECT COUNT(*) FROM ai_work_orders").Scan(&extractedCount)
	db.QueryRow("SELECT COUNT(*) FROM work_order_details").Scan(&totalCount)

	if totalCount == 0 || extractedCount >= totalCount {
		// Already fully synced: robot sleeps forever
		return
	}

	missing := totalCount - extractedCount
	log.Printf("============================================================")
	log.Printf("[AI ETL MIGRATION] Found %d missing Work Orders.", missing)
	log.Printf("[AI ETL MIGRATION] Launching 10 parallel cloud workers...")
	log.Printf("============================================================")

	query := "SELECT wo_id, raw_json FROM work_order_details"
	if os.Getenv("DB_CONNECTION") == "postgres" {
		query += " WHERE wo_id NOT IN (SELECT wo_id FROM ai_work_orders)"
	}

	rows, err := db.Query(query)
	if err != nil {
		log.Printf("[AI ETL ERROR] Failed to query existing details: %v", err)
		return
	}
	defer rows.Close()

	type woJob struct {
		id      string
		rawJson string
	}
	jobs := make(chan woJob, 100)
	var wg sync.WaitGroup

	// Launch 10 concurrent workers for blazing fast ETL migration
	numWorkers := 10
	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range jobs {
				err := ExtractToAITables(job.id, []byte(job.rawJson))
				if err != nil {
					log.Printf("[AI ETL ERROR] WO %s: %v", job.id, err)
				}
			}
		}()
	}

	jobCount := 0
	for rows.Next() {
		var id, rawJson string
		if err := rows.Scan(&id, &rawJson); err == nil {
			jobs <- woJob{id: id, rawJson: rawJson}
			jobCount++
		}
	}
	close(jobs)
	wg.Wait()

	log.Printf("============================================================")
	log.Printf("[AI ETL MIGRATION] SUCCESS! Extracted %d Work Orders.", jobCount)
	log.Printf("[AI ETL MIGRATION] Robot is now retiring permanently.")
	log.Printf("============================================================")
}
