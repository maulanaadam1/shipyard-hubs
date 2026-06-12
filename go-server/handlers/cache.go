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
			w.Write([]byte(val))
			return
		}
	}

	// Fallback to SQLite/PostgreSQL
	var lastResponse string
	err := db.DB.QueryRow("SELECT IFNULL(last_response, '') FROM sync_configs WHERE id = ?", id).Scan(&lastResponse)
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
	w.Write([]byte(lastResponse))
}
