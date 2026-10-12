package db

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
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

		DB, err = sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(on)&_pragma=busy_timeout(10000)")
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
	MigrateWorkOrderItemsPermission()
}

// MigrateWorkOrderItemsPermission runs once (called from Init): the Item Pekerjaan WO menu used to
// share the "Work Order" permission, so each role gets the same rights on the
// new "Item Pekerjaan WO" resource and nobody loses access when it is split out.
func MigrateWorkOrderItemsPermission() {
	const marker = "rbac_item_pekerjaan_wo"
	var done string
	if DB.QueryRow(FormatQuery("SELECT value FROM app_meta WHERE key = ?"), marker).Scan(&done) == nil {
		return
	}

	rows, err := DB.Query(FormatQuery("SELECT role_id, action, is_allowed FROM role_permissions WHERE resource = ?"), "Work Order")
	if err != nil {
		log.Printf("Item Pekerjaan WO permission migration: %v", err)
		return
	}
	type perm struct {
		roleID, action string
		allowed        bool
	}
	var perms []perm
	for rows.Next() {
		var p perm
		if rows.Scan(&p.roleID, &p.action, &p.allowed) == nil {
			perms = append(perms, p)
		}
	}
	rows.Close()

	copied := 0
	for _, p := range perms {
		var exists int
		DB.QueryRow(FormatQuery("SELECT COUNT(*) FROM role_permissions WHERE role_id = ? AND resource = ? AND action = ?"),
			p.roleID, "Item Pekerjaan WO", p.action).Scan(&exists)
		if exists > 0 {
			continue
		}
		if _, err := DB.Exec(FormatQuery("INSERT INTO role_permissions (id, role_id, resource, action, is_allowed) VALUES (?, ?, ?, ?, ?)"),
			uuid.New().String(), p.roleID, "Item Pekerjaan WO", p.action, p.allowed); err != nil {
			log.Printf("Item Pekerjaan WO permission migration: %v", err)
			return
		}
		copied++
	}
	DB.Exec(FormatQuery("INSERT INTO app_meta (key, value) VALUES (?, ?)"), marker, "done")
	log.Printf("Item Pekerjaan WO: copied %d Work Order permission(s) to the new resource", copied)
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
		interval_value INTEGER DEFAULT 5
	);`)

	// Migrations for sync_configs if they already exist from previous session
	DB.Exec("ALTER TABLE sync_configs ADD COLUMN interval_type TEXT DEFAULT 'minutes'")
	DB.Exec("ALTER TABLE sync_configs ADD COLUMN interval_value INTEGER DEFAULT 5")
	// Outcome of the last sync attempt: ok | error | auth_expired (set by the sync workers).
	DB.Exec("ALTER TABLE sync_configs ADD COLUMN last_status TEXT")
	DB.Exec("ALTER TABLE sync_configs ADD COLUMN last_error TEXT")
	DB.Exec("ALTER TABLE sync_configs ADD COLUMN last_error_at TEXT")
	DB.Exec("UPDATE sync_configs SET interval_type = 'minutes', interval_value = 5 WHERE interval_type IS NULL")

	// Migrations for existing schemas
	DB.Exec("ALTER TABLE projects ADD COLUMN location TEXT")
	DB.Exec("ALTER TABLE projects ADD COLUMN docking_type TEXT")
	DB.Exec("DELETE FROM projects WHERE UPPER(COALESCE(idproject, '')) LIKE 'WO%'")

	seedRolesAndPermissions()

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

	if os.Getenv("DB_CONNECTION") == "postgres" {
		DB.Exec(`DO $$
		BEGIN
			IF to_regclass('public.work_order_financial_summary') IS NOT NULL
				AND to_regclass('public.work_order_summary') IS NULL THEN
				ALTER TABLE work_order_financial_summary RENAME TO work_order_summary;
			END IF;
		END $$;`)
	} else {
		DB.Exec("ALTER TABLE work_order_financial_summary RENAME TO work_order_summary")
	}

	DB.Exec(`CREATE TABLE IF NOT EXISTS work_order_summary (
		wo_id TEXT PRIMARY KEY,
		wo_code TEXT,
		jo_code TEXT,
		project_name TEXT,
		vendor_name TEXT,
		ship_name TEXT,
		status_approval TEXT,
		derived_status TEXT,
		latest_date TEXT,
		pending_cost NUMERIC DEFAULT 0,
		final_cost NUMERIC DEFAULT 0,
		latest_cost NUMERIC DEFAULT 0,
		previous_cost NUMERIC DEFAULT 0,
		rejected_cost NUMERIC DEFAULT 0,
		total_cost NUMERIC DEFAULT 0,
		created_source_at TEXT,
		updated_source_at TEXT,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);`)
	// updated_at (from SIAGA) of the detail we last stored; when it differs from
	// updated_source_at (from the WO list) the detail is stale and gets re-fetched.
	DB.Exec("ALTER TABLE work_order_summary ADD COLUMN detail_updated_at TEXT")
	// 'internal' for WOs of internal (facility) Job Orders, else external/NULL.
	DB.Exec("ALTER TABLE work_order_summary ADD COLUMN project_type TEXT")

	// Approved cost per WO per approval date, derived from work_order_details.
	// Drives the cost trend so approvals on earlier days aren't lost.
	DB.Exec(`CREATE TABLE IF NOT EXISTS work_order_daily_costs (
		wo_id TEXT NOT NULL,
		cost_date TEXT NOT NULL,
		approved_cost NUMERIC DEFAULT 0,
		PRIMARY KEY (wo_id, cost_date)
	);`)
	DB.Exec("CREATE INDEX IF NOT EXISTS idx_wo_daily_costs_date ON work_order_daily_costs(cost_date)")

	// Leaf work items of every WO detail (flattened from repair_list), written
	// in the same pass as the summary financials so they always add up.
	DB.Exec(`CREATE TABLE IF NOT EXISTS wo_items (
		wo_id TEXT NOT NULL,
		item_id TEXT NOT NULL,
		activity_path TEXT,
		activity_name TEXT,
		category TEXT,
		path TEXT,
		label TEXT,
		unit TEXT,
		volume NUMERIC DEFAULT 0,
		unit_cost NUMERIC DEFAULT 0,
		total_cost NUMERIC DEFAULT 0,
		approved_level INTEGER DEFAULT 0,
		status TEXT,
		approval_date TEXT,
		PRIMARY KEY (wo_id, item_id)
	);`)
	// Values are SIAGA costs (volume_cost_final x volume), not selling prices.
	DB.Exec("ALTER TABLE wo_items RENAME COLUMN unit_price TO unit_cost")
	DB.Exec("ALTER TABLE wo_items RENAME COLUMN total_price TO total_cost")
	DB.Exec("CREATE INDEX IF NOT EXISTS idx_wo_items_category ON wo_items(category)")
	DB.Exec("CREATE INDEX IF NOT EXISTS idx_wo_items_approval_date ON wo_items(approval_date)")
	if os.Getenv("DB_CONNECTION") == "postgres" {
		// Fast substring search on item / activity names (needs pg_trgm; skipped if unavailable).
		DB.Exec("CREATE EXTENSION IF NOT EXISTS pg_trgm")
		DB.Exec("CREATE INDEX IF NOT EXISTS idx_wo_items_label_trgm ON wo_items USING gin (lower(label) gin_trgm_ops)")
		DB.Exec("CREATE INDEX IF NOT EXISTS idx_wo_items_activity_trgm ON wo_items USING gin (lower(activity_name) gin_trgm_ops)")
	}

	// Small key/value store for app-level markers (e.g. derived-data version).
	DB.Exec(`CREATE TABLE IF NOT EXISTS app_meta (
		key TEXT PRIMARY KEY,
		value TEXT
	);`)
	DB.Exec("CREATE INDEX IF NOT EXISTS idx_wo_summary_latest_date ON work_order_summary(latest_date)")
	DB.Exec("CREATE INDEX IF NOT EXISTS idx_wo_summary_vendor_date ON work_order_summary(vendor_name, latest_date)")
	DB.Exec("CREATE INDEX IF NOT EXISTS idx_wo_summary_project_date ON work_order_summary(project_name, latest_date)")
	DB.Exec("CREATE INDEX IF NOT EXISTS idx_wo_summary_status_date ON work_order_summary(status_approval, latest_date)")
	DB.Exec("CREATE INDEX IF NOT EXISTS idx_wo_summary_derived_status_date ON work_order_summary(derived_status, latest_date)")

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

	// The ai_* tables (a separate, inconsistent copy of WO data for the AI
	// Analyzer) are retired; drop them wherever they still exist.
	DB.Exec("DROP TABLE IF EXISTS ai_material_deliveries")
	DB.Exec("DROP TABLE IF EXISTS ai_wo_breakdowns")
	DB.Exec("DROP TABLE IF EXISTS ai_work_orders")
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

// seedAdmin bootstraps the first Admin account and otherwise leaves existing
// accounts alone (it used to reset admin@shipyard.local to "admin123" on every
// start). Configure with DEFAULT_ADMIN_EMAIL / DEFAULT_ADMIN_PASSWORD;
// DEFAULT_ADMIN_RESET=true resets that account's password once for recovery.
func seedAdmin() {
	email := strings.TrimSpace(os.Getenv("DEFAULT_ADMIN_EMAIL"))
	if email == "" {
		email = "admin@shipyard.local"
	}
	password := os.Getenv("DEFAULT_ADMIN_PASSWORD")

	var existingID string
	err := DB.QueryRow(FormatQuery("SELECT id FROM profiles WHERE email = ?"), email).Scan(&existingID)
	if err == nil {
		if os.Getenv("DEFAULT_ADMIN_RESET") != "true" {
			return
		}
		if !strongAdminPassword(password) {
			log.Printf("DEFAULT_ADMIN_RESET ignored: DEFAULT_ADMIN_PASSWORD must be at least 12 characters and not a known default")
			return
		}
		hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
		if err != nil {
			log.Printf("Warning: failed to hash admin password: %v", err)
			return
		}
		DB.Exec(FormatQuery("UPDATE profiles SET password = ?, role = 'Admin' WHERE id = ?"), string(hashed), existingID)
		log.Printf("Admin password for %s reset from DEFAULT_ADMIN_PASSWORD. Remove DEFAULT_ADMIN_RESET now.", email)
		return
	}

	// Only bootstrap when there is no Admin at all.
	var admins int
	DB.QueryRow("SELECT COUNT(*) FROM profiles WHERE role = 'Admin'").Scan(&admins)
	if admins > 0 {
		return
	}

	generated := false
	if !strongAdminPassword(password) {
		password = randomPassword()
		generated = true
	}
	hashed, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("Warning: failed to hash admin password: %v", err)
		return
	}
	id := uuid.New().String()
	_, err = DB.Exec(FormatQuery("INSERT INTO profiles (id, email, password, name, role, jabatan) VALUES (?, ?, ?, ?, ?, ?)"),
		id, email, string(hashed), "Super Admin", "Admin", "System Administrator",
	)
	if err != nil {
		log.Printf("Warning: failed to seed admin: %v", err)
		return
	}
	if generated {
		// Shown once, on first start only; change it after logging in.
		log.Printf("Initial Admin created: %s / %s (change this password after logging in)", email, password)
	} else {
		log.Printf("Initial Admin created: %s", email)
	}
}

func strongAdminPassword(p string) bool {
	switch strings.ToLower(p) {
	case "", "admin", "admin123", "password", "changeme":
		return false
	}
	return len(p) >= 12
}

func randomPassword() string {
	buf := make([]byte, 12)
	if _, err := rand.Read(buf); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(buf)
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
			"Dashboard", "Utility", "Job Order", "Work Order", "Item Pekerjaan WO", "Ship Docking", "Request", "Release", "Return",
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
