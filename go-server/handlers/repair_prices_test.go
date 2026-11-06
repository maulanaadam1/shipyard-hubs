package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"shipyard/db"
)

// Two WOs of one Job Order carry the same two repair-list activities.
func repairPriceDetail(woID, code, vendor string, costAct1 float64, act2Leaf string) string {
	return `{"data": {"id": ` + woID + `, "code": "` + code + `", "m_vendor": {"name": "` + vendor + `"}, "t_job_order_id": 77,
		"t_job_order": {"id": 77, "code_project": "JO-77/T - KM UJI"},
		"repair_list": [
			{"uniqcode": "act-1", "path": "1.1", "description": "Pembuatan manhole", "unit": "Unit", "price": "1000000.00", "quantity": "2",
			 "version": 1, "t_job_order_id": 77, "parameter": {"path_name": "Kontruksi > Pembuatan manhole", "total_price": 2000000},
			 "material": [{"id": "` + woID + `-l1", "path": "1.1.1", "label": "Tenaga harian", "unit": "Orang", "volume": 2,
				"volume_cost_final": ` + jsonNum(costAct1) + `, "approved_level": 5, "status_approval": "approved", "date_approval": "2026-10-01 08:00:00"}]},
			{"uniqcode": "act-2", "path": "1.2", "description": "Tanda selar", "unit": "Unit", "price": "500000.00", "quantity": "1",
			 "version": 1, "t_job_order_id": 77, "parameter": {"path_name": "Kontruksi > Tanda selar", "total_price": 500000},
			 "material": [` + act2Leaf + `]}
		]}}`
}

func jsonNum(f float64) string { b, _ := json.Marshal(f); return string(b) }

func TestRepairPricesAndJobMargins(t *testing.T) {
	resetWorkOrderTables(t)
	db.Exec("DELETE FROM wo_repair_activities")
	t.Cleanup(func() { db.Exec("DELETE FROM wo_repair_activities") })

	a := repairPriceDetail("501", "WO-A/T", "Vendor A", 300000,
		`{"id": "501-l2", "path": "1.2.1", "label": "Cat selar", "unit": "Unit", "volume": 1, "volume_cost_final": 0, "approved_level": 5, "status_approval": "approved", "date_approval": "2026-10-01 08:00:00"}`)
	b := repairPriceDetail("502", "WO-B/T", "Vendor B", 50000,
		`{"id": "502-l2", "path": "1.2.1", "label": "Cat selar", "unit": "Unit", "volume": 1, "volume_cost_final": 999999, "approved_level": 2, "status_approval": "rejected"}`)
	for id, body := range map[string]string{"501": a, "502": b} {
		if err := storeWorkOrderDetail(id, []byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM wo_repair_activities WHERE jo_id = '77'`).Scan(&n)
	if n != 4 {
		t.Fatalf("stored activities: %d (want 2 per WO)", n)
	}

	get := func(path string) map[string]interface{} {
		rec := httptest.NewRecorder()
		handler := GetJobMargins
		if strings.Contains(path, "detail") {
			handler = GetJobMarginDetail
		}
		handler(rec, httptest.NewRequest("GET", path, nil))
		var out map[string]interface{}
		json.Unmarshal(rec.Body.Bytes(), &out)
		return out
	}
	out := get("/api/job-margins?q=uji")
	list, _ := out["job_orders"].([]interface{})
	if len(list) != 1 {
		t.Fatalf("job orders: %v", out)
	}
	jo := list[0].(map[string]interface{})
	// Price once per activity: 2.000.000 + 500.000, not twice that.
	// Cost: 300.000 x 2 (A) + 50.000 x 2 (B); the rejected 999.999 doesn't count.
	want := map[string]float64{"price": 2500000, "double_counted": 2500000, "cost": 700000, "margin": 1800000, "wo_count": 2, "shared_activities": 2}
	for k, v := range want {
		if jo[k] != v {
			t.Errorf("%s = %v, want %v", k, jo[k], v)
		}
	}

	detail := get("/api/job-margins/detail?jo_id=77")
	acts, _ := detail["activities"].([]interface{})
	if len(acts) != 2 {
		t.Fatalf("activities: %v", detail)
	}
	first := acts[0].(map[string]interface{})
	if first["price"] != float64(2000000) || first["cost"] != float64(700000) || len(first["wos"].([]interface{})) != 2 {
		t.Errorf("activity 1: %v", first)
	}
	if wos, _ := detail["work_orders"].([]interface{}); len(wos) != 2 {
		t.Errorf("work orders: %v", detail["work_orders"])
	}

	// The stored details can be read again from scratch (backfill).
	db.Exec("DELETE FROM wo_repair_activities")
	setAppMeta("repair_prices_version", "")
	setAppMeta("repair_prices_cursor", "")
	if written, err := backfillRepairActivities(); err != nil || written != 4 {
		t.Fatalf("backfill: %d, %v", written, err)
	}
	if appMeta("repair_prices_version") != repairPricesVersion {
		t.Error("backfill not recorded as done")
	}
	if written, _ := backfillRepairActivities(); written != 0 {
		t.Errorf("second backfill wrote %d", written)
	}
}
