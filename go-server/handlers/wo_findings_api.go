package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"

	"shipyard/db"
	"shipyard/middleware"
)

// findingRow is one finding with the item, WO and reference it is about.
type findingRow struct {
	WOID         string  `json:"wo_id"`
	ItemID       string  `json:"item_id"`
	Rule         string  `json:"rule"`
	RuleLabel    string  `json:"rule_label"`
	Status       string  `json:"status"`
	Detail       string  `json:"detail"`
	WorkType     string  `json:"work_type"`
	Size         string  `json:"size"`
	Unit         string  `json:"unit"`
	UnitCost     float64 `json:"unit_cost"`
	Reference    float64 `json:"reference"`
	Excess       float64 `json:"excess"`
	FirstSeen    string  `json:"first_seen"`
	ResolvedAt   string  `json:"resolved_at"`
	Note         string  `json:"note"`
	IgnoredBy    string  `json:"ignored_by"`
	IgnoredAt    string  `json:"ignored_at"`
	Label        string  `json:"label"`
	Volume       float64 `json:"volume"`
	ItemStatus   string  `json:"item_status"`
	ApprovalDate string  `json:"approval_date"`
	ActivityName string  `json:"activity_name"`
	WOCode       string  `json:"wo_code"`
	ProjectName  string  `json:"project_name"`
	VendorName   string  `json:"vendor_name"`
	RefN         int     `json:"ref_n"`
	RefP25       float64 `json:"ref_p25"`
	RefP75       float64 `json:"ref_p75"`
	RefBasis     string  `json:"ref_basis"`
}

const findingSelect = `SELECT f.wo_id, f.item_id, f.rule, COALESCE(f.status, 'open'), COALESCE(f.detail, ''),
		COALESCE(f.work_type, ''), COALESCE(f.size, ''), COALESCE(f.unit, ''), COALESCE(f.unit_cost, 0), COALESCE(f.reference, 0),
		COALESCE(f.excess, 0), COALESCE(f.first_seen, ''), COALESCE(f.resolved_at, ''), COALESCE(f.note, ''),
		COALESCE(f.ignored_by, ''), COALESCE(f.ignored_at, ''),
		COALESCE(i.label, ''), COALESCE(i.volume, 0), COALESCE(i.status, ''), COALESCE(i.approval_date, ''), COALESCE(i.activity_name, ''),
		COALESCE(s.wo_code, ''), COALESCE(s.project_name, ''), COALESCE(s.vendor_name, ''),
		COALESCE(r.n, 0), COALESCE(r.p25, 0), COALESCE(r.p75, 0), COALESCE(r.basis, '')
	FROM wo_item_findings f
	LEFT JOIN wo_items i ON i.wo_id = f.wo_id AND i.item_id = f.item_id
	LEFT JOIN work_order_summary s ON s.wo_id = f.wo_id
	LEFT JOIN wo_item_reference r ON r.work_type = f.work_type AND r.size = f.size AND r.unit = f.unit`

func scanFindingRow(scan func(...interface{}) error) (findingRow, error) {
	var f findingRow
	err := scan(&f.WOID, &f.ItemID, &f.Rule, &f.Status, &f.Detail, &f.WorkType, &f.Size, &f.Unit, &f.UnitCost, &f.Reference,
		&f.Excess, &f.FirstSeen, &f.ResolvedAt, &f.Note, &f.IgnoredBy, &f.IgnoredAt,
		&f.Label, &f.Volume, &f.ItemStatus, &f.ApprovalDate, &f.ActivityName,
		&f.WOCode, &f.ProjectName, &f.VendorName, &f.RefN, &f.RefP25, &f.RefP75, &f.RefBasis)
	f.RuleLabel = findingRuleLabels[f.Rule]
	return f, err
}

