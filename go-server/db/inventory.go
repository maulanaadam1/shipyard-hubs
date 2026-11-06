package db

import (
	"log"
	"strings"
)

// Persediaan Material: the Master Inventory workbook keeps and calculates the
// FIFO stock; its macro sends each workbook table here as a whole snapshot
// (every sync replaces the table), so rows have no key of their own: the
// workbook's IDs repeat (one usage ID appears six times) and Master Material has none.

type InventoryKind int

const (
	InvText InventoryKind = iota
	InvNum
	InvDate // stored as TEXT, YYYY-MM-DD
)

type InventoryColumn struct {
	Name string
	Kind InventoryKind
}

func invCols(spec string) []InventoryColumn {
	var cols []InventoryColumn
	for _, f := range strings.Fields(spec) {
		name, kind, _ := strings.Cut(f, ":")
		c := InventoryColumn{Name: name}
		switch kind {
		case "num":
			c.Kind = InvNum
		case "date":
			c.Kind = InvDate
		}
		cols = append(cols, c)
	}
	return cols
}

// InventoryTables lists each table's columns in workbook order. "kategori" is
// the workbook's "Kode Material" column, which holds the material category.
var InventoryTables = map[string][]InventoryColumn{
	"inv_stock": invCols(`kategori nama ukuran gudang satuan id_saldo_awal tanggal_cutoff
		qty_saldo_awal:num nilai_saldo_awal:num harga_unit_saldo_awal:num qty_terpakai:num sisa_saldo:num nilai_sisa:num
		total_pembelian:num total_pemakaian:num stok_akhir:num stok_minimum:num nilai_stok:num harga_rata:num status`),
	"inv_purchases": invCols(`id_pembelian tanggal:date no_po kategori nama ukuran pemasok proyek gudang
		qty:num satuan harga_unit:num nilai:num qty_terpakai:num sisa_qty:num nilai_sisa:num catatan`),
	"inv_usages": invCols(`id_pemakaian tanggal:date no_dokumen kategori nama ukuran proyek gudang
		qty:num satuan pemakai biaya_fifo:num harga_rata:num catatan`),
	"inv_opening_balances": invCols(`id_saldo_awal tanggal:date kategori nama ukuran proyek gudang
		qty:num satuan nilai:num harga_unit:num qty_terpakai:num sisa_qty:num nilai_sisa:num catatan`),
	"inv_materials": invCols(`kategori nama coda ukuran satuan stok_minimum:num aktif catatan status_data`),
}

func createInventoryTables() {
	for table, cols := range InventoryTables {
		defs := []string{"row_no INTEGER PRIMARY KEY"}
		for _, c := range cols {
			typ := "TEXT"
			if c.Kind == InvNum {
				typ = "DOUBLE PRECISION"
			}
			defs = append(defs, c.Name+" "+typ)
		}
		defs = append(defs, "synced_at TEXT")
		if _, err := DB.Exec("CREATE TABLE IF NOT EXISTS " + table + " (" + strings.Join(defs, ", ") + ")"); err != nil {
			log.Fatalf("Failed to create %s: %v", table, err)
		}
	}
}

// MigrateInventoryPermission runs once: the Persediaan Material menu starts
// with the rights each role has on the Inventory menu.
func MigrateInventoryPermission() {
	copyResourcePermissions("rbac_persediaan_material", "Inventory", "Persediaan Material")
}
