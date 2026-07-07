package db

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	_ "github.com/lib/pq"
	_ "modernc.org/sqlite"
)

// DB is the global database connection
var DB *sql.DB

// Init initializes the database (Postgres or SQLite fallback)
func Init() {
	var err error
	dbConn := os.Getenv("DB_CONNECTION")

	if dbConn == "postgres" {
		pgUrl := os.Getenv("POSTGRES_URL")
		if pgUrl == "" {
			log.Fatalf("POSTGRES_URL is required when DB_CONNECTION is postgres")
		}
		DB, err = sql.Open("postgres", pgUrl)
		if err != nil {
			log.Fatalf("Failed to open postgres database: %v", err)
		}
		log.Printf("Database initialized: PostgreSQL")
	} else {
		dbPath := "./shipyard.sqlite"

		if os.Getenv("NODE_ENV") == "production" {
			if _, err := os.Stat("/data"); err == nil {
				dbPath = "/data/shipyard.sqlite"
			}
		}
		if envPath := os.Getenv("DATABASE_PATH"); envPath != "" {
			dbPath = envPath
		}
		if dir := filepath.Dir(dbPath); dir != "." && dir != "" {
			if err := os.MkdirAll(dir, 0755); err != nil {
				log.Fatalf("Failed to create database directory: %v", err)
			}
		}

		DB, err = sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(on)")
		if err != nil {
			log.Fatalf("Failed to open database: %v", err)
		}
		log.Printf("Database initialized: SQLite (%s)", dbPath)
	}

	if err = DB.Ping(); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	createTables()
	seedAdmin()
}

// FormatQuery dynamically replaces ? with $1, $2 for PostgreSQL compatibility
func FormatQuery(query string) string {
	if os.Getenv("DB_CONNECTION") == "postgres" {
		count := 1
		for strings.Contains(query, "?") {
			query = strings.Replace(query, "?", fmt.Sprintf("$%d", count), 1)
			count++
		}
	}
	return query
}

// Exec is a wrapper around DB.Exec that automatically formats the query for Postgres
func Exec(query string, args ...any) (sql.Result, error) {
	return DB.Exec(FormatQuery(query), args...)
}

// Query is a wrapper around DB.Query that automatically formats the query for Postgres
func Query(query string, args ...any) (*sql.Rows, error) {
	return DB.Query(FormatQuery(query), args...)
}

// QueryRow is a wrapper around DB.QueryRow that automatically formats the query for Postgres
func QueryRow(query string, args ...any) *sql.Row {
	return DB.QueryRow(FormatQuery(query), args...)
}