// findingFilters reads rule, status (open by default; "all" for every
// status), item_status, search, project, vendor and a date range.
func findingFilters(q url.Values) (string, []interface{}) {
	where := []string{"1=1"}
	args := []interface{}{}
	if rule := q.Get("rule"); rule != "" && rule != "all" {
		where = append(where, "f.rule = ?")
		args = append(args, rule)
	}
	status := q.Get("status")
	if status == "" {
		status = "open"
	}
	if status != "all" {
		where = append(where, "COALESCE(f.status, 'open') = ?")
		args = append(args, status)
	}
	if itemStatus := q.Get("item_status"); itemStatus != "" && itemStatus != "all" {
		where = append(where, "i.status = ?")
		args = append(args, itemStatus)
	}
	if search := strings.TrimSpace(q.Get("search")); search != "" {
		like := "%" + strings.ToLower(search) + "%"
		where = append(where, "(LOWER(i.label) LIKE ? OR LOWER(s.wo_code) LIKE ? OR LOWER(f.work_type) LIKE ? OR LOWER(s.project_name) LIKE ? OR LOWER(s.vendor_name) LIKE ?)")
		args = append(args, like, like, like, like, like)
	}
	if project := strings.TrimSpace(q.Get("project")); project != "" && project != "all" {
		where = append(where, "s.project_name = ?")
		args = append(args, project)
	}
	if vendor := strings.TrimSpace(q.Get("vendor")); vendor != "" && vendor != "all" {
		where = append(where, "s.vendor_name = ?")
		args = append(args, vendor)
	}
	// date_from / date_to (YYYY-MM-DD) on the day the finding was first
	// seen, or with date_field=approval on the item's approval date.
	dateCol := "SUBSTR(COALESCE(f.first_seen, ''), 1, 10)"
	if q.Get("date_field") == "approval" {
		dateCol = "SUBSTR(COALESCE(i.approval_date, ''), 1, 10)"
	}
	if from := q.Get("date_from"); from != "" {
		where = append(where, dateCol+" >= ?")
		args = append(args, from)
	}
	if to := q.Get("date_to"); to != "" {
		where = append(where, dateCol+" <> '' AND "+dateCol+" <= ?")
		args = append(args, to)
	}
	return strings.Join(where, " AND "), args
}

func findingOrder(q url.Values) string {
	dir := "DESC"
	if q.Get("dir") == "asc" {
		dir = "ASC"
	}
	switch q.Get("sort") {
	case "ratio":
		return "CASE WHEN COALESCE(f.reference, 0) > 0 THEN f.unit_cost / f.reference ELSE 0 END " + dir + ", f.wo_id, f.item_id"
	case "date":
		return "COALESCE(i.approval_date, '') " + dir + ", f.wo_id, f.item_id"
	case "wo_code":
		return "s.wo_code " + dir + ", f.item_id"
	case "first_seen":
		return "f.first_seen " + dir + ", f.wo_id, f.item_id"
	}
	return "COALESCE(f.excess, 0) " + dir + ", f.wo_id, f.item_id"
}

