package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"shipyard/db"
	"shipyard/middleware"
)

// Public AI Asisten share page (/ai-assistant/share) for demos without a
// ShipHub account. A visitor types a name and gets a guest token; the token
// only opens the /api/ai/share/* routes, its history is its own (the guest id
// is the conversation owner), and the data it can read is the role chosen in
// Pengaturan AI. Admins switch the page on and off; switching it off cuts
// every guest off at once.

const aiShareGuestPrefix = "guest-"

type aiShareSettings struct {
	Enabled    bool   `json:"enabled"`
	Role       string `json:"role"`
	DailyLimit int    `json:"daily_limit"` // all guests together; 0 = no limit
	UpdatedBy  string `json:"updated_by"`
	UpdatedAt  string `json:"updated_at"`
}

func loadAIShareSettings() aiShareSettings {
	s := aiShareSettings{Role: "Demo", DailyLimit: 100}
	db.QueryRow(`SELECT COALESCE(enabled, false), COALESCE(role, 'Demo'), COALESCE(daily_limit, 100), COALESCE(updated_by, ''), COALESCE(updated_at, '')
		FROM ai_share_settings WHERE id = 'default'`).Scan(&s.Enabled, &s.Role, &s.DailyLimit, &s.UpdatedBy, &s.UpdatedAt)
	return s
}

func saveAIShareSettings(s aiShareSettings) error {
	var exists int
	db.QueryRow(`SELECT COUNT(*) FROM ai_share_settings WHERE id = 'default'`).Scan(&exists)
	now := time.Now().Format("2006-01-02 15:04:05")
	if exists == 0 {
		_, err := db.Exec(`INSERT INTO ai_share_settings (id, enabled, role, daily_limit, updated_by, updated_at) VALUES ('default', ?, ?, ?, ?, ?)`,
			s.Enabled, s.Role, s.DailyLimit, s.UpdatedBy, now)
		return err
	}
	_, err := db.Exec(`UPDATE ai_share_settings SET enabled = ?, role = ?, daily_limit = ?, updated_by = ?, updated_at = ? WHERE id = 'default'`,
		s.Enabled, s.Role, s.DailyLimit, s.UpdatedBy, now)
	return err
}

