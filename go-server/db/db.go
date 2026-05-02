package db

import (
	"database/sql"
	"log"
	"os"
	"path/filepath"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

// DB is the global database connection
var DB *sql.DB

// Init initializes the SQLite database
func Init() {
	dbPath := "./shipyard.sqlite"

	// In production, prefer /data volume (Docker)
	if os.Getenv("NODE_ENV") == "production" {
		if _, err := os.Stat("/data"); err == nil {
			dbPath = "/data/shipyard.sqlite"
		}
	}

	// Override via env var
	if envPath := os.Getenv("DATABASE_PATH"); envPath != "" {
		dbPath = envPath
	}

	// Ensure directory exists
	if dir := filepath.Dir(dbPath); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Fatalf("Failed to create database directory: %v", err)
		}
	}

	var err error
	DB, err = sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(on)")
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}

	if err = DB.Ping(); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	createTables()
	seedAdmin()
	log.Printf("Database initialized: %s", dbPath)
}

func createTables() {
	schema := `
	CREATE TABLE IF NOT EXISTS profiles (
		id TEXT PRIMARY KEY,
		email TEXT UNIQUE,
		password TEXT,
		name TEXT,
		role TEXT DEFAULT 'Staff',
		jabatan TEXT,
		city TEXT,
		branch TEXT,
		department TEXT,
		whatsapp TEXT,
		avatar_url TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS equipment (
		id TEXT PRIMARY KEY,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		source TEXT, no_asset TEXT, type TEXT, brand TEXT, name TEXT,
		capacity TEXT, year_invest TEXT, available TEXT, alias TEXT, price TEXT
	);

	CREATE TABLE IF NOT EXISTS loan_requests (
		id TEXT PRIMARY KEY,
		date_created DATETIME DEFAULT CURRENT_TIMESTAMP,
		request_id TEXT, project_id TEXT, shipname TEXT, vendor TEXT,
		work_order TEXT, date_start TEXT, date_finish TEXT, duration INTEGER,
		lampiran TEXT, change TEXT, status TEXT, items TEXT, approval_steps TEXT
	);

	CREATE TABLE IF NOT EXISTS equipment_release (
		id TEXT PRIMARY KEY,
		loan_id TEXT,
		release_no TEXT,
		date_released DATETIME DEFAULT CURRENT_TIMESTAMP,
		date_finish TEXT,
		released_by TEXT,
		received_by TEXT,
		items_released TEXT,
		status TEXT,
		notes TEXT
	);

	CREATE TABLE IF NOT EXISTS vendors (
		id TEXT PRIMARY KEY, vendor TEXT, nama_pt TEXT, whatapps TEXT,
		category TEXT, jumlah_anggota INTEGER, status TEXT DEFAULT 'Active'
	);

	CREATE TABLE IF NOT EXISTS companies (
		id TEXT PRIMARY KEY, company_type TEXT, company_name TEXT, status TEXT DEFAULT 'Active'
	);

	CREATE TABLE IF NOT EXISTS ships (
		id TEXT PRIMARY KEY, type TEXT, shipname TEXT, company TEXT,
		loa REAL, breadth REAL, depth REAL, draft REAL, gt REAL, buid TEXT
	);

	CREATE TABLE IF NOT EXISTS projects (
		id_siaga INTEGER,
		create_date DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		idproject TEXT,
		shipname TEXT,
		cust_company TEXT,
		approval_status TEXT,
		m_employee_id TEXT,
		est_start TEXT,
		est_finish TEXT,
		est_docking_date TEXT,
		est_undocking_date TEXT,
		est_trial_date TEXT,
		est_arrival_date TEXT,
		est_departure_date TEXT,
		docking TEXT,
		undocking TEXT,
		act_arrival_date TEXT,
		actual_start TEXT,
		actual_finish TEXT,
		act_trial_date TEXT,
		act_departure_date TEXT,
		id TEXT PRIMARY KEY,
		no INTEGER,
		year INTEGER,
		company TEXT,
		docking_id TEXT,
		docking_type TEXT,
		type TEXT,
		width REAL,
		length REAL,
		location TEXT,
		x_coordinate REAL,
		y_coordinate REAL,
		status_dock TEXT,
		ship_visibility TEXT,
		ship_condition TEXT,
		status TEXT,
		status_comercial TEXT,
		duration_dock REAL,
		duration_project REAL,
		project_lead TEXT,
		price_contract REAL,
		cost_actual REAL,
		gross_profit REAL,
		safetyman TEXT,
		project_team TEXT,
		vendor_team TEXT,
		manpower_all INTEGER,
		manpower_in INTEGER,
		manpower_ven INTEGER,
		update_pdf TEXT,
		print TEXT
	);

	CREATE TABLE IF NOT EXISTS deployment_records (
		unique_id TEXT PRIMARY KEY,
		create_by TEXT,
		last_updated TEXT,
		request_id TEXT,
		year INTEGER,
		month INTEGER,
		item TEXT,
		product_id TEXT,
		product_name TEXT,
		code_project TEXT,
		project_name TEXT,
		shipname TEXT,
		vendor_list TEXT,
		vendor TEXT,
		start_date TEXT,
		finish_date TEXT,
		duration INTEGER,
		duration_hour REAL,
		return_date TEXT,
		return_status TEXT,
		description TEXT
	);
	`

	if _, err := DB.Exec(schema); err != nil {
		log.Fatalf("Failed to create tables: %v", err)
	}

	// Simple migrations for existing tables
	DB.Exec("ALTER TABLE companies ADD COLUMN status TEXT DEFAULT 'Active'")
	DB.Exec("ALTER TABLE vendors ADD COLUMN status TEXT DEFAULT 'Active'")
	DB.Exec("ALTER TABLE profiles ADD COLUMN jabatan TEXT")
	DB.Exec("ALTER TABLE profiles ADD COLUMN city TEXT")
	DB.Exec("ALTER TABLE profiles ADD COLUMN branch TEXT")
	DB.Exec("ALTER TABLE profiles ADD COLUMN department TEXT")
	DB.Exec("ALTER TABLE profiles ADD COLUMN whatsapp TEXT")
	DB.Exec("ALTER TABLE profiles ADD COLUMN roles TEXT")
	DB.Exec("ALTER TABLE profiles ADD COLUMN extra_roles TEXT")
	
	DB.Exec(`CREATE TABLE IF NOT EXISTS roles_master (
		id TEXT PRIMARY KEY,
		name TEXT UNIQUE,
		description TEXT
	);`)

	DB.Exec(`CREATE TABLE IF NOT EXISTS role_permissions (
		id TEXT PRIMARY KEY,
		role_id TEXT,
		resource TEXT,
		action TEXT,
		is_allowed BOOLEAN DEFAULT 0
	);`)

	seedRolesAndPermissions();

	DB.Exec(`CREATE TABLE IF NOT EXISTS dropdown_configs (
		id TEXT PRIMARY KEY,
		category TEXT,
		label TEXT,
		value TEXT,
		is_active BOOLEAN DEFAULT 1
	);`)

	seedDropdownConfigs()

	DB.Exec(`CREATE TABLE IF NOT EXISTS approval_workflow (
		id TEXT PRIMARY KEY, 
		module TEXT, 
		step_order INTEGER, 
		label TEXT, 
		role TEXT,
		jabatan TEXT,
		user_id TEXT
	);`)

	seedApprovalWorkflows()

	// Migration: add user_ids column if not exists
	DB.Exec("ALTER TABLE approval_workflow ADD COLUMN user_ids TEXT DEFAULT '[]'")
}