// GetItemFindings lists findings, worst first by default.
func GetItemFindings(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 25
	}
	where, args := findingFilters(q)

	var total int
	var excess float64
	db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(f.excess), 0) FROM wo_item_findings f
		LEFT JOIN wo_items i ON i.wo_id = f.wo_id AND i.item_id = f.item_id
		LEFT JOIN work_order_summary s ON s.wo_id = f.wo_id WHERE `+where, args...).Scan(&total, &excess)

	rows, err := db.Query(findingSelect+` WHERE `+where+` ORDER BY `+findingOrder(q)+` LIMIT ? OFFSET ?`,
		append(append([]interface{}{}, args...), limit, (page-1)*limit)...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	list := []findingRow{}
	for rows.Next() {
		if f, err := scanFindingRow(rows.Scan); err == nil {
			list = append(list, f)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"data": list, "total": total, "excess": excess, "page": page, "limit": limit})
}

// GetItemFindingsSummary returns counts per rule and status, and when the
// check last ran.
func GetItemFindingsSummary(w http.ResponseWriter, r *http.Request) {
	counts := map[string]map[string]int{}
	excess := map[string]float64{}
	for rule := range findingRuleLabels {
		counts[rule] = map[string]int{"open": 0, "ignored": 0, "resolved": 0}
	}
	rows, err := db.Query(`SELECT rule, COALESCE(status, 'open'), COUNT(*), COALESCE(SUM(excess), 0) FROM wo_item_findings GROUP BY 1, 2`)
	if err == nil {
		for rows.Next() {
			var rule, status string
			var n int
			var ex float64
			if rows.Scan(&rule, &status, &n, &ex) == nil {
				if counts[rule] == nil {
					counts[rule] = map[string]int{}
				}
				counts[rule][status] = n
				if status == "open" {
					excess[rule] = ex
				}
			}
		}
		rows.Close()
	}
	// Open findings on items not approved yet: the ones still fixable in SIAGA.
	openPending := map[string]int{}
	if rows, err := db.Query(`SELECT f.rule, COUNT(*) FROM wo_item_findings f JOIN wo_items i ON i.wo_id = f.wo_id AND i.item_id = f.item_id
		WHERE COALESCE(f.status, 'open') = 'open' AND i.status = 'pending' GROUP BY 1`); err == nil {
		for rows.Next() {
			var rule string
			var n int
			if rows.Scan(&rule, &n) == nil {
				openPending[rule] = n
			}
		}
		rows.Close()
	}
	var lastRun string
	db.QueryRow(`SELECT COALESCE(value, '') FROM app_meta WHERE key = 'wo_findings_last_run'`).Scan(&lastRun)
	var refs int
	db.QueryRow(`SELECT COUNT(*) FROM wo_item_reference`).Scan(&refs)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"counts": counts, "open_excess": excess, "open_pending": openPending, "rules": findingRuleLabels, "last_run": lastRun, "references": refs,
	})
}

// UpdateItemFindingStatus ignores a finding (with a note) or opens it again.
func UpdateItemFindingStatus(w http.ResponseWriter, r *http.Request) {
	var body struct {
		WOID   string `json:"wo_id"`
		ItemID string `json:"item_id"`
		Rule   string `json:"rule"`
		Status string `json:"status"`
		Note   string `json:"note"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.WOID == "" || body.ItemID == "" || body.Rule == "" {
		http.Error(w, `{"error": "wo_id, item_id dan rule wajib diisi"}`, http.StatusBadRequest)
		return
	}
	user := ""
	if claims, ok := middleware.GetUserClaims(r); ok {
		user = claims.Name
		if user == "" {
			user = claims.Email
		}
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	var res interface{ RowsAffected() (int64, error) }
	var err error
	switch body.Status {
	case "ignored":
		if strings.TrimSpace(body.Note) == "" {
			http.Error(w, `{"error": "Alasan wajib diisi saat mengabaikan temuan"}`, http.StatusBadRequest)
			return
		}
		res, err = db.Exec(`UPDATE wo_item_findings SET status = 'ignored', note = ?, ignored_by = ?, ignored_at = ?
			WHERE wo_id = ? AND item_id = ? AND rule = ? AND COALESCE(status, 'open') <> 'resolved'`,
			strings.TrimSpace(body.Note), user, now, body.WOID, body.ItemID, body.Rule)
	case "open":
		res, err = db.Exec(`UPDATE wo_item_findings SET status = 'open', note = NULL, ignored_by = NULL, ignored_at = NULL
			WHERE wo_id = ? AND item_id = ? AND rule = ? AND status = 'ignored'`, body.WOID, body.ItemID, body.Rule)
	default:
		http.Error(w, `{"error": "status harus ignored atau open"}`, http.StatusBadRequest)
		return
	}
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		http.Error(w, `{"error": "Temuan tidak ditemukan atau statusnya sudah berubah"}`, http.StatusConflict)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok": true}`))
}

