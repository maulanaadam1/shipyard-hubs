package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"shipyard/db"
)

// GetProjectYearsStats returns the count of projects grouped by year
func GetProjectYearsStats(w http.ResponseWriter, r *http.Request) {
	query := "SELECT year, COUNT(*) FROM projects WHERE year IS NOT NULL AND year > 1900 GROUP BY year ORDER BY year ASC"
	rows, err := db.DB.Query(query)
	if err != nil {
		log.Printf("Error querying projects by year: %v", err)
		http.Error(w, `{"error": "Failed to fetch project stats"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	stats := make(map[string]int)
	for rows.Next() {
		var year string
		var count int
		if err := rows.Scan(&year, &count); err == nil {
			stats[year] = count
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(stats)
}
