package handlers

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"shipyard/db"
	"shipyard/middleware"
)

// ResourceInventory is the RBAC resource of the Persediaan Material menu.
const ResourceInventory = "Persediaan Material"

// Persediaan Material shows the Master Inventory workbook: the workbook's
// macro replaces each table here on every sync (POST /api/inventory/sync/*),
// and the page lists, filters and totals them. Stock is never calculated
// here; the workbook's FIFO figures are stored as they are.

type invDataset struct {
	Key     string
	Table   string
	Search  []string // every search word must match one of these
	Filters []string // exact-match filters, offered with their values
	DateCol string   // date_from / date_to filter
	Sums    []string // totals of the filtered rows
	Order   string   // default ORDER BY
}

var invDatasets = map[string]invDataset{
	"stok": {Key: "stok", Table: "inv_stock",
		Search: []string{"nama", "ukuran", "kategori", "id_saldo_awal"}, Filters: []string{"status", "kategori", "gudang"},
		Sums: []string{"nilai_stok", "stok_akhir"}, Order: "kategori, nama, ukuran"},
	"pembelian": {Key: "pembelian", Table: "inv_purchases",
		Search: []string{"nama", "ukuran", "kategori", "id_pembelian", "no_po", "pemasok", "catatan"}, Filters: []string{"proyek", "pemasok", "kategori", "gudang"},
		DateCol: "tanggal", Sums: []string{"nilai", "nilai_sisa"}, Order: "tanggal DESC, id_pembelian DESC"},
	"pemakaian": {Key: "pemakaian", Table: "inv_usages",
		Search: []string{"nama", "ukuran", "kategori", "id_pemakaian", "no_dokumen", "pemakai", "catatan"}, Filters: []string{"proyek", "pemakai", "kategori", "gudang"},
		DateCol: "tanggal", Sums: []string{"biaya_fifo"}, Order: "tanggal DESC, id_pemakaian DESC"},
	"saldo-awal": {Key: "saldo-awal", Table: "inv_opening_balances",
		Search: []string{"nama", "ukuran", "kategori", "id_saldo_awal", "catatan"}, Filters: []string{"kategori", "gudang"},
		DateCol: "tanggal", Sums: []string{"nilai", "nilai_sisa"}, Order: "kategori, nama, ukuran, tanggal"},
	"material": {Key: "material", Table: "inv_materials",
		Search: []string{"nama", "ukuran", "kategori", "coda"}, Filters: []string{"kategori", "satuan"},
		Order: "kategori, nama, ukuran"},
}

// stockNeedsOrder are the workbook's statuses counted as "perlu pesan ulang".
var stockNeedsOrder = []string{"PESAN ULANG", "STOK NEGATIF"}

const (
	invMaxRows    = 50000
	invMaxBody    = 64 << 20
	invInsertRows = 200
)

func invDatasetOf(w http.ResponseWriter, r *http.Request) (invDataset, bool) {
	ds, ok := invDatasets[chi.URLParam(r, "dataset")]
	if !ok {
		writeJSON(w, 404, map[string]string{"error": "Data persediaan tidak dikenal: " + chi.URLParam(r, "dataset")})
	}
	return ds, ok
}

func invColumnNames(table string) []string {
	cols := db.InventoryTables[table]
	names := make([]string, len(cols))
	for i, c := range cols {
		names[i] = c.Name
	}
	return names
}

type invSyncInfo struct {
	At     string `json:"at"`
	By     string `json:"by"`
	Rows   int    `json:"rows"`
	Source string `json:"source"`
}

func invMetaKey(ds invDataset) string { return "inv_sync_" + ds.Key }

func invLastSync(ds invDataset) *invSyncInfo {
	var raw string
	if db.QueryRow("SELECT value FROM app_meta WHERE key = ?", invMetaKey(ds)).Scan(&raw) != nil {
		return nil
	}
	var info invSyncInfo
	if json.Unmarshal([]byte(raw), &info) != nil {
		return nil
	}
	return &info
}