func seedApprovalWorkflows() {
	var count int
	DB.QueryRow("SELECT COUNT(*) FROM approval_workflow WHERE module = 'Equipment Loan'").Scan(&count)
	if count > 0 {
		return
	}

	workflows := []struct {
		Module    string
		StepOrder int
		Label     string
		Jabatan   string
	}{
		{"Equipment Loan", 1, "Staff Review", "Staff"},
		{"Equipment Loan", 2, "Supervisi Approval", "Supervisi"},
	}

	for _, w := range workflows {
		id := uuid.New().String()
		_, _ = DB.Exec(
			"INSERT INTO approval_workflow (id, module, step_order, label, jabatan) VALUES (?, ?, ?, ?, ?)",
			id, w.Module, w.StepOrder, w.Label, w.Jabatan,
		)
	}
}

func seedAdmin() {
	// Hardcode for foolproof login
	defaultEmail := "admin@shipyard.local"
	defaultPwd := "admin123"

	hashed, err := bcrypt.GenerateFromPassword([]byte(defaultPwd), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Warning: failed to hash default admin password: %v", err)
		return
	}

	var existingID string
	err = DB.QueryRow("SELECT id FROM profiles WHERE email = ?", defaultEmail).Scan(&existingID)
	
	if err == nil {
		// Admin exists, FORCE RESET the password and role to ensure it works
		_, _ = DB.Exec(
			"UPDATE profiles SET password = ?, role = 'Admin', jabatan = 'System Administrator' WHERE id = ?",
			string(hashed), existingID,
		)
		log.Printf("Admin account reset guaranteed: %s", defaultEmail)
		return
	}

	// Admin does not exist, create it
	id := uuid.New().String()
	_, err = DB.Exec(
		"INSERT INTO profiles (id, email, password, name, role, jabatan) VALUES (?, ?, ?, ?, ?, ?)",
		id, defaultEmail, string(hashed), "Super Admin", "Admin", "System Administrator",
	)
	if err != nil {
		log.Printf("Warning: failed to seed admin: %v", err)
		return
	}
	log.Printf("Default Super Admin created: %s", defaultEmail)
}

