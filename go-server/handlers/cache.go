package handlers

import (
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"

	"shipyard/db"
)

func GetCacheData(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		http.Error(w, "ID required", http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	// Try Redis First
	if db.RDB != nil {
		cacheKey := "cache:" + id
		val, err := db.RDB.Get(db.Ctx, cacheKey).Result()
		if err == nil && val != "" {
			var lastSync sql.NullString
			db.QueryRow("SELECT last_sync FROM sync_configs WHERE id = ?", id).Scan(&lastSync)
			syncTime := ""
			if lastSync.Valid {
				syncTime = lastSync.String
			}
			responseJson := `{"last_sync": "` + syncTime + `", "data": ` + val + `}`
			w.Write([]byte(responseJson))
			return
		}
	}

	// Fallback to SQLite/PostgreSQL
	var lastResponse string
	var lastSync sql.NullString
	err := db.QueryRow("SELECT COALESCE(last_response, ''), last_sync FROM sync_configs WHERE id = ?", id).Scan(&lastResponse, &lastSync)
	if err != nil {
		if err == sql.ErrNoRows {
			http.Error(w, "Not found", http.StatusNotFound)
		} else {
			http.Error(w, "DB error: "+err.Error(), http.StatusInternalServerError)
		}
		return
	}

	if lastResponse == "" {
		lastResponse = "[]"
	}
	
	syncTime := ""
	if lastSync.Valid {
		syncTime = lastSync.String
	}

	// Buat struktur JSON manual agar sangat cepat (tanpa marshal ulang data raksasa)
	responseJson := `{"last_sync": "` + syncTime + `", "data": ` + lastResponse + `}`
	w.Write([]byte(responseJson))
}
