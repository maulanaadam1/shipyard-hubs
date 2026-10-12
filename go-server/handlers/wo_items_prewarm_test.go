package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCacheKeyIgnoresParamOrder(t *testing.T) {
	a := httptest.NewRequest("GET", "/api/wo-items/summary?page=1&limit=25&sort=latest_date&dir=desc&group=item", nil)
	b := httptest.NewRequest("GET", "/api/wo-items/summary?group=item&dir=desc&sort=latest_date&limit=25&page=1", nil)
	if cacheKey(a.URL.Path, a.URL.Query()) != cacheKey(b.URL.Path, b.URL.Query()) {
		t.Error("the same parameters in another order must share a cache entry")
	}
}

// The summary's group count now comes from the page query (COUNT(*) OVER ()),
// including pages past the end, which fall back to a separate count.
func TestWorkOrderItemSummaryTotalFromWindow(t *testing.T) {
	seedItemsForExport(t)
	summary := func(query string) (int, int) {
		rec := httptest.NewRecorder()
		GetWorkOrderItemSummary(rec, httptest.NewRequest("GET", "/api/wo-items/summary?group=project_item&"+query, nil))
		var out struct {
			Data  []map[string]interface{} `json:"data"`
			Total int                      `json:"total"`
		}
		json.Unmarshal(rec.Body.Bytes(), &out)
		return len(out.Data), out.Total
	}
	if n, total := summary("page=1&limit=2"); n != 2 || total != 3 {
		t.Errorf("page 1: %d rows, total %d; want 2, 3", n, total)
	}
	if n, total := summary("page=2&limit=2"); n != 1 || total != 3 {
		t.Errorf("page 2: %d rows, total %d; want 1, 3", n, total)
	}
	if n, total := summary("page=9&limit=2"); n != 0 || total != 3 {
		t.Errorf("page past the end: %d rows, total %d; want 0, 3", n, total)
	}
	if n, total := summary("status=approved&page=1&limit=25"); n != 1 || total != 1 {
		t.Errorf("filtered: %d rows, total %d; want 1, 1", n, total)
	}
}

func TestPrewarmFillsDefaultViews(t *testing.T) {
	seedItemsForExport(t)
	PrewarmWorkOrderItemViews()

	calls := 0
	cached := CacheWorkOrderReads(WorkOrderItemsCacheTTL)(countingHandler(&calls, GetWorkOrderItemSummary))
	// The browser's parameter order differs from the pre-warmer's.
	rec := httptest.NewRecorder()
	cached.ServeHTTP(rec, httptest.NewRequest("GET", "/api/wo-items/summary?page=1&limit=25&sort=latest_date&dir=desc&group=vendor_activity", nil))
	if rec.Header().Get("X-Cache") != "HIT" || calls != 0 {
		t.Fatalf("default view should be served warm (X-Cache=%s, handler calls=%d)", rec.Header().Get("X-Cache"), calls)
	}
	var out struct {
		Total int `json:"total"`
	}
	json.Unmarshal(rec.Body.Bytes(), &out)
	if out.Total != 1 {
		t.Errorf("warm vendor_activity total = %d, want 1", out.Total)
	}

	// A filtered request is not pre-warmed, and a WO write drops the warm copies.
	rec = httptest.NewRecorder()
	cached.ServeHTTP(rec, httptest.NewRequest("GET", "/api/wo-items/summary?page=1&limit=25&sort=latest_date&dir=desc&group=vendor_activity&status=approved", nil))
	if rec.Header().Get("X-Cache") != "MISS" {
		t.Errorf("filtered view should miss")
	}
	InvalidateWorkOrderCache()
	rec = httptest.NewRecorder()
	cached.ServeHTTP(rec, httptest.NewRequest("GET", "/api/wo-items/summary?page=1&limit=25&sort=latest_date&dir=desc&group=vendor_activity", nil))
	if rec.Header().Get("X-Cache") != "MISS" {
		t.Errorf("after a WO write the warm copy must not be served")
	}
}

func countingHandler(calls *int, h http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*calls++
		h(w, r)
	})
}