// RunItemFindingsHandler runs the check now (Admin).
func RunItemFindingsHandler(w http.ResponseWriter, r *http.Request) {
	res, err := RunItemFindings()
	w.Header().Set("Content-Type", "application/json")
	if err != nil {
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(res)
}

// GetItemReferences lists reference unit costs, most used first.
func GetItemReferences(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	limit, _ := strconv.Atoi(q.Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 25
	}
	where := "1=1"
	args := []interface{}{}
	if search := strings.TrimSpace(q.Get("search")); search != "" {
		where = "LOWER(work_type) LIKE ?"
		args = append(args, "%"+strings.ToLower(search)+"%")
	}
	var total int
	db.QueryRow(`SELECT COUNT(*) FROM wo_item_reference WHERE `+where, args...).Scan(&total)
	rows, err := db.Query(`SELECT work_type, size, unit, n, p25, median, p75, min_cost, max_cost, COALESCE(basis, ''), COALESCE(date_from, ''), COALESCE(date_to, '')
		FROM wo_item_reference WHERE `+where+` ORDER BY n DESC, work_type, size, unit LIMIT ? OFFSET ?`,
		append(args, limit, (page-1)*limit)...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	type ref struct {
		WorkType string  `json:"work_type"`
		Size     string  `json:"size"`
		Unit     string  `json:"unit"`
		N        int     `json:"n"`
		P25      float64 `json:"p25"`
		Median   float64 `json:"median"`
		P75      float64 `json:"p75"`
		Min      float64 `json:"min"`
		Max      float64 `json:"max"`
		Basis    string  `json:"basis"`
		DateFrom string  `json:"date_from"`
		DateTo   string  `json:"date_to"`
	}
	list := []ref{}
	for rows.Next() {
		var x ref
		if rows.Scan(&x.WorkType, &x.Size, &x.Unit, &x.N, &x.P25, &x.Median, &x.P75, &x.Min, &x.Max, &x.Basis, &x.DateFrom, &x.DateTo) == nil {
			list = append(list, x)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"data": list, "total": total, "page": page, "limit": limit})
}

var findingStatusLabels = map[string]string{"open": "Perlu dicek", "ignored": "Diabaikan", "resolved": "Selesai"}

// ExportItemFindings writes the filtered findings to an .xlsx file.
func ExportItemFindings(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where, args := findingFilters(q)
	rows, err := db.Query(findingSelect+` WHERE `+where+` ORDER BY `+findingOrder(q), args...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	f := excelize.NewFile()
	defer f.Close()
	const sheet = "Data Perlu Dicek"
	f.SetSheetName("Sheet1", sheet)
	sw, err := f.NewStreamWriter(sheet)
	if err == nil {
		var styles exportStyles
		if styles, err = newExportStyles(f); err == nil {
			cols := []exportColumn{{"Kode WO", 18}, {"Proyek", 32}, {"Vendor", 28}, {"Item", 60}, {"Jenis Pekerjaan", 34}, {"Ukuran", 14},
				{"Satuan", 10}, {"Volume", 10}, {"Harga Satuan", 16}, {"Median Acuan", 16}, {"Rentang Acuan (P25 - P75)", 26},
				{"Selisih (Rp)", 16}, {"Temuan", 26}, {"Keterangan", 60}, {"Status Item", 12}, {"Tanggal Approval", 14},
				{"Status Temuan", 14}, {"Alasan Diabaikan", 40}}
			for i, c := range cols {
				sw.SetColWidth(i+1, i+1, c.width)
			}
			header := make([]interface{}, len(cols))
			for i, c := range cols {
				header[i] = excelize.Cell{StyleID: styles.header, Value: c.title}
			}
			if err = sw.SetRow("A1", header); err == nil {
				n := 1
				for rows.Next() && err == nil {
					var fr findingRow
					if fr, err = scanFindingRow(rows.Scan); err != nil {
						break
					}
					n++
					refRange := ""
					if fr.RefN > 0 {
						refRange = formatRupiah(fr.RefP25) + " - " + formatRupiah(fr.RefP75)
					}
					cell, _ := excelize.CoordinatesToCellName(1, n)
					err = sw.SetRow(cell, []interface{}{
						fr.WOCode, fr.ProjectName, fr.VendorName, fr.Label, fr.WorkType, fr.Size, fr.Unit,
						excelize.Cell{StyleID: styles.number, Value: fr.Volume},
						excelize.Cell{StyleID: styles.money, Value: fr.UnitCost},
						excelize.Cell{StyleID: styles.money, Value: fr.Reference},
						refRange,
						excelize.Cell{StyleID: styles.money, Value: fr.Excess},
						fr.RuleLabel, fr.Detail, woItemStatusLabels[fr.ItemStatus], dateOnly(fr.ApprovalDate),
						findingStatusLabels[fr.Status], fr.Note,
					})
				}
			}
			if err == nil {
				err = sw.Flush()
			}
		}
	}
	if err != nil {
		log.Printf("findings export failed: %v", err)
		http.Error(w, `{"error": "Gagal membuat file Excel"}`, http.StatusInternalServerError)
		return
	}
	filename := fmt.Sprintf("Data_Perlu_Dicek_%s.xlsx", time.Now().Format("20060102_1504"))
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	if err := f.Write(w); err != nil {
		log.Printf("findings export write failed: %v", err)
	}
}
