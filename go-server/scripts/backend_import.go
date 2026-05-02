package main

import (
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math/rand"
	"os"
	"strconv"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

type ApprovalStep struct {
	Status      string `json:"status"`
	Label       string `json:"label"`
	Date        string `json:"date"`
	User        string `json:"user"`
	Jabatan     string `json:"jabatan,omitempty"`
	UserID      string `json:"user_id,omitempty"`
	Comment     string `json:"comment,omitempty"`
	IsCompleted bool   `json:"isCompleted"`
	IsCurrent   bool   `json:"isCurrent"`
}

type LoanItem struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Quantity int    `json:"quantity"`
}

type ReleaseItem struct {
	ItemID      string `json:"item_id"`
	EquipmentID string `json:"equipment_id"`
	Alias       string `json:"alias"`
	Condition   string `json:"condition"`
}

func generateHexId() string {
	return fmt.Sprintf("%08x", rand.Uint32())
}

func formatCSVDate(dateStr string) string {
	if dateStr == "" || !strings.Contains(dateStr, "/") {
		return "2024-01-01"
	}
	clean := strings.Split(dateStr, " ")[0]
	clean = strings.Split(clean, "T")[0]
	parts := strings.Split(clean, "/")
	if len(parts) != 3 {
		return "2024-01-01"
	}
	m := parts[0]
	d := parts[1]
	y := parts[2]
	if len(m) == 1 { m = "0" + m }
	if len(d) == 1 { d = "0" + d }
	return fmt.Sprintf("%s-%s-%s", y, m, d)
}

