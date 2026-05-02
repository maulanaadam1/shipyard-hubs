package main

import (
	"database/sql"
	"encoding/csv"
	"fmt"
	"io"
	"log"
	"math/rand"
	"os"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

func generateHexId() string {
	return fmt.Sprintf("%08x", rand.Uint32())
}

func main() {
	rand.Seed(time.Now().UnixNano())

	db, err := sql.Open("sqlite", "./shipyard.sqlite")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Clear existing equipment for clean master data
	db.Exec("DELETE FROM equipment")
	fmt.Println("Cleared existing equipment table.")

	f, err := os.Open("../masterFacility - master_equipment.csv")
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
	for i, name := range header {
		colIdx[strings.ToLower(strings.TrimSpace(name))] = i
	}

	tx, _ := db.Begin()
	count := 0

	for {
		record, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}

		id := generateHexId()
		
		getVal := func(key string) string {
			idx, ok := colIdx[key]
			if !ok || idx >= len(record) {
				return ""
			}
			return strings.TrimSpace(record[idx])
		}

		noAsset := getVal("no_asset")
		name := getVal("name")
		eType := getVal("type")
		brand := getVal("brand")
		capacity := getVal("capacity")
		yearInvest := getVal("year_invest")
		alias := getVal("alias")
		price := getVal("price")
		rawAvail := strings.ToUpper(getVal("available"))
		
		available := "No"
		if rawAvail == "TRUE" || rawAvail == "YES" || rawAvail == "1" {
			available = "Yes"
		}

		_, err = tx.Exec(`INSERT INTO equipment (
			id, no_asset, name, type, brand, capacity, year_invest, available, alias, price
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			id, noAsset, name, eType, brand, capacity, yearInvest, available, alias, price)

		if err != nil {
			fmt.Printf("Error inserting %s: %v\n", noAsset, err)
		} else {
			count++
		}
	}

	tx.Commit()
	fmt.Printf("✅ Successfully imported %d equipment items into master database.\n", count)
}
