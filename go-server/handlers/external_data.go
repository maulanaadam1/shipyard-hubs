package handlers

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"

	"shipyard/db"
)

// Rows pushed by spreadsheet sources ("records" kind) carry the tab they came
// from in _sheet and their key in _key (see apps-script/attendance-sync,
// syncMasterOperation). These helpers read one tab back, whichever source
// sent it, and match vendor names across ShipHub's data.

const (
	externalSheetField = "_sheet"
	externalKeyField   = "_key"
)

// externalPersonalColumn: personal identifiers never shown from external
// rows, even if a sender includes them (the Apps Script already drops them).
var externalPersonalColumn = regexp.MustCompile(`(?i)identitas|^nik$|alamat|address|nomor_bpjs|bpjs_(no|number)|no_hp|phone|whats|whatapp|wa_number|email|photo|foto|card_no`)

// loadExternalSheet returns the rows of one spreadsheet tab, without the
// _sheet/_key bookkeeping fields.
func loadExternalSheet(sheet string) ([]map[string]interface{}, error) {
	// data is stored by json.Marshal (sorted keys, no spaces), so the tab
	// name appears exactly like this; it is checked again after decoding.
	rows, err := db.Query(`SELECT data FROM external_records WHERE data LIKE ? ORDER BY record_key`,
		`%"`+externalSheetField+`":"`+sheet+`"%`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []map[string]interface{}
	for rows.Next() {
		var raw string
		if rows.Scan(&raw) != nil {
			continue
		}
		var row map[string]interface{}
		if json.Unmarshal([]byte(raw), &row) != nil || row[externalSheetField] != sheet {
			continue
		}
		delete(row, externalSheetField)
		delete(row, externalKeyField)
		out = append(out, row)
	}
	return out, rows.Err()
}

var legalFormWord = regexp.MustCompile(`\b(PT|CV|PD|UD|TBK|PERSERO)\b`)

// normalizeVendorName makes vendor names from different systems comparable:
// "PT. Maskuri Karya Sejahtera", "MASKURI KARYA SEJAHTERA, PT" and
// "PT MASKURI KARYA SEJAHTERA" all become "MASKURI KARYA SEJAHTERA".
// Only this exact form is matched; similar-looking names are often different
// companies (ANUGERAH LAUTAN MANDIRI vs ANUGERAH DUTA NIAGA).
func normalizeVendorName(name string) string {
	s := strings.ToUpper(name)
	s = strings.NewReplacer(".", " ", ",", " ", "(", " ", ")", " ", "-", " ").Replace(s)
	s = legalFormWord.ReplaceAllString(s, " ")
	return strings.Join(strings.Fields(s), " ")
}

// orNeighbour: the PT name, or when it is empty or "-", the vendor name
// from the column before nama_pt (vendor in the vendor tab, kepala_subkon in
// vendor_detail and on punches).
func orNeighbour(pt, neighbour string) string {
	if p := strings.TrimSpace(pt); p != "" && p != "-" {
		return p
	}
	if n := strings.TrimSpace(neighbour); n != "-" {
		return n
	}
	return ""
}

// vendorMember is a subcontractor worker from the vendor_detail tab.
type vendorMember struct {
	EmpCode, Name, KepalaSubkon, NamaPT, Keahlian, Status string
}

// loadVendorMembers indexes vendor_detail by emp_code (the fingerprint id).
func loadVendorMembers() map[string]vendorMember {
	rows, err := loadExternalSheet("vendor_detail")
	if err != nil {
		return nil
	}
	out := map[string]vendorMember{}
	for _, raw := range rows {
		row := normalizeRow(raw)
		m := vendorMember{
			EmpCode:      cellString(row["emp_code"]),
			Name:         cellString(row["name"]),
			KepalaSubkon: cellString(row["kepala_subkon"]),
			NamaPT:       cellString(row["nama_pt"]),
			Keahlian:     cellString(row["keahlian"]),
			Status:       cellString(row["status"]),
		}
		// No PT: the vendor is the kepala subkon in the column before it.
		m.NamaPT = orNeighbour(m.NamaPT, m.KepalaSubkon)
		if m.EmpCode != "" {
			out[m.EmpCode] = m
		}
	}
	return out
}

// vendorAliases maps a normalized PT name to the normalized names its work
// may be billed under: the PT itself and its kepala vendor / kepala subkon
// from MasterOperation (SIAGA often has the WO under the head's name, e.g.
// "MASKURI" for PT MASKURI KARYA SEJAHTERA).
func vendorAliases() map[string][]string {
	sets := map[string]map[string]bool{}
	add := func(pt, name string) {
		ptKey, nameKey := normalizeVendorName(pt), normalizeVendorName(name)
		if ptKey == "" || len(nameKey) < 3 {
			return
		}
		if sets[ptKey] == nil {
			sets[ptKey] = map[string]bool{ptKey: true}
		}
		sets[ptKey][nameKey] = true
	}
	if heads, err := loadExternalSheet("vendor"); err == nil {
		for _, raw := range heads {
			row := normalizeRow(raw)
			vendor := cellString(row["vendor"])
			// No PT: the vendor name in the column before it stands for it.
			add(orNeighbour(cellString(row["nama_pt"]), vendor), vendor)
		}
	}
	for _, m := range loadVendorMembers() {
		add(m.NamaPT, m.KepalaSubkon)
	}
	out := map[string][]string{}
	for pt, set := range sets {
		names := []string{pt} // the PT's own name first
		for n := range set {
			if n != pt {
				names = append(names, n)
			}
		}
		sort.Strings(names[1:])
		out[pt] = names
	}
	return out
}

// woVendorNames maps normalized vendor names to the WO vendor_name as SIAGA
// spells it, so a name from attendance or a spreadsheet can be passed to the
// Work Order and billing tools.
func woVendorNames() map[string]string {
	out := map[string]string{}
	rows, err := db.Query(`SELECT DISTINCT vendor_name FROM work_order_summary WHERE COALESCE(vendor_name, '') <> ''`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		if rows.Scan(&name) == nil {
			if key := normalizeVendorName(name); key != "" {
				out[key] = name
			}
		}
	}
	return out
}
