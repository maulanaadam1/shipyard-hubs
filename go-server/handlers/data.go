package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"shipyard/db"
	"shipyard/middleware"
	"golang.org/x/crypto/bcrypt"
)

// allowedTables is the whitelist of tables that can be accessed via the generic API
var allowedTables = map[string]bool{
	"equipment":          true,
	"loan_requests":      true,
	"deployment_records": true,
	"vendors":            true,
	"companies":          true,
	"ships":              true,
	"projects":           true,
	"profiles":           true,
	"dropdown_configs":   true,
	"roles_master":       true,
	"role_permissions":   true,
	"equipment_release":  true,
	"approval_workflow":  true,
	"notifications":      true,
	"master_locations":   true,
	"ship_movements":     true,
	"master_status_dock": true,
	"vessel_layouts":     true,
	"sync_configs":       true,
	"master_services":    true,
	"master_employees":   true,
	"master_components":  true,
}

// getPKCol returns the primary key column name for a given table
func getPKCol(table string) string {
	if table == "deployment_records" {
		return "unique_id"
	}
	return "id"
}

// tableToResource maps database tables to UI resource names for RBAC checks
var tableToResource = map[string]string{
	"equipment":          "Master Equipment",
	"loan_requests":      "Request",
	"deployment_records": "Utility",
	"vendors":            "Master Vendor",
	"companies":          "Master Company",
	"ships":              "Master Kapal",
	"projects":           "Job Order",
	"profiles":           "User Management",
	"dropdown_configs":   "Master Configuration",
	"roles_master":       "Role Management",
	"role_permissions":   "Role Management",
	"equipment_release":  "Release",
	"approval_workflow":  "Master Workflow",
	"notifications":      "Dashboard",
	"master_locations":   "Master Location",
	"ship_movements":     "Ship Docking",
	"master_status_dock": "Master Dock Status",
	"vessel_layouts":     "Master Layout",
	"sync_configs":       "Master Configuration",
	"master_services":    "Utility",
	"master_employees":   "User Management",
	"master_components":  "Master Component",
}

// CheckTablePermission verifies if the user from context has permission for table and action
func CheckTablePermission(r *http.Request, table string, action string) bool {
	// Get claims from context
	claims, ok := middleware.GetUserClaims(r)
	if !ok {
		return false
	}
	
	// Re-parse role from DB to be sure
	var dbRole, dbRoles, dbExtraRoles string
	err := db.DB.QueryRow(
		"SELECT role, roles, extra_roles FROM profiles WHERE id = ? OR email = ?",
		claims.ID, claims.Email,
	).Scan(&dbRole, &dbRoles, &dbExtraRoles)
	
	if err != nil {
		// Fallback to claims if DB fetch fails
		dbRole = claims.Role
	}

	if dbRole == "Admin" {
		return true
	}

	// Special case: anyone can add notifications (send them)
	if table == "notifications" && action == "add" {
		return true
	}

	resource := tableToResource[table]
	if resource == "" {
		return false // Default deny for unknown tables
	}

	// Check Extra Roles (direct overrides)
	extras := strings.Split(dbExtraRoles, ",")
	for _, e := range extras {
		e = strings.TrimSpace(e)
		if e == resource || e == resource+":"+action {
			return true
		}
	}

	// Check Roles via role_permissions
	userRoles := strings.Split(dbRoles, ",")
	for _, roleName := range userRoles {
		roleName = strings.TrimSpace(roleName)
		if roleName == "" {
			continue
		}

		var allowed bool
		err := db.DB.QueryRow(`
			SELECT is_allowed FROM role_permissions p
			JOIN roles_master r ON p.role_id = r.id
			WHERE r.name = ? AND p.resource = ? AND (p.action = ? OR p.action = '*')
		`, roleName, resource, action).Scan(&allowed)

		if err == nil && allowed {
			return true
		}
	}

	return false
}

// defaultOrderCol returns the default sort column for a given table
func defaultOrderCol(table string) string {
	switch table {
	case "equipment":
		return "created_at"
	case "loan_requests":
		return "date_created"
	case "deployment_records", "projects", "ship_movements":
		return "create_date"
	case "notifications":
		return "created_at"
	case "master_status_dock":
		return "name"
	default:
		return ""
	}
}

