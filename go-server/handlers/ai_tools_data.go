package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"shipyard/db"
)

// query_app_data: one read-only tool over the rest of ShipHub's data (master
// data, Job Order, Ship Docking, equipment, Request Material...). Each source
// is tied to the RBAC resource of its page. Users, roles and permissions,
// SIAGA credentials, AI settings and other people's chats and notifications
// are not sources, and columns that look like secrets are never returned.

type aiDataSource struct {
	Key, Label, Resource string
	Table                string // a database table, or
	Cache                string // a synced SIAGA response (sync_configs id)
}

var aiDataSources = []aiDataSource{
	{Key: "job_orders", Label: "Job Order / proyek kapal", Resource: "Job Order", Table: "projects"},
	{Key: "job_orders_siaga", Label: "Job Order dari SIAGA (sinkron)", Resource: "Job Order", Table: "sync_job_orders"},
	{Key: "material_requests", Label: "Request Material (dari SIAGA)", Resource: "Request", Cache: "MaterialRequisitions"},
	{Key: "ship_movements", Label: "Ship Docking: pergerakan dan posisi kapal di dock", Resource: "Ship Docking", Table: "ship_movements"},
	{Key: "equipment", Label: "Master Equipment / Inventory peralatan", Resource: "Master Equipment", Table: "equipment"},
	{Key: "equipment_loans", Label: "Peminjaman peralatan (Equipment Loans / Request)", Resource: "Request", Table: "loan_requests"},
	{Key: "equipment_releases", Label: "Release peralatan", Resource: "Release", Table: "equipment_release"},
	{Key: "utility_records", Label: "Utility: catatan pemakaian / deployment", Resource: "Utility", Table: "deployment_records"},
	{Key: "vendors", Label: "Master Vendor", Resource: "Master Vendor", Table: "vendors"},
	{Key: "companies", Label: "Master Company", Resource: "Master Company", Table: "companies"},
	{Key: "ships", Label: "Master Kapal", Resource: "Master Kapal", Table: "ships"},
	{Key: "components", Label: "Master Component (material)", Resource: "Master Component", Table: "master_components"},
	{Key: "locations", Label: "Master Location", Resource: "Master Location", Table: "master_locations"},
	{Key: "services", Label: "Master Service", Resource: "Master Service", Table: "master_services"},
	{Key: "employees", Label: "Master Employee (karyawan galangan)", Resource: "Master Employee", Table: "master_employees"},
	{Key: "dock_statuses", Label: "Master Dock Status", Resource: "Master Dock Status", Table: "master_status_dock"},
	{Key: "vessel_layouts", Label: "Master Layout (denah)", Resource: "Master Layout", Table: "vessel_layouts"},
	{Key: "approval_workflows", Label: "Approval Workflow", Resource: "Master Workflow", Table: "approval_workflow"},
	{Key: "dropdown_configs", Label: "Master Configuration (pilihan dropdown)", Resource: "Master Configuration", Table: "dropdown_configs"},
}

// Columns never returned: secrets, and blobs (images, SVG drawings).
var aiHiddenColumn = regexp.MustCompile(`(?i)password|passwd|token|secret|api_?key|credential|headers|cookie|svg|image|photo|base64|signature`)

const (
	aiDataMaxRows   = 20000
	aiDataTextLimit = 300
)

func aiDataSourceKeys() []string {
	keys := make([]string, len(aiDataSources))
	for i, s := range aiDataSources {
		keys[i] = s.Key
	}
	return keys
}

func aiDataSourceList() string {
	lines := make([]string, len(aiDataSources))
	for i, s := range aiDataSources {
		lines[i] = s.Key + " (" + s.Label + ")"
	}
	return strings.Join(lines, "; ")
}

// aiCanReadAnyData: the tool is offered when the user can open at least one source.
func aiCanReadAnyData(r *http.Request) bool {
	for _, s := range aiDataSources {
		if HasResourcePermission(r, s.Resource, "view") {
			return true
		}
	}
	return false
}

