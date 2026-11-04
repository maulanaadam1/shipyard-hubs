package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"testing"

	"shipyard/db"
)

// One activity names the work its items only size ("Ganti baru plat bottom" /
// "Uk. 1200 mm x ..."); another is a heading whose item stays unknown.
const activityDetail = `{"data": {"id": 420, "code": "WO-420", "min_approval_level": 5, "updated_at": "2026-10-05 09:00:00",
	"repair_list": [
		{"id": "act-1", "path": "1", "parameter": {"path_name": "HULL > Ganti baru plat bottom"}, "material": [
			{"id": "it-1", "path": "1.1", "label": "Uk. 1200 mm x 600 mm x 10 mm x 1 lbr = 56.52 Kg, (supply dock)", "unit": "Kg", "volume": 56.52, "volume_cost_final": 30000, "approved_level": 5, "status_approval": "approved", "date_approval": "2026-09-10 08:00:00"}
		]},
		{"id": "act-2", "path": "2", "parameter": {"path_name": "PERAWATAN FASILITAS GALANGAN"}, "material": [
			{"id": "it-2", "path": "2.1", "label": "TANGGAL 5 JULI 2024, 1 kali", "unit": "Kali", "volume": 1, "volume_cost_final": 750000, "approved_level": 5, "status_approval": "approved", "date_approval": "2026-09-11 08:00:00"}
		]}
	]}}`

func TestActivityFallbackAndUnrecognizedReport(t *testing.T) {
	resetWorkOrderTables(t)
	if err := ProcessWorkOrderList([]byte(`{"data": [{"id": 420, "code": "WO-420", "m_ship_name": "Kapal C", "min_approval_level": 5, "updated_at": "2026-10-05 09:00:00"}]}`)); err != nil {
		t.Fatal(err)
	}
	db.Exec("INSERT INTO work_order_details (wo_id, raw_json) VALUES (?, ?)", "420", activityDetail)
	if err := RebuildWorkOrderDerived(); err != nil {
		t.Fatal(err)
	}

	var work, size string
	var fromActivity, recognized bool
	db.QueryRow(`SELECT COALESCE(work_type, ''), COALESCE(size, ''), COALESCE(from_activity, false), COALESCE(recognized, false)
		FROM wo_item_parsed WHERE wo_id = '420' AND item_id = 'it-1'`).Scan(&work, &size, &fromActivity, &recognized)
	if !recognized || !fromActivity || work != "Ganti baru plat" || size != "plat 10 mm" {
		t.Errorf("it-1 from its activity: %q %q from_activity=%v recognized=%v", work, size, fromActivity, recognized)
	}

	rec := httptest.NewRecorder()
	GetWorkOrderItems(rec, httptest.NewRequest("GET", "/api/wo-items?"+url.Values{"sort": {"label"}, "dir": {"desc"}}.Encode(), nil))
	var list struct {
		Data []woItemRow `json:"data"`
	}
	json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list.Data) != 2 || list.Data[0].ItemID != "it-1" || !list.Data[0].FromActivity {
		t.Errorf("list: %+v", list.Data)
	}

	rec = httptest.NewRecorder()
	GetUnrecognizedActivities(rec, httptest.NewRequest("GET", "/api/wo-findings/unrecognized", nil))
	var report struct {
		Data []struct {
			Activity  string  `json:"activity"`
			Category  string  `json:"category"`
			ItemCount int     `json:"item_count"`
			TotalCost float64 `json:"total_cost"`
		} `json:"data"`
		Total    int `json:"total"`
		Items    int `json:"items"`
		AllItems int `json:"all_items"`
	}
	json.Unmarshal(rec.Body.Bytes(), &report)
	if report.Total != 1 || report.Items != 1 || report.AllItems != 2 || report.Data[0].Activity != "PERAWATAN FASILITAS GALANGAN" || report.Data[0].TotalCost != 750000 {
		t.Fatalf("report: %+v", report)
	}

	rec = httptest.NewRecorder()
	q := url.Values{"activity": {report.Data[0].Activity}, "category": {report.Data[0].Category}}
	GetUnrecognizedActivityItems(rec, httptest.NewRequest("GET", "/api/wo-findings/unrecognized/items?"+q.Encode(), nil))
	var detail struct {
		Data []struct {
			Label  string `json:"label"`
			WOCode string `json:"wo_code"`
		} `json:"data"`
	}
	json.Unmarshal(rec.Body.Bytes(), &detail)
	if len(detail.Data) != 1 || detail.Data[0].Label != "TANGGAL 5 JULI 2024, 1 kali" || detail.Data[0].WOCode != "WO-420" {
		t.Errorf("items: %+v", detail.Data)
	}
}