// GetData handles GET /api/data/:table
func GetData(w http.ResponseWriter, r *http.Request) {
	table := chi.URLParam(r, "table")
	if !allowedTables[table] {
		writeJSON(w, 403, map[string]string{"error": "Table not allowed"})
		return
	}

	query := "SELECT * FROM " + table
	args := []any{}

	// --- Build WHERE clause from query params ---
	// Supports: ?filter_col=user_id&filter_val=<value>
	// For notifications table: ALWAYS enforce user_id = current user (security)
	if table == "notifications" {
		// Mandatory: only return notifications for the authenticated user
		claims, ok := middleware.GetUserClaims(r)
		if !ok {
			writeJSON(w, 401, map[string]string{"error": "Unauthorized"})
			return
		}
		query += " WHERE user_id = ?"
		args = append(args, claims.ID)
	} else {
		// Generic filter from query params (e.g. eq('column', 'value'))
		filterCol := r.URL.Query().Get("filter_col")
		filterVal := r.URL.Query().Get("filter_val")
		if filterCol != "" && filterVal != "" {
			query += fmt.Sprintf(" WHERE %s = ?", filterCol)
			args = append(args, filterVal)
		} else {
			// Also check for direct column filters (e.g. ?unique_id=...)
			for col, vals := range r.URL.Query() {
				if col == "order" || col == "ascending" || col == "filter_col" || col == "filter_val" {
					continue
				}
				// Basic whitelist for security
				allowed := map[string]bool{
					"id": true, "unique_id": true, "request_id": true, "user_id": true, 
					"status": true, "type": true, "pic": true, "category": true,
				}
				if allowed[col] {
					if len(args) == 0 {
						query += " WHERE " + col + " = ?"
					} else {
						query += " AND " + col + " = ?"
					}
					args = append(args, vals[0])
				}
			}
		}
	}

	orderBy := r.URL.Query().Get("order")
	if orderBy == "" {
		orderBy = defaultOrderCol(table)
	}
	if orderBy != "" {
		dir := "DESC"
		if r.URL.Query().Get("ascending") == "true" {
			dir = "ASC"
		}
		query += fmt.Sprintf(" ORDER BY %s %s", orderBy, dir)
	}

	rows, err := db.DB.Query(query, args...)
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

	writeJSON(w, 200, map[string]any{"data": results})
}

