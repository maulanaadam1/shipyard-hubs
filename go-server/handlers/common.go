package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"shipyard/db"
)

// writeJSON sends a JSON response with the given status code
func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

// scanRowsToMaps converts sql.Rows into a slice of map[string]any
func scanRowsToMaps(rows *sql.Rows) ([]map[string]any, error) {
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	var results []map[string]any
	for rows.Next() {
		values := make([]any, len(cols))
		valuePtrs := make([]any, len(cols))
		for i := range values {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			return nil, err
		}

		row := make(map[string]any)
		for i, col := range cols {
			val := values[i]
			// modernc/sqlite returns []byte for TEXT in some cases
			if b, ok := val.([]byte); ok {
				val = string(b)
			}
			row[col] = val
		}
		results = append(results, row)
	}
	return results, rows.Err()
}

// parseJSONFields parses stored JSON strings back into objects for fields like items, approval_steps
func parseJSONFields(row map[string]any) {
	jsonCols := []string{"items", "approval_steps"}
	for _, col := range jsonCols {
		if v, ok := row[col]; ok {
			if s, ok := v.(string); ok && s != "" && s != "null" {
				var parsed any
				if err := json.Unmarshal([]byte(s), &parsed); err == nil {
					row[col] = parsed
				}
			}
		}
	}
}

// stringifyJSONFields converts objects/arrays into JSON strings before storing
func stringifyJSONFields(row map[string]any) {
	jsonCols := []string{"items", "approval_steps"}
	for _, col := range jsonCols {
		if v, ok := row[col]; ok && v != nil {
			if _, isStr := v.(string); !isStr {
				b, err := json.Marshal(v)
				if err == nil {
					row[col] = string(b)
				}
			}
		}
	}
}

// fetchRow retrieves a single row from a table by its primary key
func fetchRow(table, pkCol string, pkVal any) (map[string]any, error) {
	rows, err := db.DB.Query(
		"SELECT * FROM "+table+" WHERE "+pkCol+" = ?",
		pkVal,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results, err := scanRowsToMaps(rows)
	if err != nil || len(results) == 0 {
		return nil, err
	}
	parseJSONFields(results[0])
	return results[0], nil
}
