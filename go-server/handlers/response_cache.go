package handlers

import (
	"bytes"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
	"time"
)

// Short-lived cache for the Work Order dashboard read endpoints. Their answers
// depend only on the URL (not on the user), are the same for every viewer, and
// are expensive when the database is far away. Entries expire after the TTL
// and are dropped as soon as this process writes WO data
// (InvalidateWorkOrderCache); writes by another instance are picked up within
// the TTL.

type cachedResponse struct {
	body        []byte
	contentType string
	at          time.Time
	version     int64
}

const maxCachedResponses = 500

var (
	woDataVersion     atomic.Int64
	woLastInvalidated atomic.Int64 // unix nanos of the last InvalidateWorkOrderCache
	woCache           = struct {
		sync.Mutex
		entries map[string]cachedResponse
	}{entries: map[string]cachedResponse{}}
)

// InvalidateWorkOrderCache marks every cached WO dashboard response as stale.
func InvalidateWorkOrderCache() {
	woLastInvalidated.Store(time.Now().UnixNano())
	woDataVersion.Add(1)
}

// cacheKey ignores the order of query parameters, so a page and the pre-warmer
// (wo_items_prewarm.go) share entries however each builds its URL.
func cacheKey(path string, q url.Values) string {
	return path + "?" + q.Encode()
}

func storeCachedResponse(key string, body []byte, contentType string, version int64) {
	woCache.Lock()
	defer woCache.Unlock()
	if len(woCache.entries) >= maxCachedResponses {
		woCache.entries = map[string]cachedResponse{}
	}
	woCache.entries[key] = cachedResponse{body: body, contentType: contentType, at: time.Now(), version: version}
}

type recordingWriter struct {
	http.ResponseWriter
	status int
	buf    bytes.Buffer
}

func (rw *recordingWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *recordingWriter) Write(b []byte) (int, error) {
	rw.buf.Write(b)
	return rw.ResponseWriter.Write(b)
}

// CacheWorkOrderReads caches successful GET responses keyed by path and query.
func CacheWorkOrderReads(ttl time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet {
				next.ServeHTTP(w, r)
				return
			}
			key := cacheKey(r.URL.Path, r.URL.Query())
			version := woDataVersion.Load()

			woCache.Lock()
			entry, ok := woCache.entries[key]
			woCache.Unlock()
			if ok && entry.version == version && time.Since(entry.at) < ttl {
				w.Header().Set("Content-Type", entry.contentType)
				w.Header().Set("X-Cache", "HIT")
				w.Write(entry.body)
				return
			}

			w.Header().Set("X-Cache", "MISS")
			rec := &recordingWriter{ResponseWriter: w, status: http.StatusOK}
			next.ServeHTTP(rec, r)
			if rec.status != http.StatusOK {
				return
			}

			storeCachedResponse(key, rec.buf.Bytes(), w.Header().Get("Content-Type"), version)
		})
	}
}