func createTables() {
	schema := `
	CREATE TABLE IF NOT EXISTS profiles (
		id TEXT PRIMARY KEY,
		email TEXT UNIQUE,
		username TEXT UNIQUE,
		password TEXT,
		name TEXT,
		role TEXT DEFAULT 'Staff',
		jabatan TEXT,
		city TEXT,
		branch TEXT,
		department TEXT,
		whatsapp TEXT,
		avatar_url TEXT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS equipment (
		id TEXT PRIMARY KEY,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		source TEXT, no_asset TEXT, type TEXT, brand TEXT, name TEXT,
		capacity TEXT, year_invest TEXT, available TEXT, alias TEXT, price TEXT, pic TEXT
	);

	CREATE TABLE IF NOT EXISTS loan_requests (
		id TEXT PRIMARY KEY,
		date_created TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		request_id TEXT, project_id TEXT, shipname TEXT, vendor TEXT,
		work_order TEXT, date_start TEXT, date_finish TEXT, duration INTEGER,
		lampiran TEXT, change TEXT, status TEXT, items TEXT, approval_steps TEXT
	);

	CREATE TABLE IF NOT EXISTS equipment_release (
		id TEXT PRIMARY KEY,
		loan_id TEXT,
		release_no TEXT,
		date_released TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
		create_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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
		print TEXT,
		rotation REAL DEFAULT 0
	);

	CREATE TABLE IF NOT EXISTS deployment_records (
		unique_id TEXT PRIMARY KEY,
		create_date TEXT,
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

	CREATE TABLE IF NOT EXISTS master_locations (
		id TEXT PRIMARY KEY,
		name TEXT,
		size TEXT,
		description TEXT,
		status TEXT DEFAULT 'Active',
		layout_id TEXT
	);

	CREATE TABLE IF NOT EXISTS vessel_layouts (
		id TEXT PRIMARY KEY,
		name TEXT,
		svg_content TEXT,
		viewbox TEXT,
		is_default BOOLEAN DEFAULT false,
		location_id TEXT,
		scale_x REAL DEFAULT 3.6,
		scale_y REAL DEFAULT 3.2,
		default_zoom REAL DEFAULT 1.0,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS master_status_dock (
		id TEXT PRIMARY KEY,
		name TEXT UNIQUE,
		color TEXT,
		is_active BOOLEAN DEFAULT true,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS master_services (
		id TEXT PRIMARY KEY,
		code TEXT,
		name TEXT,
		status TEXT DEFAULT 'Active'
	);
	
	CREATE TABLE IF NOT EXISTS master_employees (
		id TEXT PRIMARY KEY,
		code TEXT,
		name TEXT,
		address TEXT,
		email TEXT,
		phone TEXT,
		mobile_phone TEXT,
		is_active TEXT,
		position TEXT,
		m_branch_id INTEGER,
		m_department_id INTEGER,
		m_city_id INTEGER,
		type TEXT
	);
	
	CREATE TABLE IF NOT EXISTS master_components (
		id TEXT PRIMARY KEY,
		code TEXT,
		description TEXT,
		unit TEXT,
		flag_active BOOLEAN,
		created_at TEXT,
		updated_at TEXT,
		minimum_stock INTEGER,
		parent_id TEXT,
		type TEXT,
		class TEXT,
		remark TEXT,
		part_no TEXT,
		m_branch_id TEXT,
		itemcode TEXT,
		description_code TEXT,
		created_by TEXT,
		modified_by TEXT
	);
	`

	if _, err := DB.Exec(schema); err != nil {
		log.Fatalf("Failed to create tables: %v", err)
	}

	// Simple migrations for existing tables
	DB.Exec("ALTER TABLE master_locations ADD COLUMN layout_id TEXT")
	DB.Exec("ALTER TABLE companies ADD COLUMN status TEXT DEFAULT 'Active'")
	DB.Exec("ALTER TABLE vendors ADD COLUMN status TEXT DEFAULT 'Active'")
	DB.Exec("ALTER TABLE profiles ADD COLUMN jabatan TEXT")
	DB.Exec("ALTER TABLE master_components ADD COLUMN created_by TEXT")
	DB.Exec("ALTER TABLE master_components ADD COLUMN modified_by TEXT")
	DB.Exec("ALTER TABLE profiles ADD COLUMN city TEXT")
	DB.Exec("ALTER TABLE profiles ADD COLUMN branch TEXT")
	DB.Exec("ALTER TABLE profiles ADD COLUMN department TEXT")
	DB.Exec("ALTER TABLE profiles ADD COLUMN whatsapp TEXT")
	DB.Exec("ALTER TABLE profiles ADD COLUMN roles TEXT")
	DB.Exec("ALTER TABLE profiles ADD COLUMN extra_roles TEXT")
	DB.Exec("ALTER TABLE profiles ADD COLUMN username TEXT")
	DB.Exec("ALTER TABLE vessel_layouts ADD COLUMN scale_x REAL DEFAULT 3.6")
	DB.Exec("ALTER TABLE vessel_layouts ADD COLUMN scale_y REAL DEFAULT 3.2")
	DB.Exec("ALTER TABLE vessel_layouts ADD COLUMN location_id TEXT")
	DB.Exec("ALTER TABLE vessel_layouts ADD COLUMN default_zoom REAL DEFAULT 1.0")
	DB.Exec("ALTER TABLE equipment ADD COLUMN pic TEXT")
	DB.Exec("ALTER TABLE deployment_records ADD COLUMN create_date TEXT")
	
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
		is_allowed BOOLEAN DEFAULT false
	);`)

	DB.Exec(`CREATE TABLE IF NOT EXISTS sync_configs (
		id TEXT PRIMARY KEY,
		name TEXT UNIQUE,
		url TEXT,
		headers TEXT,
		last_sync TEXT,
		last_response TEXT,
		is_active BOOLEAN DEFAULT true,
		interval_type TEXT DEFAULT 'minutes',
		interval_value INTEGER DEFAULT 5,
		enable_last_sync BOOLEAN DEFAULT true
	);`)

	// Migrations for sync_configs if they already exist from previous session
	DB.Exec("ALTER TABLE sync_configs ADD COLUMN interval_type TEXT DEFAULT 'minutes'")
	DB.Exec("ALTER TABLE sync_configs ADD COLUMN interval_value INTEGER DEFAULT 5")
	DB.Exec("ALTER TABLE sync_configs ADD COLUMN enable_last_sync BOOLEAN DEFAULT true")
	DB.Exec("UPDATE sync_configs SET interval_type = 'minutes', interval_value = 5 WHERE interval_type IS NULL")
	DB.Exec("UPDATE sync_configs SET enable_last_sync = true WHERE enable_last_sync IS NULL")

	// Migrations for existing schemas
	DB.Exec("ALTER TABLE projects ADD COLUMN location TEXT")
	DB.Exec("ALTER TABLE projects ADD COLUMN docking_type TEXT")

	seedRolesAndPermissions();

	DB.Exec(`CREATE TABLE IF NOT EXISTS dropdown_configs (
		id TEXT PRIMARY KEY,
		category TEXT,
		label TEXT,
		value TEXT,
		is_active BOOLEAN DEFAULT true
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

	// Migration: ensure docking_types exist in dropdown_configs (safe upsert per item)
	seedMissingDropdownItems()

	// Migration: ensure master_locations are pre-populated from real project data
	seedMissingLocations()

	// Migration: Add rotation to projects
	DB.Exec("ALTER TABLE projects ADD COLUMN rotation REAL DEFAULT 0")

	// Migration: Add master_status_dock
	DB.Exec(`CREATE TABLE IF NOT EXISTS master_status_dock (
		id TEXT PRIMARY KEY,
		name TEXT UNIQUE,
		color TEXT,
		is_active BOOLEAN DEFAULT true,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);`)

	seedMasterStatusDock()

	// Migration: Add work_order_details for syncing detailed WO API response
	DB.Exec(`CREATE TABLE IF NOT EXISTS work_order_details (
		wo_id TEXT PRIMARY KEY,
		raw_json TEXT,
		last_sync TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);`)

	// Migration: Flatten sync_job_orders table into 46 AI-ready columns (force drop old schema)
	DB.Exec("DROP TABLE IF EXISTS sync_job_orders CASCADE")
	DB.Exec(`CREATE TABLE IF NOT EXISTS sync_job_orders (
		id TEXT PRIMARY KEY,
		code TEXT,
		project TEXT,
		approval_status TEXT,
		m_customer_id INTEGER,
		m_customer_name TEXT,
		m_ship_id INTEGER,
		m_ship_name TEXT,
		m_service_id INTEGER,
		m_slipway_id INTEGER,
		m_branch_id INTEGER,
		m_employee_id TEXT,
		agent TEXT,
		est_start TEXT,
		est_finish TEXT,
		est_arrival_date TEXT,
		est_departure_date TEXT,
		est_docking_date TEXT,
		est_undocking_date TEXT,
		est_trial_date TEXT,
		act_start_date TEXT,
		act_finish_date TEXT,
		act_arrival_date TEXT,
		act_departure_date TEXT,
		act_trial_date TEXT,
		docking_date TEXT,
		undocking_date TEXT,
		floating_before_docking TEXT,
		floating_after_docking TEXT,
		floating_before_undocking TEXT,
		floating_after_undocking TEXT,
		total_price TEXT,
		total_price_additional TEXT,
		adjusted_total NUMERIC,
		adjusted_total_additional NUMERIC,
		price_adjustment TEXT,
		price_adjustment_additional TEXT,
		t_quotation_id INTEGER,
		t_quotation_code TEXT,
		t_repair_list_id INTEGER,
		latest_version INTEGER,
		flag_rq BOOLEAN,
		created_at TIMESTAMP,
		created_by INTEGER,
		updated_at TIMESTAMP,
		modified_by INTEGER
	);`)

	// Upgrade raw_json to JSONB if using PostgreSQL (only if not already JSONB to avoid Access Exclusive locks)
	if os.Getenv("DB_CONNECTION") == "postgres" {
		var colType string
		err := DB.QueryRow("SELECT data_type FROM information_schema.columns WHERE table_name = 'work_order_details' AND column_name = 'raw_json'").Scan(&colType)
		if err == nil && colType != "jsonb" {
			log.Println("PostgreSQL detected: Upgrading raw_json to JSONB for high-performance querying...")
			_, err = DB.Exec(`ALTER TABLE work_order_details ALTER COLUMN raw_json TYPE JSONB USING raw_json::jsonb`)
			if err != nil {
				log.Printf("Notice: JSONB upgrade skipped (%v)", err)
			}
		}
	}

	// ---------------------------------------------------------
	// AI-First LLM Flattened Tables (One Big Table Architecture)
	// ---------------------------------------------------------
	DB.Exec(`CREATE TABLE IF NOT EXISTS ai_work_orders (
		wo_id TEXT PRIMARY KEY,
		wo_code TEXT,
		jo_id TEXT,
		jo_code TEXT,
		vendor_name TEXT,
		ship_name TEXT,
		total_cost_contract NUMERIC,
		status_approval TEXT,
		approval_date TEXT,
		last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);`)

	DB.Exec(`CREATE TABLE IF NOT EXISTS ai_wo_breakdowns (
		id TEXT PRIMARY KEY,
		wo_id TEXT,
		jo_id TEXT,
		vendor_name TEXT,
		ship_name TEXT,
		parent_id TEXT,
		path TEXT,
		label TEXT,
		remark TEXT,
		volume NUMERIC,
		unit TEXT,
		price NUMERIC,
		total_price NUMERIC,
		approved_level INTEGER,
		status_approval TEXT,
		approval_date TEXT,
		last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);`)

	DB.Exec(`CREATE TABLE IF NOT EXISTS ai_material_deliveries (
		id TEXT PRIMARY KEY,
		wo_id TEXT,
		jo_id TEXT,
		vendor_name TEXT,
		ship_name TEXT,
		requisition_id TEXT,
		component_code TEXT,
		component_name TEXT,
		part_no TEXT,
		qty_delivered NUMERIC,
		unit TEXT,
		unit_price NUMERIC,
		total_price NUMERIC,
		currency TEXT,
		delivery_code TEXT,
		delivery_date TEXT,
		receiver_name TEXT,
		receiver_vendor TEXT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);`)

	// Safe schema migrations for existing AI tables
	DB.Exec("ALTER TABLE ai_work_orders RENAME COLUMN status_pekerjaan TO status_approval")
	DB.Exec("ALTER TABLE ai_work_orders ADD COLUMN status_approval TEXT")
	DB.Exec("ALTER TABLE ai_work_orders ADD COLUMN approval_date TEXT")
	DB.Exec("ALTER TABLE ai_work_orders ADD COLUMN last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
	DB.Exec("ALTER TABLE ai_wo_breakdowns ADD COLUMN approval_date TEXT")
	DB.Exec("ALTER TABLE ai_wo_breakdowns ADD COLUMN last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
}

func seedMasterStatusDock() {
	statuses := []struct {
		Name  string
		Color string
	}{
		{"Docking", "#3498db"},
		{"On Dock", "#2ecc71"},
		{"Undocking", "#e67e22"},
		{"Completed", "#95a5a6"},
	}

	for _, s := range statuses {
		var count int
		DB.QueryRow(FormatQuery("SELECT COUNT(*) FROM master_status_dock WHERE name = ?"), s.Name).Scan(&count)
		if count == 0 {
			id := uuid.New().String()
			_, _ = DB.Exec(FormatQuery("INSERT INTO master_status_dock (id, name, color, is_active) VALUES (?, ?, ?, true)"),
				id, s.Name, s.Color,
			)
			log.Printf("Seeded master status dock: %s", s.Name)
		}
	}
}

func seedMissingDropdownItems() {
	// Each entry is inserted only if a matching category+value doesn't exist yet.
	// Values sourced from actual docking_type column in the projects table.
	items := []struct {
		Category string
		Label    string
		Value    string
	}{
		{"docking_types", "Docking Repair", "Docking Repair"},
		{"docking_types", "Emergency Repair", "Emergency Repair"},
		{"docking_types", "Floating Repair", "Floating Repair"},
		{"docking_types", "New Building", "New Building"},
		{"docking_types", "Non Ship", "Non Ship"},
		{"docking_types", "Running Repair", "Running Repair"},
	}

	for _, item := range items {
		var count int
		DB.QueryRow(FormatQuery("SELECT COUNT(*) FROM dropdown_configs WHERE category = ? AND value = ?"),
			item.Category, item.Value,
		).Scan(&count)

		if count == 0 {
			id := uuid.New().String()
			_, _ = DB.Exec(FormatQuery("INSERT INTO dropdown_configs (id, category, label, value, is_active) VALUES (?, ?, ?, ?, true)"),
				id, item.Category, item.Label, item.Value,
			)
			log.Printf("Seeded missing dropdown: [%s] %s", item.Category, item.Label)
		}
	}
}

func seedMissingLocations() {
	// Pre-populate master_locations from real project location data.
	locations := []struct {
		Name string
		Size string
	}{
		{"Building Berth", ""},
		{"FASGAL", ""},
		{"FLOATING AREA JMI 1", ""},
		{"Floating Area", ""},
		{"Floating Repair ABC", ""},
		{"GSM", ""},
		{"Graving Dock JMI 1", ""},
		{"Graving Dock JMI 2", ""},
		{"INTERNAL", ""},
		{"Non Ship", ""},
		{"PELINDO MARINE SERVICE (PMS)", ""},
		{"SLIPWAY E", ""},
		{"Slipway A", ""},
		{"Slipway B", ""},
		{"Slipway C", ""},
		{"Slipway D", ""},
		{"Slipway E", ""},
		{"TEGAL SHIPYARD UTAMA CILACAP", ""},
	}

	for _, loc := range locations {
		var count int
		DB.QueryRow(FormatQuery("SELECT COUNT(*) FROM master_locations WHERE name = ?"), loc.Name).Scan(&count)
		if count == 0 {
			id := uuid.New().String()
			_, _ = DB.Exec(FormatQuery("INSERT INTO master_locations (id, name, size, description, status) VALUES (?, ?, ?, '', 'Active')"),
				id, loc.Name, loc.Size,
			)
			log.Printf("Seeded missing location: %s", loc.Name)
		}
	}
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
		_, _ = DB.Exec(FormatQuery("INSERT INTO approval_workflow (id, module, step_order, label, jabatan) VALUES (?, ?, ?, ?, ?)"),
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
	err = DB.QueryRow(FormatQuery("SELECT id FROM profiles WHERE email = ?"), defaultEmail).Scan(&existingID)
	
	if err == nil {
		// Admin exists, FORCE RESET the password and role to ensure it works
		_, _ = DB.Exec(FormatQuery("UPDATE profiles SET password = ?, role = 'Admin', jabatan = 'System Administrator' WHERE id = ?"),
			string(hashed), existingID,
		)
		log.Printf("Admin account reset guaranteed: %s", defaultEmail)
		return
	}

	// Admin does not exist, create it
	id := uuid.New().String()
	_, err = DB.Exec(FormatQuery("INSERT INTO profiles (id, email, password, name, role, jabatan) VALUES (?, ?, ?, ?, ?, ?)"),
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
	var id, emailVal, password, name, role string
	var username, jabatan, city, branch, department, whatsapp, avatarURL, roles, extraRoles *string

	log.Printf("[DEBUG] Searching for user with identifier: %s", identifier)
	err := DB.QueryRow(FormatQuery("SELECT id, email, username, password, name, role, jabatan, city, branch, department, whatsapp, avatar_url, roles, extra_roles FROM profiles WHERE email = ? OR username = ?"),
		identifier, identifier,
	).Scan(&id, &emailVal, &username, &password, &name, &role, &jabatan, &city, &branch, &department, &whatsapp, &avatarURL, &roles, &extraRoles)

	if err != nil {
		log.Printf("[DEBUG] User not found or scan error for %s: %v", identifier, err)
		return nil
	}
	log.Printf("[DEBUG] User found: %s (Email: %s)", name, emailVal)

	var uname string
	if username != nil {
		uname = *username
	}

	result := map[string]any{
		"id":          id,
		"email":       emailVal,
		"username":    uname,
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
		_, _ = DB.Exec(FormatQuery("INSERT INTO roles_master (id, name, description) VALUES (?, ?, ?)"), roleID, r.Name, r.Desc)
		
		// Seed all permissions for Admin, selected for others
		resources := []string{
			"Dashboard", "Utility", "Job Order", "Ship Docking", "Request", "Release", "Return", 
			"Maintenance", "Inventory", "Reports", "Master Equipment", 
			"Master Vendor", "Master Company", "Master Kapal", "Master Location", "Master Workflow", 
			"Master Configuration", "User Management", "Role Management", "Master Dock Status", "Vessel Layout",
		}
		actions := []string{"view", "add", "edit", "delete", "approve", "import", "export"}
		
		for _, res := range resources {
			for _, act := range actions {
				isAllowed := false
				if r.Name == "Admin" {
					isAllowed = true
				} else if r.Name == "Manager" && (act == "view" || act == "add" || act == "edit" || act == "approve") {
					isAllowed = true
				} else if r.Name == "Staff" && act == "view" {
					isAllowed = true
				}
				
				permID := uuid.New().String()
				_, _ = DB.Exec(FormatQuery("INSERT INTO role_permissions (id, role_id, resource, action, is_allowed) VALUES (?, ?, ?, ?, ?)"),
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
		
		// Docking Types
		{"docking_types", "Graving Dock", "Graving Dock"},
		{"docking_types", "Slipway", "Slipway"},
		{"docking_types", "Airbag System", "Airbag System"},
		{"docking_types", "Floating Dock", "Floating Dock"},
		
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
		_, _ = DB.Exec(FormatQuery("INSERT INTO dropdown_configs (id, category, label, value) VALUES (?, ?, ?, ?)"),
			id, item.Category, item.Label, item.Value,
		)
	}
	log.Println("Initial dropdown configurations seeded.")
}

// GetUserPublicByEmail returns a user row without the password (for session)
func GetUserPublicByEmail(email string) map[string]any {
	var id, emailVal, name, role string
	var username, jabatan, city, branch, department, whatsapp, avatarURL, roles, extraRoles *string

	err := DB.QueryRow(FormatQuery("SELECT id, email, username, name, role, jabatan, city, branch, department, whatsapp, avatar_url, roles, extra_roles FROM profiles WHERE email = ? OR username = ?"),
		email, email,
	).Scan(&id, &emailVal, &username, &name, &role, &jabatan, &city, &branch, &department, &whatsapp, &avatarURL, &roles, &extraRoles)

	if err != nil {
		return nil
	}

	var uname string
	if username != nil {
		uname = *username
	}

	return map[string]any{
		"id":          id,
		"email":       emailVal,
		"username":    uname,
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