// GetUserByIdentifier returns a user row including the password hash (for auth)
func GetUserByIdentifier(identifier string) map[string]any {
	var id, emailVal, username, password, name, role string
	var jabatan, city, branch, department, whatsapp, avatarURL, roles, extraRoles *string

	log.Printf("[DEBUG] Searching for user with identifier: %s", identifier)
	err := DB.QueryRow(
		"SELECT id, email, username, password, name, role, jabatan, city, branch, department, whatsapp, avatar_url, roles, extra_roles FROM profiles WHERE email = ? OR username = ?",
		identifier, identifier,
	).Scan(&id, &emailVal, &username, &password, &name, &role, &jabatan, &city, &branch, &department, &whatsapp, &avatarURL, &roles, &extraRoles)

	if err != nil {
		log.Printf("[DEBUG] User not found or scan error for %s: %v", identifier, err)
		return nil
	}
	log.Printf("[DEBUG] User found: %s (Email: %s)", name, emailVal)

	result := map[string]any{
		"id":          id,
		"email":       emailVal,
		"username":    username,
		"password":    password,
		"name":        name,
		"role":        role, // Keep for backward compatibility
		"jabatan":     jabatan,
		"city":        city,
		"branch":      branch,
		"department":  department,
		"whatsapp":    whatsapp,
		"avatar_url":  avatarURL,
		"roles":       roles,
		"extra_roles": extraRoles,
	}
	return result
}

func seedRolesAndPermissions() {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM roles_master").Scan(&count)
	if err == nil && count > 0 {
		return
	}

	roles := []struct {
		Name string
		Desc string
	}{
		{"Admin", "Full access to all modules and configurations"},
		{"Manager", "Access to operational modules and reporting"},
		{"Staff", "Standard access for requests and basic inventory"},
	}

	for _, r := range roles {
		roleID := uuid.New().String()
		_, _ = DB.Exec("INSERT INTO roles_master (id, name, description) VALUES (?, ?, ?)", roleID, r.Name, r.Desc)
		
		// Seed all permissions for Admin, selected for others
		resources := []string{
			"Dashboard", "Utility", "Job Order", "Request", "Release", "Return", 
			"Maintenance", "Inventory", "Reports", "Master Equipment", 
			"Master Vendor", "Master Company", "Master Kapal", "Master Workflow", 
			"Master Configuration", "User Management", "Role Management",
		}
		actions := []string{"view", "add", "edit", "delete", "approve", "import", "export"}
		
		for _, res := range resources {
			for _, act := range actions {
				isAllowed := 0
				if r.Name == "Admin" {
					isAllowed = 1
				} else if r.Name == "Manager" && (act == "view" || act == "add" || act == "edit" || act == "approve") {
					isAllowed = 1
				} else if r.Name == "Staff" && act == "view" {
					isAllowed = 1
				}
				
				permID := uuid.New().String()
				_, _ = DB.Exec(
					"INSERT INTO role_permissions (id, role_id, resource, action, is_allowed) VALUES (?, ?, ?, ?, ?)",
					permID, roleID, res, act, isAllowed,
				)
			}
		}
	}
	log.Println("Roles and permissions seeded with Admin as Super Admin.")
}