// PostData handles POST /api/data/:table (insert or upsert)
func PostData(w http.ResponseWriter, r *http.Request) {
	table := chi.URLParam(r, "table")
	if !allowedTables[table] {
		writeJSON(w, 403, map[string]string{"error": "Table not allowed"})
		return
	}

	if !CheckTablePermission(r, table, "add") {
		writeJSON(w, 403, map[string]string{"error": "Forbidden: insufficient permissions for this resource"})
		return
	}

	isUpsert := r.URL.Query().Get("upsert") == "true"
	pkCol := getPKCol(table)
	if onConflict := r.URL.Query().Get("on_conflict"); onConflict != "" {
		pkCol = onConflict
	}

	// Body can be a single object or an array of objects
	var rawBody json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&rawBody); err != nil {
		writeJSON(w, 400, map[string]string{"error": "Invalid JSON body"})
		return
	}

	var items []map[string]any
	isArray := len(rawBody) > 0 && rawBody[0] == '['

	if isArray {
		if err := json.Unmarshal(rawBody, &items); err != nil {
			writeJSON(w, 400, map[string]string{"error": "Invalid JSON array"})
			return
		}
	} else {
		var single map[string]any
		if err := json.Unmarshal(rawBody, &single); err != nil {
			writeJSON(w, 400, map[string]string{"error": "Invalid JSON object"})
			return
		}
		items = []map[string]any{single}
	}

	var resultData []map[string]any

	for _, item := range items {
		// Stringify JSON fields before storing
		stringifyJSONFields(item)

		// Ensure primary key exists
		if pkVal, ok := item[pkCol]; !ok || pkVal == nil || pkVal == "" {
			item[pkCol] = uuid.New().String()
		}

		// Check if row already exists (for upsert)
		existing := false
		if isUpsert {
			var count int
			err := db.DB.QueryRow(
				fmt.Sprintf("SELECT COUNT(*) FROM %s WHERE %s = ?", table, pkCol),
				item[pkCol],
			).Scan(&count)
			existing = err == nil && count > 0
		}

		var execErr error
		if existing && isUpsert {
			// Hash password if updating profiles
			if table == "profiles" {
				if pw, ok := item["password"].(string); ok && pw != "" && !strings.HasPrefix(pw, "$2a$") {
					hashed, _ := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
					item["password"] = string(hashed)
				}
			}

			// UPDATE existing record
			keys := make([]string, 0, len(item))
			vals := make([]any, 0, len(item))
			for k, v := range item {
				if k != pkCol {
					keys = append(keys, k)
					vals = append(vals, v)
				}
			}
			sets := make([]string, len(keys))
			for i, k := range keys {
				sets[i] = k + " = ?"
			}
			vals = append(vals, item[pkCol])
			query := fmt.Sprintf("UPDATE %s SET %s WHERE %s = ?", table, strings.Join(sets, ", "), pkCol)
			_, execErr = db.DB.Exec(query, vals...)
		} else {
			// Hash password if inserting into profiles
			if table == "profiles" {
				if pw, ok := item["password"].(string); ok && pw != "" {
					hashed, _ := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
					item["password"] = string(hashed)
				}
			}

			// INSERT new record
			keys := make([]string, 0, len(item))
			vals := make([]any, 0, len(item))
			for k, v := range item {
				keys = append(keys, k)
				vals = append(vals, v)
			}
			placeholders := make([]string, len(keys))
			for i := range keys {
				placeholders[i] = "?"
			}
			query := fmt.Sprintf(
				"INSERT INTO %s (%s) VALUES (%s)",
				table,
				strings.Join(keys, ", "),
				strings.Join(placeholders, ", "),
			)
			_, execErr = db.DB.Exec(query, vals...)
		}

		if execErr != nil {
			log.Printf("[DB ERROR] Table %s: %v", table, execErr)
			writeJSON(w, 500, map[string]string{"error": fmt.Sprintf("Database error on table %s: %v", table, execErr)})
			return
		}

		// Fetch and return the saved record
		saved, err := fetchRow(table, pkCol, item[pkCol])
		if err != nil || saved == nil {
			// Fall back to returning the input item
			parseJSONFields(item)
			resultData = append(resultData, item)
		} else {
			resultData = append(resultData, saved)
		}
	}

	var returning any
	if isArray {
		returning = resultData
	} else {
		if len(resultData) > 0 {
			returning = resultData[0]
		}
	}

	writeJSON(w, 201, map[string]any{"data": returning, "error": nil})
}