func aiQueryDataTool() aiTool {
	return aiTool{
		Name: "query_app_data",
		Description: "Read any other ShipHub data that the specialised tools don't cover. Call this when the user asks about Job Orders, " +
			"Ship Docking, equipment and loans, Request Material, or master data (vendors, ships, companies, components, locations, " +
			"services, employees, configuration). Sources: " + aiDataSourceList() + ". " +
			"Column names differ per source: call with describe=true first to see a source's columns and sample values, then " +
			"search (words that must all appear in a row), filter on exact column values, a date range on a date column, " +
			"group_by a column for counts (and sum_column for totals), or list rows. For Work Order, billing, work items, reference " +
			"prices and data checks use the specialised tools instead.",
		Schema: aiSchema(map[string]interface{}{
			"source":      aiString("Which data to read.", aiDataSourceKeys()...),
			"describe":    map[string]interface{}{"type": "boolean", "description": "Return the columns, row count and sample values instead of rows."},
			"search":      aiString("Words that must all appear somewhere in a row (case-insensitive)."),
			"filters":     map[string]interface{}{"type": "object", "description": "Exact column values (case-insensitive), e.g. {\"status\": \"Docking\"}.", "additionalProperties": map[string]interface{}{"type": "string"}},
			"date_column": aiString("Column holding a date, for date_from/date_to."),
			"date_from":   aiString("Earliest date, YYYY-MM-DD."),
			"date_to":     aiString("Latest date, YYYY-MM-DD."),
			"group_by":    aiString("Column to group by; returns one row per value with a count."),
			"sum_column":  aiString("Numeric column summed per group (with group_by) or over all matching rows."),
			"columns":     map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}, "description": "Columns to return (default: all)."},
			"sort_by":     aiString("Column to sort by."),
			"sort_desc":   map[string]interface{}{"type": "boolean", "description": "Sort descending."},
			"limit":       aiInteger("Rows (or groups) to return, default 20.", 1, 100),
		}, "source"),
		Available: aiCanReadAnyData,
		Run:       runQueryAppData,
	}
}

type aiDataInput struct {
	Source     string            `json:"source"`
	Describe   bool              `json:"describe"`
	Search     string            `json:"search"`
	Filters    map[string]string `json:"filters"`
	DateColumn string            `json:"date_column"`
	DateFrom   string            `json:"date_from"`
	DateTo     string            `json:"date_to"`
	GroupBy    string            `json:"group_by"`
	SumColumn  string            `json:"sum_column"`
	Columns    []string          `json:"columns"`
	SortBy     string            `json:"sort_by"`
	SortDesc   bool              `json:"sort_desc"`
	Limit      int               `json:"limit"`
}