var invDatePrefix = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}`)

// excelEpoch is day 0 of Excel's date serials (1900 date system).
var excelEpoch = time.Date(1899, 12, 30, 0, 0, 0, 0, time.UTC)

// invValue converts one value from the workbook to its column's type; the
// second result says why a value was dropped.
func invValue(kind db.InventoryKind, v any) (any, string) {
	switch x := v.(type) {
	case nil:
		return nil, ""
	case bool:
		if kind == db.InvText {
			return strconv.FormatBool(x), ""
		}
		return nil, "bukan angka/tanggal"
	case float64:
		if math.IsNaN(x) || math.IsInf(x, 0) {
			return nil, "angka tidak valid"
		}
		switch kind {
		case db.InvText:
			return strconv.FormatFloat(x, 'f', -1, 64), ""
		case db.InvDate:
			return excelEpoch.AddDate(0, 0, int(x)).Format("2006-01-02"), ""
		}
		return x, ""
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			return nil, ""
		}
		switch kind {
		case db.InvNum:
			f, err := strconv.ParseFloat(s, 64)
			if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
				return nil, fmt.Sprintf("%q bukan angka", s)
			}
			return f, ""
		case db.InvDate:
			if m := invDatePrefix.FindString(s); m != "" {
				return m, ""
			}
			return nil, fmt.Sprintf("%q bukan tanggal YYYY-MM-DD", s)
		}
		return s, ""
	}
	return nil, fmt.Sprintf("jenis nilai %T tidak didukung", v)
}

// SyncInventory handles POST /api/inventory/sync/{dataset}: replaces the
// table with the rows sent by the workbook macro, in one transaction.
// Body: {"rows": [{"column": value, ...}], "source": "file name"}.
func SyncInventory(w http.ResponseWriter, r *http.Request) {
	ds, ok := invDatasetOf(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, invMaxBody)
	var body struct {
		Rows   []map[string]any `json:"rows"`
		Source string           `json:"source"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "Body JSON tidak valid: " + err.Error()})
		return
	}
	// An empty upload would wipe the table; only on purpose.
	if len(body.Rows) == 0 && r.URL.Query().Get("allow_empty") != "1" {
		writeJSON(w, 400, map[string]string{"error": "Tidak ada baris yang dikirim; data lama tidak diubah. Tambahkan ?allow_empty=1 untuk mengosongkan tabel."})
		return
	}
	if len(body.Rows) > invMaxRows {
		writeJSON(w, 400, map[string]string{"error": fmt.Sprintf("Terlalu banyak baris (%d, maksimal %d)", len(body.Rows), invMaxRows)})
		return
	}

	cols := db.InventoryTables[ds.Table]
	known := map[string]bool{}
	for _, c := range cols {
		known[c.Name] = true
	}
	unknown := map[string]bool{}
	for _, row := range body.Rows {
		for k := range row {
			if !known[k] {
				unknown[k] = true
			}
		}
	}
	if len(unknown) > 0 {
		names := make([]string, 0, len(unknown))
		for k := range unknown {
			names = append(names, k)
		}
		sort.Strings(names)
		writeJSON(w, 400, map[string]any{"error": "Kolom tidak dikenal: " + strings.Join(names, ", "), "columns": invColumnNames(ds.Table)})
		return
	}

	now := time.Now().UTC().Format(time.RFC3339)
	warnings := []string{}
	warningCount := 0
	values := make([][]any, len(body.Rows))
	for i, row := range body.Rows {
		vals := make([]any, 0, len(cols)+2)
		vals = append(vals, i+1)
		for _, c := range cols {
			v, warn := invValue(c.Kind, row[c.Name])
			if warn != "" {
				warningCount++
				if len(warnings) < 20 {
					warnings = append(warnings, fmt.Sprintf("Baris %d, kolom %s: %s", i+1, c.Name, warn))
				}
			}
			vals = append(vals, v)
		}
		values[i] = append(vals, now)
	}

	tx, err := db.DB.Begin()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	defer tx.Rollback()
	if _, err := tx.Exec("DELETE FROM " + ds.Table); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	colList := "row_no, " + strings.Join(invColumnNames(ds.Table), ", ") + ", synced_at"
	rowMarks := "(" + strings.TrimSuffix(strings.Repeat("?, ", len(cols)+2), ", ") + ")"
	for start := 0; start < len(values); start += invInsertRows {
		end := min(start+invInsertRows, len(values))
		marks := make([]string, 0, end-start)
		args := make([]any, 0, (end-start)*(len(cols)+2))
		for _, vals := range values[start:end] {
			marks = append(marks, rowMarks)
			args = append(args, vals...)
		}
		q := "INSERT INTO " + ds.Table + " (" + colList + ") VALUES " + strings.Join(marks, ", ")
		if _, err := tx.Exec(db.FormatQuery(q), args...); err != nil {
			writeJSON(w, 500, map[string]string{"error": fmt.Sprintf("Gagal menyimpan baris %d-%d: %v", start+1, end, err)})
			return
		}
	}

	info := invSyncInfo{At: now, Rows: len(values), Source: strings.TrimSpace(body.Source)}
	if claims, ok := middleware.GetUserClaims(r); ok {
		info.By = claims.Name
		if info.By == "" {
			info.By = claims.Email
		}
	}
	meta, _ := json.Marshal(info)
	if _, err := tx.Exec(db.FormatQuery("DELETE FROM app_meta WHERE key = ?"), invMetaKey(ds)); err == nil {
		_, err = tx.Exec(db.FormatQuery("INSERT INTO app_meta (key, value) VALUES (?, ?)"), invMetaKey(ds), string(meta))
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": err.Error()})
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeJSON(w, 500, map[string]string{"error": "Gagal menyimpan: " + err.Error()})
		return
	}
	writeJSON(w, 200, map[string]any{
		"dataset": ds.Key, "rows": len(values), "synced_at": now,
		"warnings": warnings, "warning_count": warningCount,
	})
}

