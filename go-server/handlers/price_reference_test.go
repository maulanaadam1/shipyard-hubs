package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"shipyard/db"
)

func TestPriceReferenceAPI(t *testing.T) {
	resetWorkOrderTables(t)
	t.Setenv("WO_FINDINGS_PAUSE_MS", "1")
	db.Exec(`INSERT INTO work_order_summary (wo_id, wo_code, project_name, vendor_name) VALUES ('500', 'WO-500', 'JO-1 - KAPAL', 'Vendor A')`)
	seedFindingItems(t, 450) // 12 approved at Rp 100 and one pending at Rp 450
	if _, err := RunItemFindings(); err != nil {
		t.Fatal(err)
	}

	get := func(handler func(w2 *httptest.ResponseRecorder, q url.Values), q url.Values, out interface{}) int {
		rec := httptest.NewRecorder()
		handler(rec, q)
		if out != nil {
			json.Unmarshal(rec.Body.Bytes(), out)
		}
		return rec.Code
	}
	list := func(rec *httptest.ResponseRecorder, q url.Values) {
		GetPriceReferences(rec, httptest.NewRequest("GET", "/api/price-reference?"+q.Encode(), nil))
	}
	var res struct {
		Data  []priceReference `json:"data"`
		Total int              `json:"total"`
		Units []string         `json:"units"`
	}
	// Every word must match: "packing karet" yes, "packing pipa" no.
	get(list, url.Values{"search": {"packing karet"}}, &res)
	if res.Total != 1 || res.Data[0].Median != 100 || res.Data[0].N != 12 || res.Data[0].Unit != "pcs" || len(res.Units) != 1 {
		t.Fatalf("search: %+v", res)
	}
	get(list, url.Values{"search": {"packing pipa"}}, &res)
	if res.Total != 0 {
		t.Errorf("two-word search matched %d", res.Total)
	}

	var detail struct {
		Reference priceReference  `json:"reference"`
		Years     []priceStats    `json:"years"`
		Vendors   []priceStats    `json:"vendors"`
		Items     []referenceItem `json:"items"`
		ItemCount int             `json:"item_count"`
	}
	ref := url.Values{"work_type": {"Ganti baru packing karet"}, "size": {""}, "unit": {"pcs"}}
	code := get(func(rec *httptest.ResponseRecorder, q url.Values) {
		GetPriceReferenceDetail(rec, httptest.NewRequest("GET", "/api/price-reference/detail?"+q.Encode(), nil))
	}, ref, &detail)
	// The pending item is not part of the reference.
	if code != 200 || detail.ItemCount != 12 || len(detail.Years) != 1 || detail.Years[0].Label != "2026" || detail.Years[0].Median != 100 ||
		len(detail.Vendors) != 1 || detail.Vendors[0].Label != "Vendor A" || detail.Items[0].WOCode != "WO-500" || detail.Items[0].Position != "within" {
		t.Errorf("detail: code %d %+v", code, detail)
	}
	missing := url.Values{"work_type": {"Tidak ada"}, "size": {""}, "unit": {"pcs"}}
	if code := get(func(rec *httptest.ResponseRecorder, q url.Values) {
		GetPriceReferenceDetail(rec, httptest.NewRequest("GET", "/api/price-reference/detail?"+q.Encode(), nil))
	}, missing, nil); code != 404 {
		t.Errorf("unknown reference: %d", code)
	}

	rec := httptest.NewRecorder()
	ExportPriceReferences(rec, httptest.NewRequest("GET", "/api/price-reference/export?search=packing", nil))
	if rec.Code != 200 || !strings.Contains(rec.Header().Get("Content-Disposition"), "Harga_Acuan_") || rec.Body.Len() < 1000 {
		t.Errorf("export: %d %q %d bytes", rec.Code, rec.Header().Get("Content-Disposition"), rec.Body.Len())
	}
}
