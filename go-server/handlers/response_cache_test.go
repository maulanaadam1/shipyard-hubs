package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"shipyard/db"
)

func TestCacheWorkOrderReads(t *testing.T) {
	calls := 0
	h := CacheWorkOrderReads(time.Minute)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"n":1}`))
	}))
	get := func(url string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", url, nil))
		return rec
	}
	if r := get("/api/work-orders/stats?a=1"); r.Header().Get("X-Cache") != "MISS" || calls != 1 {
		t.Fatalf("first call should miss (calls=%d)", calls)
	}
	if r := get("/api/work-orders/stats?a=1"); r.Header().Get("X-Cache") != "HIT" || calls != 1 || r.Body.String() != `{"n":1}` {
		t.Fatalf("second call should hit (calls=%d, body=%q)", calls, r.Body.String())
	}
	if get("/api/work-orders/stats?a=2"); calls != 2 {
		t.Fatalf("different query must not share a cache entry (calls=%d)", calls)
	}
	InvalidateWorkOrderCache()
	if r := get("/api/work-orders/stats?a=1"); r.Header().Get("X-Cache") != "MISS" || calls != 3 {
		t.Fatalf("invalidation should force a miss (calls=%d)", calls)
	}
}

func TestCacheInvalidatedByListSync(t *testing.T) {
	resetWorkOrderTables(t)
	before := woDataVersion.Load()
	if err := ProcessWorkOrderList([]byte(`{"data": [{"id": 300, "code": "WO-300", "updated_at": "2026-10-05 09:00:00"}]}`)); err != nil {
		t.Fatal(err)
	}
	if woDataVersion.Load() == before {
		t.Error("a list sync that wrote rows must invalidate the cache")
	}
}

func TestGetDataInFilter(t *testing.T) {
	db.Exec("DELETE FROM master_components")
	for _, id := range []string{"1", "2", "3"} {
		if _, err := db.Exec("INSERT INTO master_components (id, code) VALUES (?, ?)", id, "C"+id); err != nil {
			t.Skipf("master_components schema differs: %v", err)
		}
	}
	r := chi.NewRouter()
	r.Get("/api/data/{table}", GetData)

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest("GET", "/api/data/master_components?in_col=id&in=1,3", nil))
	var out struct {
		Data []map[string]interface{} `json:"data"`
	}
	json.Unmarshal(rec.Body.Bytes(), &out)
	if rec.Code != 200 || len(out.Data) != 2 {
		t.Fatalf("in filter: status %d, %d rows (%s)", rec.Code, len(out.Data), rec.Body.String())
	}

	rec = httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest("GET", "/api/data/master_components?in_col=id%3B%20DROP%20TABLE%20x&in=1", nil))
	if rec.Code != 400 {
		t.Errorf("injected in_col must be rejected, got %d", rec.Code)
	}
}