// invFilter builds the WHERE of a list: search words (each must match one
// search column), exact filters (?status=A&status=B means A or B) and dates.
func invFilter(ds invDataset, q url.Values) (string, []any) {
	where := []string{"1=1"}
	args := []any{}
	for _, word := range strings.Fields(strings.ToLower(q.Get("search"))) {
		ors := make([]string, len(ds.Search))
		for i, c := range ds.Search {
			ors[i] = "LOWER(COALESCE(" + c + ", '')) LIKE ?"
			args = append(args, "%"+word+"%")
		}
		where = append(where, "("+strings.Join(ors, " OR ")+")")
	}
	for _, col := range ds.Filters {
		vals := []string{}
		for _, v := range q[col] {
			if v = strings.TrimSpace(v); v != "" && v != "all" {
				vals = append(vals, v)
			}
		}
		if len(vals) == 0 {
			continue
		}
		where = append(where, col+" IN ("+strings.TrimSuffix(strings.Repeat("?, ", len(vals)), ", ")+")")
		for _, v := range vals {
			args = append(args, v)
		}
	}
	if ds.DateCol != "" {
		if from := invDatePrefix.FindString(q.Get("date_from")); from != "" {
			where = append(where, ds.DateCol+" >= ?")
			args = append(args, from)
		}
		if to := invDatePrefix.FindString(q.Get("date_to")); to != "" {
			where = append(where, ds.DateCol+" <= ?")
			args = append(args, to)
		}
	}
	return strings.Join(where, " AND "), args
}

// invOrder sorts by any column of the table (?sort=nilai_stok&dir=asc), else
// the dataset's default; row_no keeps equal rows in workbook order.
func invOrder(ds invDataset, q url.Values) string {
	if s := q.Get("sort"); s != "" {
		for _, c := range db.InventoryTables[ds.Table] {
			if c.Name == s {
				return s + " " + sortDir(q) + ", row_no"
			}
		}
	}
	return ds.Order + ", row_no"
}

type invFacet struct {
	Value string `json:"value"`
	Count int    `json:"count"`
}

