package handlers

import (
	"context"
	"net/http"
	"os"
	"strings"
	"time"

	"shipyard/db"
)

// Maintenance mode: MAINTENANCE_MODE=1 (or true/on) in the environment makes
// every API call answer 503 with the ShipHub maintenance message, so the app
// shows its maintenance screen; pages and assets are still served.
// MAINTENANCE_MESSAGE and MAINTENANCE_UNTIL (free text, e.g. "14.00 WIB")
// fill the screen.

func maintenanceOn() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("MAINTENANCE_MODE"))) {
	case "1", "true", "on", "yes", "ya":
		return true
	}
	return false
}

func maintenanceBody() map[string]interface{} {
	return map[string]interface{}{
		"status":      "maintenance",
		"maintenance": true,
		"error":       "ShipHub sedang dalam perawatan",
		"message":     strings.TrimSpace(os.Getenv("MAINTENANCE_MESSAGE")),
		"until":       strings.TrimSpace(os.Getenv("MAINTENANCE_UNTIL")),
	}
}

// Maintenance answers API calls with 503 while maintenance mode is on; the
// health check stays reachable so the app can tell when it is over.
func Maintenance(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if maintenanceOn() && strings.HasPrefix(r.URL.Path, "/api/") && r.URL.Path != "/api/health" {
			w.Header().Set("Retry-After", "60")
			writeJSON(w, http.StatusServiceUnavailable, maintenanceBody())
			return
		}
		next.ServeHTTP(w, r)
	})
}

// GetHealth tells the app whether ShipHub can serve it: 200 when the server
// and the database answer, 503 in maintenance mode or when the database is
// unreachable. Public, no session.
func GetHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if maintenanceOn() {
		writeJSON(w, http.StatusServiceUnavailable, maintenanceBody())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if db.DB == nil || db.DB.PingContext(ctx) != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]interface{}{"status": "database", "error": "Database ShipHub tidak bisa dihubungi"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
