package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"shipyard/db"
)

func inventoryRouter() *chi.Mux {
	r := chi.NewRouter()
	r.Get("/api/inventory/summary", GetInventorySummary)
	r.Get("/api/inventory/data/{dataset}", GetInventory)
	r.Post("/api/inventory/sync/{dataset}", SyncInventory)
	return r
}

func inventoryCall(t *testing.T, method, path, body string, out any) int {
	t.Helper()
	rec := httptest.NewRecorder()
	inventoryRouter().ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
	if out != nil {
		if err := json.Unmarshal(rec.Body.Bytes(), out); err != nil {
			t.Fatalf("%s %s: %v (%s)", method, path, err, rec.Body.String())
		}
	}
	return rec.Code
}

func resetInventoryTables(t *testing.T) {
	t.Helper()
	for table := range db.InventoryTables {
		if _, err := db.Exec("DELETE FROM " + table); err != nil {
			t.Fatalf("clear %s: %v", table, err)
		}
	}
	db.Exec("DELETE FROM app_meta WHERE key LIKE 'inv_sync_%'")
}

type invListResponse struct {
	Data   []map[string]any      `json:"data"`
	Total  int                   `json:"total"`
	Totals map[string]float64    `json:"totals"`
	Facets map[string][]invFacet `json:"facets"`
	Synced *invSyncInfo          `json:"synced"`
}

func TestInventorySyncAndList(t *testing.T) {
	resetInventoryTables(t)

	stock := `{"source": "Master Inventory 2026.xlsx", "rows": [
		{"kategori": "Pipe", "nama": "Steel Elbow", "ukuran": "Sch 40 2\"", "gudang": "GUDANG-1", "stok_akhir": 4, "nilai_stok": 140000, "status": "AMAN"},
		{"kategori": "Paint", "nama": "Cat Epoxy", "ukuran": "Merah 20 L", "gudang": "GUDANG-1", "stok_akhir": "2.5", "nilai_stok": 500000.5, "status": "PESAN ULANG"},
		{"kategori": "Pipe", "nama": "Steel SCH 40 Seamless", "ukuran": 123456, "gudang": "GUDANG-1", "stok_akhir": -1, "nilai_stok": 0, "status": "STOK NEGATIF"}
	]}`
	var sync struct {
		Rows         int      `json:"rows"`
		Warnings     []string `json:"warnings"`
		WarningCount int      `json:"warning_count"`
	}
	if code := inventoryCall(t, "POST", "/api/inventory/sync/stok", stock, &sync); code != 200 || sync.Rows != 3 || sync.WarningCount != 0 {
		t.Fatalf("sync stok: %d %+v", code, sync)
	}

	var list invListResponse
	inventoryCall(t, "GET", "/api/inventory/data/stok", "", &list)
	if list.Total != 3 || list.Totals["nilai_stok"] != 640000.5 || list.Synced == nil || list.Synced.Rows != 3 || list.Synced.Source != "Master Inventory 2026.xlsx" {
		t.Fatalf("list: %+v", list)
	}
	// Default order: kategori, nama. A number sent for a text column is kept as text.
	if list.Data[0]["nama"] != "Cat Epoxy" || list.Data[0]["stok_akhir"] != 2.5 || list.Data[2]["ukuran"] != "123456" {
		t.Errorf("rows: %+v", list.Data)
	}
	if len(list.Facets["status"]) != 3 || len(list.Facets["kategori"]) != 2 || list.Facets["kategori"][0] != (invFacet{"Pipe", 2}) {
		t.Errorf("facets: %+v", list.Facets)
	}

	// Two statuses mean either; every search word must match.
	inventoryCall(t, "GET", "/api/inventory/data/stok?status=PESAN+ULANG&status=STOK+NEGATIF", "", &list)
	if list.Total != 2 || list.Totals["nilai_stok"] != 500000.5 {
		t.Errorf("status filter: %+v", list)
	}
	inventoryCall(t, "GET", "/api/inventory/data/stok?search=steel+sch", "", &list)
	if list.Total != 2 {
		t.Errorf("search: %d", list.Total)
	}
	inventoryCall(t, "GET", "/api/inventory/data/stok?search=steel+quattro", "", &list)
	if list.Total != 0 {
		t.Errorf("two-word search matched %d", list.Total)
	}
	inventoryCall(t, "GET", "/api/inventory/data/stok?sort=nilai_stok&dir=desc&limit=1", "", &list)
	if len(list.Data) != 1 || list.Data[0]["nama"] != "Cat Epoxy" {
		t.Errorf("sort: %+v", list.Data)
	}
	// Unknown sort columns fall back to the default order instead of reaching SQL.
	if code := inventoryCall(t, "GET", "/api/inventory/data/stok?sort=nama;DROP", "", &list); code != 200 || list.Total != 3 {
		t.Errorf("bad sort: %d", code)
	}

	usage := `{"rows": [
		{"id_pemakaian": "P0001", "tanggal": "2026-11-02T00:00:00", "nama": "Baja E6013", "proyek": "PROYEK A", "qty": 10, "biaya_fifo": 185000},
		{"id_pemakaian": "P0001", "tanggal": 46000, "nama": "Baja E6013", "proyek": "PROYEK B", "qty": "lima", "biaya_fifo": 92500}
	]}`
	if code := inventoryCall(t, "POST", "/api/inventory/sync/pemakaian", usage, &sync); code != 200 || sync.Rows != 2 || sync.WarningCount != 1 ||
		!strings.Contains(sync.Warnings[0], "Baris 2, kolom qty") {
		t.Fatalf("sync pemakaian: %d %+v", code, sync)
	}
	inventoryCall(t, "GET", "/api/inventory/data/pemakaian?date_from=2026-01-01", "", &list)
	// Repeated workbook IDs are kept; 46000 is Excel's serial for 2025-12-09.
	if list.Total != 1 || list.Data[0]["proyek"] != "PROYEK A" {
		t.Errorf("date filter: %+v", list)
	}
	inventoryCall(t, "GET", "/api/inventory/data/pemakaian?date_to=2025-12-31", "", &list)
	if list.Total != 1 || list.Data[0]["tanggal"] != "2025-12-09" || list.Data[0]["qty"] != nil {
		t.Errorf("serial date / bad number: %+v", list.Data)
	}

	var summary struct {
		StockItems    int     `json:"stock_items"`
		StockValue    float64 `json:"stock_value"`
		NeedOrder     int     `json:"need_order"`
		NegativeStock int     `json:"negative_stock"`
		UsageCost     float64 `json:"usage_cost"`
		Synced        map[string]*invSyncInfo
	}
	inventoryCall(t, "GET", "/api/inventory/summary", "", &summary)
	if summary.StockItems != 3 || summary.StockValue != 640000.5 || summary.NeedOrder != 2 || summary.NegativeStock != 1 ||
		summary.UsageCost != 277500 || summary.Synced["stok"] == nil || summary.Synced["pembelian"] != nil {
		t.Errorf("summary: %+v", summary)
	}

	// A new sync replaces the whole table.
	inventoryCall(t, "POST", "/api/inventory/sync/stok", `{"rows": [{"nama": "Kuas", "status": "AMAN"}]}`, &sync)
	inventoryCall(t, "GET", "/api/inventory/data/stok", "", &list)
	if list.Total != 1 || list.Data[0]["nama"] != "Kuas" {
		t.Errorf("resync: %+v", list)
	}
}