// GetInventory handles GET /api/inventory/data/{dataset}: one page of rows,
// the totals of all filtered rows, the filter choices and the last sync.
func GetInventory(w http.ResponseWriter, r *http.Request) {
	ds, ok := invDatasetOf(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	page, limit := pageParams(q, 50, 500)
	where, args := invFilter(ds, q)

	sumSQL := "COUNT(*)"
	for _, c := range ds.Sums {
		sumSQL += ", COALESCE(SUM(" + c + "), 0)"
	}
	var total int
	sums := make([]float64, len(ds.Sums))
	dest := []any{&total}
	for i := range sums {
		dest = append(dest, &sums[i])
	}
	if err := db.QueryRow("SELECT "+sumSQL+" FROM "+ds.Table+" WHERE "+where, args...).Scan(dest...); err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	totals := map[string]float64{}
	for i, c := range ds.Sums {
		totals[c] = sums[i]
	}

	rows, err := db.Query("SELECT row_no, "+strings.Join(invColumnNames(ds.Table), ", ")+" FROM "+ds.Table+
		" WHERE "+where+" ORDER BY "+invOrder(ds, q)+" LIMIT ? OFFSET ?",
		append(append([]any{}, args...), limit, (page-1)*limit)...)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	list, err := scanRowsToMaps(rows)
	rows.Close()
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": err.Error()})
		return
	}
	if list == nil {
		list = []map[string]any{}
	}

	facets := map[string][]invFacet{}
	for _, col := range ds.Filters {
		facets[col] = []invFacet{}
		frows, err := db.Query("SELECT " + col + ", COUNT(*) FROM " + ds.Table + " WHERE " + col + " IS NOT NULL AND " + col + " <> '' GROUP BY " + col + " ORDER BY COUNT(*) DESC, " + col + " LIMIT 300")
		if err != nil {
			continue
		}
		for frows.Next() {
			var f invFacet
			if frows.Scan(&f.Value, &f.Count) == nil {
				facets[col] = append(facets[col], f)
			}
		}
		frows.Close()
	}

	writeJSON(w, 200, map[string]any{
		"data": list, "total": total, "page": page, "limit": limit,
		"totals": totals, "facets": facets, "synced": invLastSync(ds),
	})
}

// GetInventorySummary handles GET /api/inventory/summary: the workbook
// dashboard's headline figures and when each table was last synced.
func GetInventorySummary(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{}
	var items, needOrder, negative int
	var stockValue float64
	needMarks := strings.TrimSuffix(strings.Repeat("?, ", len(stockNeedsOrder)), ", ")
	needArgs := make([]any, len(stockNeedsOrder))
	for i, s := range stockNeedsOrder {
		needArgs[i] = s
	}
	db.QueryRow("SELECT COUNT(*), COALESCE(SUM(nilai_stok), 0) FROM inv_stock").Scan(&items, &stockValue)
	db.QueryRow("SELECT COUNT(*) FROM inv_stock WHERE status IN ("+needMarks+")", needArgs...).Scan(&needOrder)
	db.QueryRow("SELECT COUNT(*) FROM inv_stock WHERE status = 'STOK NEGATIF'").Scan(&negative)

	var purchases, usage float64
	var purchaseRows, usageRows int
	db.QueryRow("SELECT COUNT(*), COALESCE(SUM(nilai), 0) FROM inv_purchases").Scan(&purchaseRows, &purchases)
	db.QueryRow("SELECT COUNT(*), COALESCE(SUM(biaya_fifo), 0) FROM inv_usages").Scan(&usageRows, &usage)

	synced := map[string]*invSyncInfo{}
	for key, ds := range invDatasets {
		synced[key] = invLastSync(ds)
	}
	out["stock_items"] = items
	out["stock_value"] = stockValue
	out["need_order"] = needOrder
	out["negative_stock"] = negative
	out["need_order_statuses"] = stockNeedsOrder
	out["purchase_rows"] = purchaseRows
	out["purchase_value"] = purchases
	out["usage_rows"] = usageRows
	out["usage_cost"] = usage
	out["synced"] = synced
	writeJSON(w, 200, out)
}