func aiShareUsedToday() int {
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM ai_chat_log WHERE user_id LIKE ? AND created_at >= ?`, aiShareGuestPrefix+"%", time.Now().Format("2006-01-02")).Scan(&n)
	return n
}

func aiShareView(s aiShareSettings) map[string]interface{} {
	roles := []string{} // roles a guest may use (every role but Admin)
	roleExists := false
	if rows, err := db.Query(`SELECT COALESCE(name, '') FROM roles_master ORDER BY name`); err == nil {
		for rows.Next() {
			var n string
			if rows.Scan(&n) == nil && n != "" && !strings.EqualFold(n, "Admin") {
				roles = append(roles, n)
				roleExists = roleExists || n == s.Role
			}
		}
		rows.Close()
	}
	return map[string]interface{}{
		"enabled": s.Enabled, "role": s.Role, "daily_limit": s.DailyLimit, "updated_by": s.UpdatedBy, "updated_at": s.UpdatedAt,
		"role_exists": roleExists, "roles": roles, "used_today": aiShareUsedToday(),
	}
}

// GetAIShareSettings: the share switch, role and limit, for Pengaturan AI.
func GetAIShareSettings(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, aiShareView(loadAIShareSettings()))
}

// PutAIShareSettings saves the share switch, role and limit.
func PutAIShareSettings(w http.ResponseWriter, r *http.Request) {
	var in aiShareSettings
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, 400, map[string]string{"error": "data pengaturan tidak valid"})
		return
	}
	in.Role = strings.TrimSpace(in.Role)
	switch {
	case in.Role == "":
		writeJSON(w, 400, map[string]string{"error": "pilih role untuk tamu"})
		return
	case strings.EqualFold(in.Role, "Admin"):
		writeJSON(w, 400, map[string]string{"error": "tamu tidak boleh memakai role Admin"})
		return
	case in.DailyLimit < 0 || in.DailyLimit > 10000:
		writeJSON(w, 400, map[string]string{"error": "batas pertanyaan tamu per hari antara 0 (tanpa batas) dan 10000"})
		return
	}
	in.UpdatedBy = ""
	if claims, ok := middleware.GetUserClaims(r); ok {
		in.UpdatedBy = claims.Email
	}
	if err := saveAIShareSettings(in); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, 200, aiShareView(loadAIShareSettings()))
}

// GetAIShareGuests lists the latest guests with their question counts.
func GetAIShareGuests(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query(`SELECT g.id, COALESCE(g.name, ''), COALESCE(g.device, ''), g.latitude, g.longitude, g.location_accuracy,
			COALESCE(g.created_at, ''), COALESCE(g.last_seen, ''),
			(SELECT COUNT(*) FROM ai_chat_log l WHERE l.user_id = g.id)
		FROM ai_share_guests g ORDER BY g.created_at DESC LIMIT 200`)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()
	guests := []map[string]interface{}{}
	for rows.Next() {
		var id, name, device, created, seen string
		var lat, lng, acc sql.NullFloat64
		var questions int
		if rows.Scan(&id, &name, &device, &lat, &lng, &acc, &created, &seen, &questions) != nil {
			continue
		}
		g := map[string]interface{}{"id": id, "name": name, "device": device, "created_at": created, "last_seen": seen, "questions": questions}
		if lat.Valid && lng.Valid {
			g["latitude"], g["longitude"] = lat.Float64, lng.Float64
			if acc.Valid {
				g["location_accuracy"] = acc.Float64
			}
		}
		guests = append(guests, g)
	}
	writeJSON(w, 200, map[string]interface{}{"guests": guests})
}

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	for utf8.RuneCountInString(s) > n {
		_, size := utf8.DecodeLastRuneInString(s)
		s = s[:len(s)-size]
	}
	return s
}

// PostAIShareSession starts a guest: public, works only while sharing is on.
func PostAIShareSession(w http.ResponseWriter, r *http.Request) {
	s := loadAIShareSettings()
	if _, ready := aiConfig(); !s.Enabled || !ready {
		writeJSON(w, 403, map[string]string{"error": "Akses demo AI Asisten sedang ditutup."})
		return
	}
	var in struct {
		Name      string   `json:"name"`
		Device    string   `json:"device"`
		Latitude  *float64 `json:"latitude"`
		Longitude *float64 `json:"longitude"`
		Accuracy  *float64 `json:"accuracy"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&in); err != nil {
		writeJSON(w, 400, map[string]string{"error": "data tidak valid"})
		return
	}
	name := clip(in.Name, 60)
	if utf8.RuneCountInString(name) < 2 {
		writeJSON(w, 400, map[string]string{"error": "Isi nama Anda (minimal 2 huruf)."})
		return
	}
	var lat, lng, acc interface{}
	if in.Latitude != nil && in.Longitude != nil && *in.Latitude >= -90 && *in.Latitude <= 90 && *in.Longitude >= -180 && *in.Longitude <= 180 {
		lat, lng = *in.Latitude, *in.Longitude
		if in.Accuracy != nil && *in.Accuracy >= 0 {
			acc = *in.Accuracy
		}
	}
	id := aiShareGuestPrefix + uuid.NewString()
	now := time.Now().Format("2006-01-02 15:04:05")
	if _, err := db.Exec(`INSERT INTO ai_share_guests (id, name, device, user_agent, latitude, longitude, location_accuracy, created_at, last_seen)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, name, clip(in.Device, 120), clip(r.UserAgent(), 400), lat, lng, acc, now, now); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"id": id, "email": id + "@tamu.invalid", "name": name, "kind": middleware.KindAIShareGuest,
		"exp": time.Now().Add(30 * 24 * time.Hour).Unix(),
	})
	tokenStr, err := token.SignedString(middleware.JWTSecret())
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "gagal membuat sesi tamu"})
		return
	}
	writeJSON(w, 200, map[string]string{"token": tokenStr, "name": name})
}

// RequireAIShareGuest admits guest tokens of the share page while sharing is
// on, and gives them the share role from the current settings.
func RequireAIShareGuest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims, ok := middleware.ParseBearer(r)
		if !ok || claims.Kind != middleware.KindAIShareGuest || !strings.HasPrefix(claims.ID, aiShareGuestPrefix) {
			writeJSON(w, 401, map[string]string{"error": "Sesi tamu tidak valid. Muat ulang halaman."})
			return
		}
		s := loadAIShareSettings()
		if !s.Enabled {
			writeJSON(w, 403, map[string]string{"error": "Akses demo AI Asisten sedang ditutup."})
			return
		}
		var exists int
		db.QueryRow(`SELECT COUNT(*) FROM ai_share_guests WHERE id = ?`, claims.ID).Scan(&exists)
		if exists == 0 {
			writeJSON(w, 401, map[string]string{"error": "Sesi tamu tidak valid. Muat ulang halaman."})
			return
		}
		claims.Role = s.Role
		next.ServeHTTP(w, middleware.WithClaims(r, claims))
	})
}

// AIShareQuota stops guest questions once all guests together reach the
// daily limit, and records when the guest was last active.
func AIShareQuota(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if limit := loadAIShareSettings().DailyLimit; limit > 0 && aiShareUsedToday() >= limit {
			writeJSON(w, 429, map[string]string{"error": "Kuota pertanyaan demo hari ini sudah habis. Coba lagi besok."})
			return
		}
		if claims, ok := middleware.GetUserClaims(r); ok {
			db.Exec(`UPDATE ai_share_guests SET last_seen = ? WHERE id = ?`, time.Now().Format("2006-01-02 15:04:05"), claims.ID)
		}
		next.ServeHTTP(w, r)
	})
}
