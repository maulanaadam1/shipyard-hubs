package handlers

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"shipyard/db"
)

// ExportCSV handles GET /api/export/:table.csv
func ExportCSV(w http.ResponseWriter, r *http.Request) {
	table := chi.URLParam(r, "table")
	if !allowedTables[table] {
		writeJSON(w, 403, map[string]string{"error": "Table not allowed"})
		return
	}

	query := "SELECT * FROM " + table
	orderBy := defaultOrderCol(table)
	if orderBy != "" {
		query += " ORDER BY " + orderBy + " DESC"
	}

	rows, err := db.DB.Query(query)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	filename := fmt.Sprintf("%s_export_%s.csv", table, time.Now().Format("20060102_150405"))
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))

	writer := csv.NewWriter(w)
	defer writer.Flush()

	// Write header row
	if err := writer.Write(cols); err != nil {
		return
	}

	// Write data rows
	for rows.Next() {
		values := make([]any, len(cols))
		valuePtrs := make([]any, len(cols))
		for i := range values {
			valuePtrs[i] = &values[i]
		}
		if err := rows.Scan(valuePtrs...); err != nil {
			continue
		}

		row := make([]string, len(cols))
		for i, val := range values {
			switch v := val.(type) {
			case nil:
				row[i] = ""
			case []byte:
				row[i] = string(v)
			default:
				row[i] = fmt.Sprintf("%v", v)
			}
		}
		writer.Write(row)
	}
}

// ExportJSON handles GET /api/export/:table.json
func ExportJSON(w http.ResponseWriter, r *http.Request) {
	table := chi.URLParam(r, "table")
	if !allowedTables[table] {
		writeJSON(w, 403, map[string]string{"error": "Table not allowed"})
		return
	}

	query := "SELECT * FROM " + table
	orderBy := defaultOrderCol(table)
	if orderBy != "" {
		query += " ORDER BY " + orderBy + " DESC"
	}

	rows, err := db.DB.Query(query)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer rows.Close()

	results, err := scanRowsToMaps(rows)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	for _, row := range results {
		parseJSONFields(row)
	}

	if results == nil {
		results = []map[string]any{}
	}

	filename := fmt.Sprintf("%s_export_%s.json", table, time.Now().Format("20060102_150405"))
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%s", filename))
	json.NewEncoder(w).Encode(results)
}

// ImportCSV handles POST /api/import/:table with CSV body
func ImportCSV(w http.ResponseWriter, r *http.Request) {
	table := chi.URLParam(r, "table")
	if !allowedTables[table] {
		writeJSON(w, 403, map[string]string{"error": "Table not allowed"})
		return
	}

	// Parse multipart form - max 32MB
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeJSON(w, 400, map[string]string{"error": "Failed to parse form"})
		return
	}

	file, _, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "No file uploaded. Use multipart field 'file'"})
		return
	}
	defer file.Close()

	reader := csv.NewReader(file)
	records, err := reader.ReadAll()
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "Invalid CSV: " + err.Error()})
		return
	}

	if len(records) < 2 {
		writeJSON(w, 400, map[string]string{"error": "CSV must have at least a header row and one data row"})
		return
	}

	headers := records[0]
	pkCol := getPKCol(table)

	tx, err := db.DB.Begin()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "Failed to start transaction"})
		return
	}
	defer tx.Rollback()

	inserted := 0
	skipped := 0
	errors := []string{}

	for rowIdx, record := range records[1:] {
		if len(record) != len(headers) {
			errors = append(errors, fmt.Sprintf("Row %d: column count mismatch", rowIdx+2))
			skipped++
			continue
		}

		row := make(map[string]any, len(headers))
		for i, h := range headers {
			val := strings.TrimSpace(record[i])
			row[strings.TrimSpace(h)] = val
		}

		// Ensure PK exists
		if pkVal, ok := row[pkCol]; !ok || pkVal == "" {
			row[pkCol] = generateUUID()
		}

		keys := make([]string, 0, len(row))
		vals := make([]any, 0, len(row))
		for k, v := range row {
			keys = append(keys, k)
			vals = append(vals, v)
		}

		placeholders := make([]string, len(keys))
		for i := range keys {
			placeholders[i] = "?"
		}

		// INSERT OR REPLACE to allow re-importing without duplicates
		query := fmt.Sprintf(
			"INSERT OR REPLACE INTO %s (%s) VALUES (%s)",
			table,
			strings.Join(keys, ", "),
			strings.Join(placeholders, ", "),
		)

		if _, err := tx.Exec(query, vals...); err != nil {
			errors = append(errors, fmt.Sprintf("Row %d: %s", rowIdx+2, err.Error()))
			skipped++
		} else {
			inserted++
		}
	}

	if err := tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": "Transaction commit failed: " + err.Error()})
		return
	}

	writeJSON(w, 200, map[string]any{
		"success":  true,
		"inserted": inserted,
		"skipped":  skipped,
		"errors":   errors,
		"total":    len(records) - 1,
	})
}

