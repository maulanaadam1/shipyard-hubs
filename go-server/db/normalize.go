package db

import (
	"encoding/json"
	"strings"
	"fmt"
)

// parseFloatAny handles any potential JSON number type
func parseFloatAny(v interface{}) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case float32:
		return float64(val)
	case int:
		return float64(val)
	case string:
		var f float64
		fmt.Sscanf(val, "%f", &f)
		return f
	}
	return 0
}

func NormalizeWorkOrder(woID string, rawJson []byte) {
	var dynamic map[string]interface{}
	if err := json.Unmarshal(rawJson, &dynamic); err != nil {
		return
	}

	var repairList []interface{}
	var joID string
	if dataMap, ok := dynamic["data"].(map[string]interface{}); ok {
		if rl, ok := dataMap["repair_list"].([]interface{}); ok {
			repairList = rl
		}
		if jId, ok := dataMap["t_job_order_id"]; ok && jId != nil {
			joID = fmt.Sprintf("%v", jId)
		}
	} else {
		if rl, ok := dynamic["repair_list"].([]interface{}); ok {
			repairList = rl
		}
		if jId, ok := dynamic["t_job_order_id"]; ok && jId != nil {
			joID = fmt.Sprintf("%v", jId)
		}
	}

	var approvedCost, pendingCost, rejectedCost float64

	var processItems func(items []interface{}, parentId string)
	processItems = func(items []interface{}, parentId string) {
		for _, itemRaw := range items {
			item, ok := itemRaw.(map[string]interface{})
			if !ok {
				continue
			}
            
            itemId, _ := item["id"].(string)
            path, _ := item["path"].(string)
            label, _ := item["label"].(string)
            remark, _ := item["remark"].(string)
            unit, _ := item["unit"].(string)
            statusAppr, _ := item["status_approval"].(string)
            createdAt, _ := item["created_at"].(string)
            
            statusApprLower := strings.ToLower(strings.TrimSpace(statusAppr))
            approvedLevel := parseFloatAny(item["approved_level"])
            volume := parseFloatAny(item["volume"])
            price := parseFloatAny(item["price"])
            totalPrice := parseFloatAny(item["total_price"])
            volCostFinal := parseFloatAny(item["volume_cost_final"])

			matRaw, hasMat := item["material"].([]interface{})
			if hasMat && len(matRaw) > 0 {
				processItems(matRaw, itemId)
			} else {
                // Leaf node cost calculation
                costToAdd := float64(0)
                baseCost := volCostFinal
                if baseCost == 0 {
                    baseCost = price
                }
                if baseCost > 0 {
                    costToAdd = baseCost * volume
                } else if totalPrice > 0 {
                    costToAdd = totalPrice
                }

                if statusApprLower == "rejected" {
                    rejectedCost += costToAdd
                } else if approvedLevel >= 5 || statusApprLower == "approved" || statusApprLower == "approved level 5" {
                    approvedCost += costToAdd
                } else {
                    pendingCost += costToAdd
                }
            }

            if itemId != "" {
                query := `INSERT INTO work_order_items (
                    id, wo_id, jo_id, parent_id, path, label, remark, volume, unit, price, total_price, approved_level, status_approval, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    label = EXCLUDED.label,
                    remark = EXCLUDED.remark,
                    volume = EXCLUDED.volume,
                    price = EXCLUDED.price,
                    total_price = EXCLUDED.total_price,
                    approved_level = EXCLUDED.approved_level,
                    status_approval = EXCLUDED.status_approval`
                
                Exec(query, itemId, woID, joID, parentId, path, label, remark, volume, unit, price, totalPrice, approvedLevel, statusAppr, createdAt)
            }
		}
	}

	processItems(repairList, "")

	// Update calculated columns
	Exec("UPDATE work_order_details SET approved_cost = ?, pending_cost = ?, rejected_cost = ? WHERE wo_id = ?",
		approvedCost, pendingCost, rejectedCost, woID)
}
