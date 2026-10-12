package handlers

import (
	"bytes"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"time"
)

// The Item Pekerjaan WO views without filters are what people open first, and
// the grouped ones aggregate ~400k items (2 to 6 s each). Keep those default
// pages in the response cache: warm them at start-up, again once WO data has
// been quiet for a while after a change, and before the warm copies expire.

// WorkOrderItemsCacheTTL is how long an /api/wo-items* response is reused.
// Writes to WO data drop it sooner (InvalidateWorkOrderCache).
const WorkOrderItemsCacheTTL = 10 * time.Minute

// The first page each view requests, as WorkOrderItems.tsx builds it.
var woItemDefaultRequests = []struct {
	path    string
	query   url.Values
	handler http.HandlerFunc
}{
	{"/api/wo-items", url.Values{"page": {"1"}, "limit": {"25"}, "sort": {"item_date"}, "dir": {"desc"}}, GetWorkOrderItems},
	{"/api/wo-items/facets", url.Values{}, GetWorkOrderItemFacets},
	{"/api/wo-items/summary", summaryDefault("project_item"), GetWorkOrderItemSummary},
	{"/api/wo-items/summary", summaryDefault("project_activity"), GetWorkOrderItemSummary},
	{"/api/wo-items/summary", summaryDefault("activity"), GetWorkOrderItemSummary},
	{"/api/wo-items/summary", summaryDefault("item"), GetWorkOrderItemSummary},
	{"/api/wo-items/summary", summaryDefault("category"), GetWorkOrderItemSummary},
	{"/api/wo-items/summary", summaryDefault("vendor_activity"), GetWorkOrderItemSummary},
}

func summaryDefault(group string) url.Values {
	return url.Values{"page": {"1"}, "limit": {"25"}, "sort": {"latest_date"}, "dir": {"desc"}, "group": {group}}
}

type bufferWriter struct {
	header http.Header
	status int
	buf    bytes.Buffer
}

func (b *bufferWriter) Header() http.Header         { return b.header }
func (b *bufferWriter) WriteHeader(code int)        { b.status = code }
func (b *bufferWriter) Write(p []byte) (int, error) { return b.buf.Write(p) }

// warmCacheEntry runs a read handler and stores its answer under the key a
// browser request for the same URL looks up.
func warmCacheEntry(path string, q url.Values, handler http.HandlerFunc) error {
	version := woDataVersion.Load()
	req, err := http.NewRequest(http.MethodGet, path+"?"+q.Encode(), nil)
	if err != nil {
		return err
	}
	bw := &bufferWriter{header: http.Header{}, status: http.StatusOK}
	handler(bw, req)
	if bw.status != http.StatusOK {
		return fmt.Errorf("%s?%s: HTTP %d", path, q.Encode(), bw.status)
	}
	storeCachedResponse(cacheKey(path, q), bw.buf.Bytes(), bw.header.Get("Content-Type"), version)
	return nil
}

// PrewarmWorkOrderItemViews computes the default page of every view, one at a
// time so the database sees a single heavy query at once.
func PrewarmWorkOrderItemViews() {
	for _, d := range woItemDefaultRequests {
		if err := warmCacheEntry(d.path, d.query, d.handler); err != nil {
			log.Printf("wo-items prewarm: %v", err)
		}
	}
}

// StartWorkOrderItemPrewarm keeps the default views warm in the background.
// WO_ITEMS_PREWARM=false turns it off.
func StartWorkOrderItemPrewarm() {
	if os.Getenv("WO_ITEMS_PREWARM") == "false" {
		return
	}
	go func() {
		warmedVersion := int64(-1)
		var warmedAt time.Time
		for {
			version := woDataVersion.Load()
			// Wait for a burst of sync writes to settle before recomputing.
			quiet := time.Since(time.Unix(0, woLastInvalidated.Load())) > 45*time.Second
			expiring := time.Since(warmedAt) > WorkOrderItemsCacheTTL-2*time.Minute
			if (version != warmedVersion && quiet) || expiring {
				start := time.Now()
				PrewarmWorkOrderItemViews()
				log.Printf("wo-items: default views warmed in %s", time.Since(start).Round(time.Millisecond))
				warmedVersion, warmedAt = version, time.Now()
			}
			time.Sleep(15 * time.Second)
		}
	}()
}