// GetStats handles GET /api/stats — returns aggregated dashboard stats
func GetStats(w http.ResponseWriter, r *http.Request) {
	stats := map[string]any{}

	// Equipment counts by availability
	rows, err := db.DB.Query(`
		SELECT available, COUNT(*) as count 
		FROM equipment 
		GROUP BY available
	`)
	if err == nil {
		defer rows.Close()
		equipByStatus := map[string]int{}
		totalEquip := 0
		for rows.Next() {
			var status string
			var count int
			rows.Scan(&status, &count)
			equipByStatus[status] = count
			totalEquip += count
		}
		stats["equipment"] = map[string]any{
			"total":       totalEquip,
			"by_status":   equipByStatus,
			"utilization": calcPercentage(equipByStatus["Deployed"], totalEquip),
		}
	}

	// Loan requests by status
	loanRows, err := db.DB.Query(`
		SELECT status, COUNT(*) as count 
		FROM loan_requests 
		GROUP BY status
	`)
	if err == nil {
		defer loanRows.Close()
		loanByStatus := map[string]int{}
		for loanRows.Next() {
			var status string
			var count int
			loanRows.Scan(&status, &count)
			loanByStatus[status] = count
		}
		stats["loans"] = loanByStatus
	}

	// Active deployments count
	var activeDeployments int
	db.DB.QueryRow(`SELECT COUNT(*) FROM deployment_records WHERE return_status != 'Returned' OR return_status IS NULL`).Scan(&activeDeployments)
	stats["active_deployments"] = activeDeployments

	// Projects by status
	projRows, err := db.DB.Query(`
		SELECT status, COUNT(*) as count 
		FROM projects 
		GROUP BY status
	`)
	if err == nil {
		defer projRows.Close()
		projByStatus := map[string]int{}
		for projRows.Next() {
			var status string
			var count int
			projRows.Scan(&status, &count)
			projByStatus[status] = count
		}
		stats["projects"] = projByStatus
	}

	// Utilization by equipment type
	typeRows, err := db.DB.Query(`
		SELECT type, 
			COUNT(*) as total,
			SUM(CASE WHEN available = 'Deployed' THEN 1 ELSE 0 END) as deployed,
			SUM(CASE WHEN available = 'Maintenance' THEN 1 ELSE 0 END) as maintenance,
			SUM(CASE WHEN available = 'Damaged' THEN 1 ELSE 0 END) as damaged
		FROM equipment 
		WHERE type IS NOT NULL AND type != ''
		GROUP BY type
		ORDER BY deployed DESC
	`)
	if err == nil {
		defer typeRows.Close()
		byType := []map[string]any{}
		for typeRows.Next() {
			var eType string
			var total, deployed, maintenance, damaged int
			typeRows.Scan(&eType, &total, &deployed, &maintenance, &damaged)
			byType = append(byType, map[string]any{
				"type":        eType,
				"total":       total,
				"deployed":    deployed,
				"maintenance": maintenance,
				"damaged":     damaged,
				"utilization": calcPercentage(deployed, total),
			})
		}
		stats["equipment_by_type"] = byType
	}

	writeJSON(w, 200, map[string]any{"data": stats})
}

func calcPercentage(part, total int) int {
	if total == 0 {
		return 0
	}
	return (part * 100) / total
}

func generateUUID() string {
	return uuid.New().String()
}
