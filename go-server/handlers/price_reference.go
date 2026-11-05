package handlers

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"

	"shipyard/db"
)

// ResourcePriceReference is the RBAC resource of the Harga Acuan menu.
const ResourcePriceReference = "Harga Acuan"

// Harga Acuan: the reference unit costs the findings job keeps in
// wo_item_reference (per work type, size and unit, from approved items),
// searchable, with each group's yearly trend, vendors and the items behind it.

type priceReference struct {
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

// priceReferenceFilter: every word of search must appear in the work type or
// the size ("packing 2" finds Ganti baru packing karet, Ø 2" x 3 mm).
func priceReferenceFilter(q url.Values) (string, []interface{}) {
	where := []string{"1=1"}
	args := []interface{}{}
	for _, word := range strings.Fields(strings.ToLower(q.Get("search"))) {
		where = append(where, "(LOWER(work_type) LIKE ? OR LOWER(size) LIKE ?)")
		like := "%" + word + "%"
		args = append(args, like, like)
	}
	if unit := strings.TrimSpace(q.Get("unit")); unit != "" && unit != "all" {
		where = append(where, "unit = ?")
		args = append(args, strings.ToLower(unit))
	}
	return strings.Join(where, " AND "), args
}

func priceReferenceOrder(q url.Values) string {
	dir := sortDir(q)
	switch q.Get("sort") {
	case "median":
		return "median " + dir + ", work_type, size, unit"
	case "work_type":
		return "work_type " + dir + ", size, unit"
	case "spread":
		// How wide the usual range is relative to the median.
		return "CASE WHEN median > 0 THEN (p75 - p25) / median ELSE 0 END " + dir + ", work_type, size, unit"
	}
	return "n " + dir + ", work_type, size, unit"
}

const priceReferenceColumns = `SELECT work_type, size, unit, n, p25, median, p75, min_cost, max_cost, COALESCE(basis, ''), COALESCE(date_from, ''), COALESCE(date_to, '')
	FROM wo_item_reference`

func scanPriceReference(scan func(...interface{}) error) (priceReference, error) {
	var x priceReference
	err := scan(&x.WorkType, &x.Size, &x.Unit, &x.N, &x.P25, &x.Median, &x.P75, &x.Min, &x.Max, &x.Basis, &x.DateFrom, &x.DateTo)
	return x, err
}

// GetPriceReferences lists reference unit costs, most compared first.
func GetPriceReferences(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	page, limit := pageParams(q, 25, 200)
	where, args := priceReferenceFilter(q)
	var total int
	db.QueryRow(`SELECT COUNT(*) FROM wo_item_reference WHERE `+where, args...).Scan(&total)
	rows, err := db.Query(priceReferenceColumns+` WHERE `+where+` ORDER BY `+priceReferenceOrder(q)+` LIMIT ? OFFSET ?`,
		append(append([]interface{}{}, args...), limit, (page-1)*limit)...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	list := []priceReference{}
	for rows.Next() {
		if x, err := scanPriceReference(rows.Scan); err == nil {
			list = append(list, x)
		}
	}
	var lastRun string
	db.QueryRow(`SELECT COALESCE(value, '') FROM app_meta WHERE key = 'wo_findings_last_run'`).Scan(&lastRun)
	units := []string{}
	if urows, err := db.Query(`SELECT unit FROM wo_item_reference GROUP BY unit ORDER BY COUNT(*) DESC LIMIT 40`); err == nil {
		for urows.Next() {
			var u string
			if urows.Scan(&u) == nil && u != "" {
				units = append(units, u)
			}
		}
		urows.Close()
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"data": list, "total": total, "page": page, "limit": limit, "updated_at": lastRun, "units": units,
		"min_items": referenceMinItems, "window_months": referenceWindowMonths,
	})
}

// priceStats summarises a set of unit costs.
type priceStats struct {
	Label  string  `json:"label"`
	N      int     `json:"n"`
	P25    float64 `json:"p25"`
	Median float64 `json:"median"`
	P75    float64 `json:"p75"`
	Min    float64 `json:"min"`
	Max    float64 `json:"max"`
}

func statsOf(label string, costs []float64) priceStats {
	sorted := append([]float64{}, costs...)
	sort.Float64s(sorted)
	s := priceStats{Label: label, N: len(sorted)}
	if len(sorted) > 0 {
		s.P25, s.Median, s.P75 = quantile(sorted, .25), quantile(sorted, .5), quantile(sorted, .75)
		s.Min, s.Max = sorted[0], sorted[len(sorted)-1]
	}
	return s
}

// referenceItem is one approved item a reference is built from.
type referenceItem struct {
	WOID         string  `json:"wo_id"`
	WOCode       string  `json:"wo_code"`
	ProjectName  string  `json:"project_name"`
	VendorName   string  `json:"vendor_name"`
	Label        string  `json:"label"`
	Volume       float64 `json:"volume"`
	UnitCost     float64 `json:"unit_cost"`
	ApprovalDate string  `json:"approval_date"`
	Position     string  `json:"position"` // below / within / above the usual range (P25-P75)
}

// loadReferenceItems reads the approved, comparable items of one group, as
// buildReferences counts them, newest first.
func loadReferenceItems(workType, size, unit string) ([]referenceItem, error) {
	rows, err := db.Query(`SELECT i.wo_id, COALESCE(s.wo_code, ''), COALESCE(s.project_name, ''), COALESCE(s.vendor_name, ''), COALESCE(i.label, ''),
			COALESCE(i.volume, 0), COALESCE(i.unit_cost, 0), COALESCE(i.approval_date, ''), COALESCE(p.action, ''), COALESCE(p.object, '')
		FROM wo_item_parsed p JOIN wo_items i ON i.wo_id = p.wo_id AND i.item_id = p.item_id
		LEFT JOIN work_order_summary s ON s.wo_id = i.wo_id
		WHERE p.recognized AND p.work_type = ? AND COALESCE(p.size, '') = ? AND LOWER(TRIM(COALESCE(i.unit, ''))) = ?
			AND i.status = 'approved' AND i.unit_cost > 0
		ORDER BY i.approval_date DESC, i.wo_id`, workType, size, unit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []referenceItem
	for rows.Next() {
		var it referenceItem
		var action, object string
		if err := rows.Scan(&it.WOID, &it.WOCode, &it.ProjectName, &it.VendorName, &it.Label, &it.Volume, &it.UnitCost, &it.ApprovalDate, &action, &object); err != nil {
			return nil, err
		}
		if !unitPriceComparable(action, object, it.Label) {
			continue
		}
		it.ApprovalDate = dateOnly(it.ApprovalDate)
		items = append(items, it)
	}
	return items, rows.Err()
}

// GetPriceReferenceDetail returns one reference with its yearly trend, its
// vendors and the items it is built from (newest 100).
func GetPriceReferenceDetail(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	workType, size, unit := q.Get("work_type"), q.Get("size"), strings.ToLower(strings.TrimSpace(q.Get("unit")))
	ref, err := scanPriceReference(db.QueryRow(priceReferenceColumns+` WHERE work_type = ? AND size = ? AND unit = ?`, workType, size, unit).Scan)
	if err != nil {
		http.Error(w, `{"error": "Harga acuan tidak ditemukan"}`, http.StatusNotFound)
		return
	}
	items, err := loadReferenceItems(workType, size, unit)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}

	byYear, byVendor := map[string][]float64{}, map[string][]float64{}
	for i := range items {
		it := &items[i]
		switch {
		case it.UnitCost < ref.P25:
			it.Position = "below"
		case it.UnitCost > ref.P75:
			it.Position = "above"
		default:
			it.Position = "within"
		}
		if len(it.ApprovalDate) >= 4 {
			byYear[it.ApprovalDate[:4]] = append(byYear[it.ApprovalDate[:4]], it.UnitCost)
		}
		byVendor[vendorLabel(it.VendorName)] = append(byVendor[vendorLabel(it.VendorName)], it.UnitCost)
	}
	years := []priceStats{}
	for year, costs := range byYear {
		years = append(years, statsOf(year, costs))
	}
	sort.Slice(years, func(i, j int) bool { return years[i].Label < years[j].Label })
	vendors := []priceStats{}
	for vendor, costs := range byVendor {
		vendors = append(vendors, statsOf(vendor, costs))
	}
	sort.Slice(vendors, func(i, j int) bool {
		if vendors[i].N != vendors[j].N {
			return vendors[i].N > vendors[j].N
		}
		return vendors[i].Label < vendors[j].Label
	})
	if len(vendors) > 15 {
		vendors = vendors[:15]
	}
	shown := items
	if len(shown) > 100 {
		shown = shown[:100]
	}
	if shown == nil {
		shown = []referenceItem{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"reference": ref, "years": years, "vendors": vendors, "items": shown, "item_count": len(items),
	})
}

// ExportPriceReferences writes the filtered references to an .xlsx file.
func ExportPriceReferences(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	where, args := priceReferenceFilter(q)
	rows, err := db.Query(priceReferenceColumns+` WHERE `+where+` ORDER BY `+priceReferenceOrder(q), args...)
	if err != nil {
		http.Error(w, `{"error": "`+err.Error()+`"}`, http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	f := excelize.NewFile()
	defer f.Close()
	const sheet = "Harga Acuan"
	f.SetSheetName("Sheet1", sheet)
	sw, err := f.NewStreamWriter(sheet)
	if err == nil {
		var styles exportStyles
		if styles, err = newExportStyles(f); err == nil {
			cols := []exportColumn{{"Jenis Pekerjaan", 40}, {"Ukuran", 18}, {"Satuan", 10}, {"Median", 16}, {"P25 (batas bawah wajar)", 18},
				{"P75 (batas atas wajar)", 18}, {"Terendah", 16}, {"Tertinggi", 16}, {"Jumlah Item", 12}, {"Dasar", 12}, {"Dari", 12}, {"Sampai", 12}}
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
					var x priceReference
					if x, err = scanPriceReference(rows.Scan); err != nil {
						break
					}
					n++
					cell, _ := excelize.CoordinatesToCellName(1, n)
					money := func(v float64) excelize.Cell { return excelize.Cell{StyleID: styles.money, Value: v} }
					err = sw.SetRow(cell, []interface{}{x.WorkType, x.Size, x.Unit, money(x.Median), money(x.P25), money(x.P75),
						money(x.Min), money(x.Max), excelize.Cell{StyleID: styles.integer, Value: x.N}, x.Basis, x.DateFrom, x.DateTo})
				}
			}
			if err == nil {
				err = sw.Flush()
			}
		}
	}
	if err != nil {
		log.Printf("price reference export failed: %v", err)
		http.Error(w, `{"error": "Gagal membuat file Excel"}`, http.StatusInternalServerError)
		return
	}
	filename := fmt.Sprintf("Harga_Acuan_%s.xlsx", time.Now().Format("20060102_1504"))
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	if err := f.Write(w); err != nil {
		log.Printf("price reference export write failed: %v", err)
	}
}