func seedDropdownConfigs() {
	var count int
	err := DB.QueryRow("SELECT COUNT(*) FROM dropdown_configs").Scan(&count)
	if err == nil && count > 0 {
		return
	}

	initialData := []struct {
		Category string
		Label    string
		Value    string
	}{
		// Roles
		{"roles", "Admin", "Admin"},
		{"roles", "Manager", "Manager"},
		{"roles", "Staff", "Staff"},
		
		// Jabatan / Positions
		{"positions", "Kepala Divisi Ops", "Kepala Divisi Ops"},
		{"positions", "Manager Engineering", "Manager Engineering"},
		{"positions", "Superintendent", "Superintendent"},
		{"positions", "Maintenance Manager", "Maintenance Manager"},
		
		// Company Types
		{"company_types", "Ship Owner", "Ship Owner"},
		{"company_types", "Charterer", "Charterer"},
		{"company_types", "Agency", "Agency"},
		
		// Ship Types
		{"ship_types", "Tugboat", "Tugboat"},
		{"ship_types", "Barge", "Barge"},
		{"ship_types", "LCT", "LCT"},
		{"ship_types", "SPOB", "SPOB"},
		
		// Departments
		{"departments", "Operations", "Operations"},
		{"departments", "Engineering", "Engineering"},
		{"departments", "Finance & Accounting", "Finance & Accounting"},
		{"departments", "HR & GA", "HR & GA"},
		{"departments", "Procurement", "Procurement"},
		{"departments", "QHSE", "QHSE"},
		
		// Extra Permissions Tags
		{"extra_permissions", "Access Finance", "Access Finance"},
		{"extra_permissions", "Edit Ship Specs", "Edit Ship Specs"},
		{"extra_permissions", "Approve Overtime", "Approve Overtime"},
		{"extra_permissions", "View Audit Logs", "View Audit Logs"},
		{"extra_permissions", "Manage Master Config", "Manage Master Config"},
	}

	for _, item := range initialData {
		id := uuid.New().String()
		_, _ = DB.Exec(
			"INSERT INTO dropdown_configs (id, category, label, value) VALUES (?, ?, ?, ?)",
			id, item.Category, item.Label, item.Value,
		)
	}
	log.Println("Initial dropdown configurations seeded.")
}

// GetUserPublicByEmail returns a user row without the password (for session)
func GetUserPublicByEmail(email string) map[string]any {
	var id, emailVal, username, name, role string
	var jabatan, city, branch, department, whatsapp, avatarURL, roles, extraRoles *string

	err := DB.QueryRow(
		"SELECT id, email, username, name, role, jabatan, city, branch, department, whatsapp, avatar_url, roles, extra_roles FROM profiles WHERE email = ? OR username = ?",
		email, email,
	).Scan(&id, &emailVal, &username, &name, &role, &jabatan, &city, &branch, &department, &whatsapp, &avatarURL, &roles, &extraRoles)

	if err != nil {
		return nil
	}

	return map[string]any{
		"id":          id,
		"email":       emailVal,
		"username":    username,
		"name":        name,
		"role":        role,
		"jabatan":     jabatan,
		"city":        city,
		"branch":      branch,
		"department":  department,
		"whatsapp":    whatsapp,
		"roles":       roles,
		"extra_roles": extraRoles,
		"image":       avatarURL,
	}
}