// PutData handles PUT /api/data/:table
func PutData(w http.ResponseWriter, r *http.Request) {
	table := chi.URLParam(r, "table")
	if !allowedTables[table] {
		writeJSON(w, 403, map[string]string{"error": "Table not allowed"})
		return
	}

	if !CheckTablePermission(r, table, "edit") {
		writeJSON(w, 403, map[string]string{"error": "Forbidden: insufficient permissions for this resource"})
		return
	}

	pkCol := getPKCol(table)

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "Invalid JSON body"})
		return
	}

	// Identify which rows to update
	q := r.URL.Query()
	var conditions []string
	var params []any

	// 1. Check for single ID in query or body
	id := q.Get("id")
	if id == "" {
		if v, ok := body[pkCol]; ok {
			id = fmt.Sprintf("%v", v)
		}
	}
	if id != "" {
		conditions = append(conditions, fmt.Sprintf("%s = ?", pkCol))
		params = append(params, id)
	}

	// 2. Check for 'IN' clause (bulk update)
	if inStr := q.Get("in"); inStr != "" {
		ids := strings.Split(inStr, ",")
		var inPlaceholders []string
		for _, rowID := range ids {
			inPlaceholders = append(inPlaceholders, "?")
			params = append(params, strings.TrimSpace(rowID))
		}
		conditions = append(conditions, fmt.Sprintf("%s IN (%s)", pkCol, strings.Join(inPlaceholders, ", ")))
	}

	// 3. Check for generic filters
	filterCol := q.Get("filter_col")
	filterVal := q.Get("filter_val")
	if filterCol != "" && filterVal != "" {
		conditions = append(conditions, fmt.Sprintf("%s = ?", filterCol))
		params = append(params, filterVal)
	}

	// 4. Check for direct column filters in query (e.g. ?unique_id=...)
	for col, vals := range q {
		if col == "id" || col == "in" || col == "filter_col" || col == "filter_val" {
			continue
		}
		allowed := map[string]bool{"unique_id": true, "id": true, "request_id": true}
		if allowed[col] {
			conditions = append(conditions, fmt.Sprintf("%s = ?", col))
			params = append(params, vals[0])
		}
	}

	if len(conditions) == 0 {
		writeJSON(w, 400, map[string]string{"error": "ID or filter required for PUT"})
		return
	}

	stringifyJSONFields(body)

	// Hash password if updating profiles
	if table == "profiles" {
		if pw, ok := body["password"].(string); ok && pw != "" && !strings.HasPrefix(pw, "$2a$") {
			hashed, _ := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
			body["password"] = string(hashed)
		}
	}

	// Build the SET clause
	keys := make([]string, 0, len(body))
	setVals := make([]any, 0, len(body))
	for k, v := range body {
		if k != pkCol {
			keys = append(keys, k)
			setVals = append(setVals, v)
		}
	}

	if len(keys) > 0 {
		sets := make([]string, len(keys))
		for i, k := range keys {
			sets[i] = k + " = ?"
		}
		
		whereClause := strings.Join(conditions, " OR ")
		if len(conditions) > 1 {
			whereClause = strings.Join(conditions, " AND ")
		}

		query := fmt.Sprintf("UPDATE %s SET %s WHERE %s", table, strings.Join(sets, ", "), whereClause)
		finalParams := append(setVals, params...)
		
		if _, err := db.DB.Exec(query, finalParams...); err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
	}

	// If it was a single ID update, return the updated record
	if id != "" {
		result, err := fetchRow(table, pkCol, id)
		if err == nil {
			writeJSON(w, 200, map[string]any{"data": result, "error": nil})
			return
		}
	}

	writeJSON(w, 200, map[string]any{"data": map[string]any{"success": true}, "error": nil})
}

// DeleteData handles DELETE /api/data/:table
func DeleteData(w http.ResponseWriter, r *http.Request) {
	table := chi.URLParam(r, "table")
	if !allowedTables[table] {
		writeJSON(w, 403, map[string]string{"error": "Table not allowed"})
		return
	}

	if !CheckTablePermission(r, table, "delete") {
		writeJSON(w, 403, map[string]string{"error": "Forbidden: insufficient permissions for this resource"})
		return
	}

	pkCol := getPKCol(table)
	q := r.URL.Query()

	var conditions []string
	var params []any

	for col, values := range q {
		if col == "in" || col == "in_col" || col == "order" || col == "ascending" {
			continue
		}
		
		if col == "id" && values[0] == "all" {
			conditions = []string{"1=1"}
			params = []any{}
			break
		}

		// Map 'id' parameter to the actual primary key column if it's not named 'id'
		actualCol := col
		if col == "id" {
			actualCol = pkCol
		}

		conditions = append(conditions, fmt.Sprintf("%s = ?", actualCol))
		params = append(params, values[0])
	}

	// Handle 'IN' clause separately
	if inStr := q.Get("in"); inStr != "" {
		ids := strings.Split(inStr, ",")
		var inPlaceholders []string
		for _, id := range ids {
			inPlaceholders = append(inPlaceholders, "?")
			params = append(params, strings.TrimSpace(id))
		}
		conditions = append(conditions, fmt.Sprintf("%s IN (%s)", pkCol, strings.Join(inPlaceholders, ", ")))
	}

	if len(conditions) == 0 {
		writeJSON(w, 400, map[string]string{"error": "At least one filter (ID, column, or 'all') required for DELETE"})
		return
	}

	whereClause := strings.Join(conditions, " AND ")

	query := fmt.Sprintf("DELETE FROM %s WHERE %s", table, whereClause)
	log.Printf("[DB] Executing: %s with params: %v", query, params)
	
	res, err := db.DB.Exec(query, params...)
	if err != nil {
		log.Printf("[DB] Delete error: %v", err)
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}

	count, _ := res.RowsAffected()
	log.Printf("[DB] Deleted %d rows from %s", count, table)
	writeJSON(w, 200, map[string]any{"data": map[string]any{"success": true, "count": count}, "error": nil})
}