func TestInventorySyncRejects(t *testing.T) {
	resetInventoryTables(t)
	inventoryCall(t, "POST", "/api/inventory/sync/material", `{"rows": [{"nama": "Kuas"}]}`, nil)

	var res struct {
		Error   string   `json:"error"`
		Columns []string `json:"columns"`
	}
	// A misnamed column fails the whole upload and names the expected columns.
	code := inventoryCall(t, "POST", "/api/inventory/sync/material", `{"rows": [{"nama": "Kuas", "Nama Material": "x"}]}`, &res)
	if code != 400 || !strings.Contains(res.Error, "Nama Material") || len(res.Columns) != 9 {
		t.Errorf("unknown column: %d %+v", code, res)
	}
	// An empty upload does not wipe the table unless asked to.
	if code := inventoryCall(t, "POST", "/api/inventory/sync/material", `{"rows": []}`, &res); code != 400 {
		t.Errorf("empty upload: %d", code)
	}
	var list invListResponse
	inventoryCall(t, "GET", "/api/inventory/data/material", "", &list)
	if list.Total != 1 {
		t.Errorf("table changed by rejected uploads: %d rows", list.Total)
	}
	if code := inventoryCall(t, "POST", "/api/inventory/sync/material?allow_empty=1", `{"rows": []}`, nil); code != 200 {
		t.Errorf("allow_empty: %d", code)
	}
	if code := inventoryCall(t, "GET", "/api/inventory/data/gudang", "", nil); code != 404 {
		t.Errorf("unknown dataset: %d", code)
	}
	if code := inventoryCall(t, "POST", "/api/inventory/sync/stok", `not json`, nil); code != 400 {
		t.Errorf("bad json: %d", code)
	}
}