func main() {
	rand.Seed(time.Now().UnixNano())

	db, err := sql.Open("sqlite", "./shipyard.sqlite")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Clear existing
	db.Exec("DELETE FROM loan_requests")
	db.Exec("DELETE FROM equipment_release")
	db.Exec("DELETE FROM deployment_records")
	fmt.Println("Database cleared for fresh import.")

	projectMap := make(map[string]string)
	pRows, _ := db.Query("SELECT id, idproject FROM projects")
	for pRows.Next() {
		var id, idp string
		pRows.Scan(&id, &idp)
		projectMap[strings.ToLower(id)] = idp
		projectMap[strings.ToLower(idp)] = idp
	}
	pRows.Close()

	var workflows []map[string]interface{}
	wRows, _ := db.Query("SELECT label, jabatan, user_id FROM approval_workflow WHERE module = 'Equipment Loan' ORDER BY step_order ASC")
	for wRows.Next() {
		var l, j, u string
		wRows.Scan(&l, &j, &u)
		workflows = append(workflows, map[string]interface{}{"label": l, "jabatan": j, "user_id": u})
	}
	wRows.Close()

	f, err := os.Open("../masterFacility - item_detail.csv")
	if err != nil {
		log.Fatal(err)
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.Comma = ';'
	r.LazyQuotes = true

	header, err := r.Read()
	if err != nil {
		log.Fatal(err)
	}
	colIdx := make(map[string]int)
	for i, name := range header { colIdx[name] = i }

	type GroupKey struct {
		Vendor    string
		StartDate string
		Project   string
	}
	groups := make(map[GroupKey][]map[string]string)

	for {
		record, err := r.Read()
		if err == io.EOF { break }
		if err != nil { continue }
		row := make(map[string]string)
		for name, i := range colIdx {
			if i < len(record) { row[name] = record[i] }
		}
		key := GroupKey{Vendor: row["vendor"], StartDate: row["start_date"], Project: row["code_project"]}
		groups[key] = append(groups[key], row)
	}

	monthCounters := make(map[string]int)
	loanCount := 0
	tx, _ := db.Begin()

	// Pre-load equipment mapping (Normalized Alias -> {ID, OriginalAlias})
	type EqInfo struct { ID, Alias string }
	equipmentMap := make(map[string]EqInfo)
	normalize := func(s string) string {
		s = strings.ToUpper(s)
		s = strings.ReplaceAll(s, "YWTS J", "")
		s = strings.ReplaceAll(s, "YWTS", "")
		return strings.Join(strings.Fields(s), " ") // Remove extra spaces
	}

	rows, _ := db.Query("SELECT id, alias FROM equipment")
	for rows.Next() {
		var id, alias string
		rows.Scan(&id, &alias)
		if alias != "" {
			equipmentMap[normalize(alias)] = EqInfo{id, alias}
		}
	}
	rows.Close()

	for key, records := range groups {
		first := records[0]
		loanID := first["unique_id"]
		if loanID == "" { loanID = generateHexId() }

		projCode := strings.ToLower(key.Project)
		matchedProject := projectMap[projCode]
		if matchedProject == "" { matchedProject = key.Project }

		isoDate := formatCSVDate(key.StartDate)
		finishDate := formatCSVDate(first["finish_date"])
		t, _ := time.Parse("2006-01-02", isoDate)
		
		yearStr := t.Format("2006")
		monthStr := t.Format("01")
		yearMonthKey := yearStr + "-" + monthStr
		
		monthCounters[yearMonthKey]++
		
		// 1. Loan Prefix: ERQ/YYYY/MM/SEQ/YWTS
		reqID := fmt.Sprintf("ERQ/%s/%s/%03d/YWTS", yearStr, monthStr, monthCounters[yearMonthKey])
		// 2. Release Prefix: ERL/YYYY/MM/SEQ/YWTS
		relNo := fmt.Sprintf("ERL/%s/%s/%03d/YWTS", yearStr, monthStr, monthCounters[yearMonthKey])
		// 3. Return Prefix: ERE/YYYY/MM/SEQ/YWTS
		retNo := fmt.Sprintf("ERE/%s/%s/%03d/YWTS", yearStr, monthStr, monthCounters[yearMonthKey])

		itemSummary := make(map[string]int)
		var relItems []ReleaseItem

		for _, rec := range records {
			itemType := rec["item"]
			if itemType == "" { itemType = "Unknown" }
			itemSummary[itemType]++

			depID := rec["unique_id"]
			if depID == "" { depID = generateHexId() }
			
			// Resolve Equipment ID & Alias from Normalized Alias
			legacyPID := rec["product_id"]
			resolvedID := legacyPID
			originalAlias := legacyPID
			if info, ok := equipmentMap[normalize(legacyPID)]; ok {
				resolvedID = info.ID
				originalAlias = info.Alias
			}
			
			duration, _ := strconv.ParseFloat(rec["duration"], 64)
			durHour, _ := strconv.ParseFloat(rec["duration_hour"], 64)

			description := fmt.Sprintf("Return No: %s | %s", retNo, rec["description"])

			_, err = tx.Exec(`INSERT INTO deployment_records (
				unique_id, create_date, create_by, last_updated, request_id, year, month, item, 
				product_id, product_name, code_project, project_name, shipname, vendor_list, 
				vendor, start_date, finish_date, duration, duration_hour, return_date, 
				return_status, description
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				depID, isoDate, "Backend Import", isoDate, reqID, t.Year(), int(t.Month()), itemType,
				resolvedID, originalAlias, matchedProject, matchedProject, rec["project_name"], rec["vendor_list"],
				rec["vendor"], isoDate, finishDate, duration, durHour, finishDate, 
				"Returned", description)
			
			relItems = append(relItems, ReleaseItem{
				ItemID: generateHexId(), 
				EquipmentID: resolvedID, 
				Alias: originalAlias,
				Condition: "Good",
			})
			tx.Exec("UPDATE equipment SET available = 'Yes' WHERE id = ?", resolvedID)
		}

		var loanItems []LoanItem
		for itype, qty := range itemSummary {
			loanItems = append(loanItems, LoanItem{ID: generateHexId(), Type: itype, Quantity: qty})
		}
		itemsJSON, _ := json.Marshal(loanItems)

		steps := []ApprovalStep{
			{Status: "Approved", Label: "Request Created (Legacy)", Date: isoDate, User: "Legacy System", IsCompleted: true, IsCurrent: false},
		}
		for _, w := range workflows {
			steps = append(steps, ApprovalStep{
				Status: "Approved", Label: w["label"].(string), Jabatan: w["jabatan"].(string), UserID: w["user_id"].(string),
				Date: isoDate, User: "Legacy Admin", Comment: "Auto-approved legacy", IsCompleted: true, IsCurrent: false,
			})
		}
		stepsJSON, _ := json.Marshal(steps)

		_, err = tx.Exec(`INSERT INTO loan_requests (
			id, date_created, request_id, project_id, shipname, vendor, work_order,
			date_start, date_finish, duration, status, items, approval_steps
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			loanID, isoDate, reqID, matchedProject, first["project_name"], first["vendor"], first["shipname"],
			isoDate, finishDate, len(records), "Returned", string(itemsJSON), string(stepsJSON))

		relItemsJSON, _ := json.Marshal(relItems)
		_, err = tx.Exec(`INSERT INTO equipment_release (
			id, loan_id, release_no, date_released, date_finish, released_by, received_by, items_released, status, notes
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			generateHexId(), loanID, relNo, isoDate, finishDate,
			"Backend Import", first["vendor"], string(relItemsJSON), "Returned", first["description"])

		loanCount++
	}

	tx.Commit()
	fmt.Printf("✅ Re-imported %d records with new ERL/ERE prefixes.\n", loanCount)
}