func runQueryAppData(r *http.Request, input json.RawMessage) (interface{}, error) {
	var in aiDataInput
	if err := decodeAIInput(input, &in); err != nil {
		return nil, err
	}
	var src *aiDataSource
	for i := range aiDataSources {
		if aiDataSources[i].Key == in.Source {
			src = &aiDataSources[i]
		}
	}
	if src == nil {
		return nil, inputErrorf("source harus salah satu dari: %s", strings.Join(aiDataSourceKeys(), ", "))
	}
	if !HasResourcePermission(r, src.Resource, "view") {
		return nil, inputErrorf("pengguna ini tidak punya akses ke menu %s; data %s tidak bisa dibaca", src.Resource, src.Key)
	}
	if err := checkDate("date_from", in.DateFrom); err != nil {
		return nil, err
	}
	if err := checkDate("date_to", in.DateTo); err != nil {
		return nil, err
	}

	columns, rows, err := loadAIDataSource(*src)
	if err != nil {
		return nil, err
	}
	col := func(field, name string) (string, error) {
		if name == "" {
			return "", nil
		}
		for _, c := range columns {
			if strings.EqualFold(c, name) {
				return c, nil
			}
		}
		return "", inputErrorf("%s: kolom %q tidak ada di %s; kolom yang ada: %s", field, name, src.Key, strings.Join(columns, ", "))
	}

	if in.Describe {
		samples := map[string][]string{}
		for _, c := range columns {
			seen := map[string]bool{}
			for _, row := range rows {
				v := aiDataText(row[c])
				if v == "" || seen[v] {
					continue
				}
				seen[v] = true
				if len([]rune(v)) > 60 {
					v = string([]rune(v)[:60]) + "…"
				}
				samples[c] = append(samples[c], v)
				if len(samples[c]) == 3 {
					break
				}
			}
		}
		return map[string]interface{}{"source": src.Key, "label": src.Label, "rows": len(rows), "columns": columns, "samples": samples}, nil
	}

	// Filter.
	words := strings.Fields(strings.ToLower(in.Search))
	filters := map[string]string{}
	for k, v := range in.Filters {
		c, err := col("filters", k)
		if err != nil {
			return nil, err
		}
		filters[c] = strings.ToLower(strings.TrimSpace(v))
	}
	dateCol, err := col("date_column", in.DateColumn)
	if err != nil {
		return nil, err
	}
	if dateCol == "" && (in.DateFrom != "" || in.DateTo != "") {
		return nil, inputErrorf("isi date_column untuk date_from/date_to")
	}
	matched := rows[:0:0]
	for _, row := range rows {
		ok := true
		for c, v := range filters {
			if strings.ToLower(strings.TrimSpace(aiDataText(row[c]))) != v {
				ok = false
				break
			}
		}
		if ok && dateCol != "" {
			d := aiDataText(row[dateCol])
			if len(d) >= 10 {
				d = d[:10]
			}
			if d == "" || (in.DateFrom != "" && d < in.DateFrom) || (in.DateTo != "" && d > in.DateTo) {
				ok = false
			}
		}
		if ok && len(words) > 0 {
			var b strings.Builder
			for _, c := range columns {
				b.WriteString(strings.ToLower(aiDataText(row[c])))
				b.WriteByte(' ')
			}
			text := b.String()
			for _, w := range words {
				if !strings.Contains(text, w) {
					ok = false
					break
				}
			}
		}
		if ok {
			matched = append(matched, row)
		}
	}

	limit := limitOr(in.Limit, 20, 100)
	sumCol, err := col("sum_column", in.SumColumn)
	if err != nil {
		return nil, err
	}
	out := map[string]interface{}{"source": src.Key, "label": src.Label, "total_rows": len(rows), "matched": len(matched)}

	if groupCol, err := col("group_by", in.GroupBy); err != nil {
		return nil, err
	} else if groupCol != "" {
		type group struct {
			Value string  `json:"value"`
			Count int     `json:"count"`
			Sum   float64 `json:"sum,omitempty"`
		}
		byValue := map[string]*group{}
		for _, row := range matched {
			v := aiDataText(row[groupCol])
			if v == "" {
				v = "(kosong)"
			}
			g := byValue[v]
			if g == nil {
				g = &group{Value: v}
				byValue[v] = g
			}
			g.Count++
			if sumCol != "" {
				n, _ := aiDataNumber(row[sumCol])
				g.Sum += n
			}
		}
		groups := make([]*group, 0, len(byValue))
		for _, g := range byValue {
			groups = append(groups, g)
		}
		sort.Slice(groups, func(i, j int) bool {
			if sumCol != "" && groups[i].Sum != groups[j].Sum {
				return groups[i].Sum > groups[j].Sum
			}
			if groups[i].Count != groups[j].Count {
				return groups[i].Count > groups[j].Count
			}
			return groups[i].Value < groups[j].Value
		})
		out["groups_total"] = len(groups)
		if len(groups) > limit {
			groups = groups[:limit]
		}
		out["group_by"], out["groups"] = groupCol, groups
		return out, nil
	}

	if sumCol != "" {
		total := 0.0
		for _, row := range matched {
			n, _ := aiDataNumber(row[sumCol])
			total += n
		}
		out["sum_column"], out["sum"] = sumCol, total
	}
	if sortCol, err := col("sort_by", in.SortBy); err != nil {
		return nil, err
	} else if sortCol != "" {
		compare := func(a, b interface{}) int {
			na, okA := aiDataNumber(a)
			nb, okB := aiDataNumber(b)
			if okA && okB {
				switch {
				case na < nb:
					return -1
				case na > nb:
					return 1
				}
				return 0
			}
			return strings.Compare(aiDataText(a), aiDataText(b))
		}
		sort.SliceStable(matched, func(i, j int) bool {
			c := compare(matched[i][sortCol], matched[j][sortCol])
			if in.SortDesc {
				return c > 0
			}
			return c < 0
		})
	}
	show := columns
	if len(in.Columns) > 0 {
		show = nil
		for _, c := range in.Columns {
			name, err := col("columns", c)
			if err != nil {
				return nil, err
			}
			show = append(show, name)
		}
	}
	list := []map[string]interface{}{}
	for _, row := range matched {
		if len(list) == limit {
			break
		}
		item := map[string]interface{}{}
		for _, c := range show {
			v := row[c]
			if s, ok := v.(string); ok {
				if s == "" {
					continue
				}
				if r := []rune(s); len(r) > aiDataTextLimit {
					v = string(r[:aiDataTextLimit]) + "…"
				}
			}
			if v != nil {
				item[c] = v
			}
		}
		list = append(list, item)
	}
	out["rows"] = list
	if len(matched) > len(list) {
		out["note"] = fmt.Sprintf("menampilkan %d dari %d baris; persempit dengan search/filters atau pakai group_by", len(list), len(matched))
	}
	return out, nil
}

