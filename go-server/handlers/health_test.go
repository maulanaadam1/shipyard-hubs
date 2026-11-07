package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthAndMaintenance(t *testing.T) {
	api := Maintenance(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK) }))
	call := func(h http.Handler, path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		return rec
	}

	t.Setenv("MAINTENANCE_MODE", "")
	if rec := call(http.HandlerFunc(GetHealth), "/api/health"); rec.Code != http.StatusOK {
		t.Errorf("health: %d %s", rec.Code, rec.Body.String())
	}
	if rec := call(api, "/api/work-orders"); rec.Code != http.StatusOK {
		t.Errorf("API outside maintenance: %d", rec.Code)
	}

	t.Setenv("MAINTENANCE_MODE", "1")
	t.Setenv("MAINTENANCE_MESSAGE", "Pembaruan server")
	t.Setenv("MAINTENANCE_UNTIL", "14.00 WIB")
	rec := call(api, "/api/work-orders")
	var body map[string]interface{}
	json.Unmarshal(rec.Body.Bytes(), &body)
	if rec.Code != http.StatusServiceUnavailable || body["maintenance"] != true || body["until"] != "14.00 WIB" || rec.Header().Get("Retry-After") == "" {
		t.Errorf("API in maintenance: %d %v", rec.Code, body)
	}
	// Pages and assets are still served, so the app can show the screen.
	if rec := call(api, "/dashboard"); rec.Code != http.StatusOK {
		t.Errorf("page in maintenance: %d", rec.Code)
	}
	if rec := call(api, "/api/health"); rec.Code != http.StatusOK { // passes the middleware...
		t.Errorf("health through the middleware: %d", rec.Code)
	}
	if rec := call(http.HandlerFunc(GetHealth), "/api/health"); rec.Code != http.StatusServiceUnavailable { // ...and reports maintenance
		t.Errorf("health in maintenance: %d", rec.Code)
	}
}
