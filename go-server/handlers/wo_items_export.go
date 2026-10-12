package handlers

import (
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"

	"shipyard/db"
)

// Excel export of the Item Pekerjaan WO page: every row of the selected view
// that matches the page's filters and sort, not just the visible page.

// ResourceWorkOrderItems is the Role Management resource of the Item Pekerjaan
// WO menu (view for the page, export for the Excel file).
const ResourceWorkOrderItems = "Item Pekerjaan WO"

// woItemExportMaxRows keeps an export inside Excel's 1,048,576-row sheet limit.
const woItemExportMaxRows = 1000000

var woItemViewLabels = map[string]string{
	"list":             "Daftar Item",
	"project_item":     "Per Proyek per Item",
	"project_activity": "Per Proyek per Aktivitas",
	"activity":         "Per Aktivitas",
	"item":             "Per Item (Biaya)",
	"category":         "Per Kategori",
	"vendor_activity":  "Per Vendor per Aktivitas",
}

var woItemColumnLabels = map[string]string{
	"project_name":  "Proyek",
	"label":         "Item",
	"unit":          "Satuan",
	"activity_name": "Aktivitas",
	"category":      "Kategori",
	"vendor_name":   "Vendor",
}

var woItemStatusLabels = map[string]string{"approved": "Approved", "pending": "Pending", "rejected": "Rejected"}

type exportStyles struct{ header, money, number, integer int }

func newExportStyles(f *excelize.File) (exportStyles, error) {
	var s exportStyles
	var err error
	if s.header, err = f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "1E293B"},
		Fill:      excelize.Fill{Type: "pattern", Color: []string{"E2E8F0"}, Pattern: 1},
		Alignment: &excelize.Alignment{Vertical: "center", WrapText: true},
	}); err != nil {
		return s, err
	}
	if s.money, err = f.NewStyle(&excelize.Style{NumFmt: 3}); err != nil { // #,##0
		return s, err
	}
	numberFmt := "#,##0.##"
	if s.number, err = f.NewStyle(&excelize.Style{CustomNumFmt: &numberFmt}); err != nil {
		return s, err
	}
	s.integer = s.money
	return s, nil
}

type exportColumn struct {
	title string
	width float64
}

// ExportWorkOrderItems streams the selected view as an .xlsx file.
func ExportWorkOrderItems(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	view := q.Get("view")
	if view == "" {
		view = "list"
	}
	viewLabel, ok := woItemViewLabels[view]
	if !ok {
		http.Error(w, `{"error": "Tampilan tidak dikenal"}`, http.StatusBadRequest)
		return
	}

	f := excelize.NewFile()
	defer f.Close()
	const sheet = "Item Pekerjaan"
	f.SetSheetName("Sheet1", sheet)
	sw, err := f.NewStreamWriter(sheet)
	if err == nil {
		var styles exportStyles
		if styles, err = newExportStyles(f); err == nil {
			var written int
			var truncated bool
			if view == "list" {
				written, truncated, err = writeWoItemList(sw, styles, q)
			} else {
				written, truncated, err = writeWoItemSummary(sw, styles, q, woItemGroups[view])
			}
			if err == nil {
				if err = sw.Flush(); err == nil {
					err = writeExportFilterSheet(f, q, viewLabel, written, truncated)
				}
			}
		}
	}
	if err != nil {
		log.Printf("wo-items export (%s) failed: %v", view, err)
		http.Error(w, `{"error": "Gagal membuat file Excel"}`, http.StatusInternalServerError)
		return
	}

	filename := fmt.Sprintf("Item_Pekerjaan_WO_%s_%s.xlsx", view, time.Now().Format("20060102_1504"))
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	if err := f.Write(w); err != nil {
		log.Printf("wo-items export write failed: %v", err)
	}
}

// startSheet sets column widths, freezes the header row and writes it.
func startSheet(sw *excelize.StreamWriter, styles exportStyles, columns []exportColumn) error {
	for i, c := range columns {
		if err := sw.SetColWidth(i+1, i+1, c.width); err != nil {
			return err
		}
	}
	if err := sw.SetPanes(&excelize.Panes{Freeze: true, YSplit: 1, TopLeftCell: "A2", ActivePane: "bottomLeft"}); err != nil {
		return err
	}
	header := make([]interface{}, len(columns))
	for i, c := range columns {
		header[i] = excelize.Cell{StyleID: styles.header, Value: c.title}
	}
	return sw.SetRow("A1", header, excelize.RowOpts{Height: 20})
}

func writeWoItemList(sw *excelize.StreamWriter, styles exportStyles, q url.Values) (int, bool, error) {
	columns := []exportColumn{
		{"No", 7}, {"Tanggal", 12}, {"Tgl Approval", 12}, {"Status", 11}, {"Level Approval", 9},
		{"Kode WO", 16}, {"Kode JO", 18}, {"Proyek", 34}, {"Jenis Project", 12}, {"Vendor", 28},
		{"Kategori", 22}, {"Aktivitas", 44}, {"Path", 11}, {"Item Pekerjaan", 44}, {"Satuan", 9},
		{"Volume", 11}, {"Biaya Satuan", 16}, {"Total Biaya", 18},
	}
	if err := startSheet(sw, styles, columns); err != nil {
		return 0, false, err
	}

	where, args := woItemFilters(q)
	rows, err := db.Query(woItemColumns+woItemFrom+where+` ORDER BY `+woItemOrder(q)+` LIMIT ?`, append(args, woItemExportMaxRows+1)...)
	if err != nil {
		return 0, false, err
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		if n == woItemExportMaxRows {
			return n, true, nil
		}
		it, err := scanWoItem(rows)
		if err != nil {
			return n, false, err
		}
		n++
		cell, _ := excelize.CoordinatesToCellName(1, n+1)
		if err := sw.SetRow(cell, []interface{}{
			n, it.ItemDate, it.ApprovalDate, statusLabel(it.Status), it.Level,
			it.WOCode, it.JOCode, it.ProjectName, it.ProjectType, vendorLabel(it.VendorName),
			it.Category, it.ActivityName, it.Path, it.Label, it.Unit,
			excelize.Cell{StyleID: styles.number, Value: it.Volume},
			excelize.Cell{StyleID: styles.money, Value: it.UnitCost},
			excelize.Cell{StyleID: styles.money, Value: it.TotalCost},
		}); err != nil {
			return n, false, err
		}
	}
	return n, false, rows.Err()
}

