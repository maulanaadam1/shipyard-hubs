package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"shipyard/db"
	"shipyard/middleware"
)

func setupAIShare(t *testing.T, enabled bool, role string, limit int) {
	t.Helper()
	os.Setenv("NEXTAUTH_SECRET", "test-secret-for-ai-share")
	for _, table := range []string{"ai_share_settings", "ai_share_guests", "ai_settings", "ai_chat_log"} {
		if _, err := db.Exec("DELETE FROM " + table); err != nil {
			t.Fatalf("clear %s: %v", table, err)
		}
	}
	enc, err := encryptSecret("sk-test-key")
	if err != nil {
		t.Fatal(err)
	}
	if err := saveAISettings(aiSettings{Provider: aiProviderAnthropic, DailyLimit: 50, Enabled: true}, &enc); err != nil {
		t.Fatal(err)
	}
	if err := saveAIShareSettings(aiShareSettings{Enabled: enabled, Role: role, DailyLimit: limit}); err != nil {
		t.Fatal(err)
	}
}

func startGuest(t *testing.T, body string) (int, string) {
	t.Helper()
	w := httptest.NewRecorder()
	PostAIShareSession(w, httptest.NewRequest("POST", "/api/ai/share/session", strings.NewReader(body)))
	var out map[string]string
	json.Unmarshal(w.Body.Bytes(), &out)
	return w.Code, out["token"]
}

func callWith(h http.Handler, token string) int {
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/x", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	h.ServeHTTP(w, r)
	return w.Code
}

var okHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) })

func TestAIShareSessionNeedsSharingOnAndAName(t *testing.T) {
	setupAIShare(t, false, "Demo", 100)
	if code, _ := startGuest(t, `{"name":"Juri Satu"}`); code != 403 {
		t.Fatalf("sharing off: got %d, want 403", code)
	}
	setupAIShare(t, true, "Demo", 100)
	if code, _ := startGuest(t, `{"name":" a "}`); code != 400 {
		t.Fatalf("one-letter name: got %d, want 400", code)
	}
	code, token := startGuest(t, `{"name":"Juri Satu","device":"Desktop · Chrome · Windows","latitude":-6.2,"longitude":106.8,"accuracy":30}`)
	if code != 200 || token == "" {
		t.Fatalf("guest session: got %d", code)
	}
	var name, device string
	var lat float64
	if err := db.QueryRow(`SELECT name, device, latitude FROM ai_share_guests`).Scan(&name, &device, &lat); err != nil {
		t.Fatal(err)
	}
	if name != "Juri Satu" || device != "Desktop · Chrome · Windows" || lat != -6.2 {
		t.Errorf("guest row = %q %q %v", name, device, lat)
	}
}

func TestAIShareGuestTokenOnlyOpensShareRoutes(t *testing.T) {
	setupAIShare(t, true, "Demo", 100)
	_, token := startGuest(t, `{"name":"Juri Dua"}`)
	if code := callWith(middleware.RequireAuth(okHandler), token); code != 401 {
		t.Errorf("guest token on a ShipHub route: got %d, want 401", code)
	}
	if code := callWith(RequireAIShareGuest(okHandler), token); code != 200 {
		t.Errorf("guest token on a share route: got %d, want 200", code)
	}
	saveAIShareSettings(aiShareSettings{Enabled: false, Role: "Demo", DailyLimit: 100})
	if code := callWith(RequireAIShareGuest(okHandler), token); code != 403 {
		t.Errorf("after sharing is switched off: got %d, want 403", code)
	}
}

func TestAIShareGuestPermissionsComeFromTheShareRole(t *testing.T) {
	guest := func(role string) *http.Request {
		r := httptest.NewRequest("GET", "/x", nil)
		return middleware.WithClaims(r, middleware.UserClaims{ID: "guest-x", Email: "guest-x@tamu.invalid", Role: role, Kind: middleware.KindAIShareGuest})
	}
	if HasResourcePermission(guest("Admin"), ResourceAIAssistant, "view") {
		t.Error("a guest must never get Admin rights")
	}
	if isAdminRequest(guest("Admin")) {
		t.Error("a guest is never an Admin request")
	}
	db.Exec(`DELETE FROM role_permissions WHERE role_id = 'role-demo-test'`)
	db.Exec(`DELETE FROM roles_master WHERE id = 'role-demo-test'`)
	db.Exec(`INSERT INTO roles_master (id, name, description) VALUES ('role-demo-test', 'DemoTest', '')`)
	db.Exec(`INSERT INTO role_permissions (id, role_id, resource, action, is_allowed) VALUES ('perm-demo-test', 'role-demo-test', ?, 'view', true)`, ResourceInventory)
	if !HasResourcePermission(guest("DemoTest"), ResourceInventory, "view") {
		t.Error("the share role's permission should apply")
	}
	if HasResourcePermission(guest("DemoTest"), ResourceItemFindings, "view") {
		t.Error("a resource the share role lacks must be denied")
	}
}

func TestAIShareQuotaCountsAllGuests(t *testing.T) {
	setupAIShare(t, true, "Demo", 2)
	today := time.Now().Format("2006-01-02 15:04:05")
	db.Exec(`INSERT INTO ai_chat_log (id, user_id, created_at) VALUES ('l1', 'guest-a', ?), ('l2', 'guest-b', ?), ('l3', 'staff-1', ?)`, today, today, today)
	w := httptest.NewRecorder()
	AIShareQuota(okHandler).ServeHTTP(w, httptest.NewRequest("POST", "/x", nil))
	if w.Code != 429 {
		t.Errorf("limit reached by two guests: got %d, want 429", w.Code)
	}
	saveAIShareSettings(aiShareSettings{Enabled: true, Role: "Demo", DailyLimit: 3})
	w = httptest.NewRecorder()
	AIShareQuota(okHandler).ServeHTTP(w, httptest.NewRequest("POST", "/x", nil))
	if w.Code != 200 {
		t.Errorf("staff questions must not count: got %d, want 200", w.Code)
	}
}