// loadAIDataSource reads a source's rows (visible columns only).
func loadAIDataSource(src aiDataSource) ([]string, []map[string]interface{}, error) {
	if src.Cache != "" {
		return loadAICache(src.Cache)
	}
	rows, err := db.Query(`SELECT * FROM ` + src.Table + ` LIMIT ` + strconv.Itoa(aiDataMaxRows))
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	all, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}
	var columns []string
	for _, c := range all {
		if !aiHiddenColumn.MatchString(c) {
			columns = append(columns, c)
		}
	}
	var out []map[string]interface{}
	for rows.Next() {
		vals := make([]interface{}, len(all))
		ptrs := make([]interface{}, len(all))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, nil, err
		}
		row := map[string]interface{}{}
		for i, c := range all {
			if aiHiddenColumn.MatchString(c) {
				continue
			}
			switch v := vals[i].(type) {
			case []byte:
				row[c] = string(v)
			case fmt.Stringer:
				row[c] = v.String()
			default:
				row[c] = v
			}
		}
		out = append(out, row)
	}
	return columns, out, rows.Err()
}

// loadAICache reads a synced SIAGA list (Redis first, then the database).
func loadAICache(id string) ([]string, []map[string]interface{}, error) {
	var raw string
	if db.RDB != nil {
		if v, err := db.RDB.Get(db.Ctx, "cache:"+id).Result(); err == nil {
			raw = v
		}
	}
	if raw == "" {
		db.QueryRow(`SELECT COALESCE(last_response, '') FROM sync_configs WHERE id = ?`, id).Scan(&raw)
	}
	if strings.TrimSpace(raw) == "" {
		return []string{}, nil, nil
	}
	var list []map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &list); err != nil {
		var wrapped struct {
			Data  []map[string]interface{} `json:"data"`
			Items []map[string]interface{} `json:"items"`
		}
		if err := json.Unmarshal([]byte(raw), &wrapped); err != nil {
			return nil, nil, fmt.Errorf("data %s tidak terbaca: %v", id, err)
		}
		list = wrapped.Data
		if len(list) == 0 {
			list = wrapped.Items
		}
	}
	if len(list) > aiDataMaxRows {
		list = list[:aiDataMaxRows]
	}
	seen := map[string]bool{}
	var columns []string
	for _, row := range list {
		for k, v := range row {
			if aiHiddenColumn.MatchString(k) {
				delete(row, k)
				continue
			}
			switch v.(type) {
			case map[string]interface{}, []interface{}:
				b, _ := json.Marshal(v)
				row[k] = string(b)
			}
			if !seen[k] {
				seen[k] = true
				columns = append(columns, k)
			}
		}
	}
	sort.Strings(columns)
	return columns, list, nil
}

func aiDataText(v interface{}) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	default:
		return fmt.Sprint(x)
	}
}

func aiDataNumber(v interface{}) (float64, bool) {
	switch x := v.(type) {
	case int64:
		return float64(x), true
	case int:
		return float64(x), true
	case float64:
		return x, true
	case bool, nil:
		return 0, false
	}
	n, err := strconv.ParseFloat(strings.TrimSpace(aiDataText(v)), 64)
	return n, err == nil
}