func writeWoItemSummary(sw *excelize.StreamWriter, styles exportStyles, q url.Values, group woItemGroup) (int, bool, error) {
	columns := []exportColumn{{"No", 7}}
	for _, name := range group.labels {
		width := 40.0
		if name == "unit" {
			width = 10
		}
		columns = append(columns, exportColumn{woItemColumnLabels[name], width})
	}
	columns = append(columns,
		exportColumn{"Jumlah Item", 11}, exportColumn{"Jumlah WO", 11}, exportColumn{"Total Volume", 13},
		exportColumn{"Biaya Min", 16}, exportColumn{"Biaya Rata-rata", 16}, exportColumn{"Biaya Maks", 16},
		exportColumn{"Tgl Terbaru", 12}, exportColumn{"Total Biaya", 18},
	)
	if err := startSheet(sw, styles, columns); err != nil {
		return 0, false, err
	}

	where, args := woItemFilters(q)
	rows, err := db.Query(woItemSummarySQL(q, group, where)+` LIMIT ?`, append(args, woItemExportMaxRows+1)...)
	if err != nil {
		return 0, false, err
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		if n == woItemExportMaxRows {
			return n, true, nil
		}
		s, err := scanWoItemSummary(rows, group)
		if err != nil {
			return n, false, err
		}
		n++
		values := []interface{}{n}
		for i, name := range group.labels {
			if name == "vendor_name" {
				values = append(values, vendorLabel(s.Keys[i]))
			} else {
				values = append(values, s.Keys[i])
			}
		}
		values = append(values,
			excelize.Cell{StyleID: styles.integer, Value: s.ItemCount},
			excelize.Cell{StyleID: styles.integer, Value: s.WOCount},
			excelize.Cell{StyleID: styles.number, Value: s.Volume},
			excelize.Cell{StyleID: styles.money, Value: s.MinCost},
			excelize.Cell{StyleID: styles.money, Value: s.AvgCost},
			excelize.Cell{StyleID: styles.money, Value: s.MaxCost},
			s.LatestDate,
			excelize.Cell{StyleID: styles.money, Value: s.Cost},
		)
		cell, _ := excelize.CoordinatesToCellName(1, n+1)
		if err := sw.SetRow(cell, values); err != nil {
			return n, false, err
		}
	}
	return n, false, rows.Err()
}

// writeExportFilterSheet records what the export contains, so a file opened
// later still says which view, filters and sort produced it.
func writeExportFilterSheet(f *excelize.File, q url.Values, viewLabel string, rows int, truncated bool) error {
	const sheet = "Filter"
	if _, err := f.NewSheet(sheet); err != nil {
		return err
	}
	orAll := func(v, all string) string {
		if v = strings.TrimSpace(v); v == "" || v == "All" {
			return all
		}
		return v
	}
	projectType := map[string]string{"external": "External (Kapal)", "internal": "Internal (Fasilitas)"}[q.Get("project_type")]
	if projectType == "" {
		projectType = "Semua"
	}
	sortBy := q.Get("sort")
	if sortBy == "" {
		sortBy = "tanggal terbaru"
	}
	rowCount := fmt.Sprintf("%d", rows)
	if truncated {
		rowCount += fmt.Sprintf(" (dipotong, batas Excel %d baris)", woItemExportMaxRows)
	}
	lines := [][2]string{
		{"Tampilan", viewLabel},
		{"Pencarian", orAll(q.Get("search"), "-")},
		{"Jenis Project", projectType},
		{"Kategori", orAll(q.Get("category"), "Semua Kategori")},
		{"Status Approval", orAll(statusLabel(q.Get("status")), "Semua Status")},
		{"Proyek", orAll(q.Get("project"), "Semua Proyek")},
		{"Vendor", orAll(q.Get("vendor"), "Semua Vendor")},
		{"Tanggal Approval Dari", orAll(q.Get("start_date"), "-")},
		{"Tanggal Approval Sampai", orAll(q.Get("end_date"), "-")},
		{"Urutan", sortBy + " " + strings.ToLower(sortDir(q))},
		{"Jumlah Baris", rowCount},
		{"Diekspor Pada", time.Now().Format("2006-01-02 15:04")},
	}
	for i, l := range lines {
		if err := f.SetSheetRow(sheet, fmt.Sprintf("A%d", i+1), &[]interface{}{l[0], l[1]}); err != nil {
			return err
		}
	}
	if err := f.SetColWidth(sheet, "A", "A", 24); err != nil {
		return err
	}
	return f.SetColWidth(sheet, "B", "B", 60)
}

func statusLabel(status string) string {
	if label, ok := woItemStatusLabels[status]; ok {
		return label
	}
	return status
}
