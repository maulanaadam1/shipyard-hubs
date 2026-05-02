package main

import (
	"database/sql"
	"fmt"
	"log"

	_ "modernc.org/sqlite"
)

func main() {
	db, err := sql.Open("sqlite", "./shipyard.sqlite")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	fmt.Println("Columns in equipment_release:")
	rows, err := db.Query("PRAGMA table_info(equipment_release)")
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	for rows.Next() {
		var cid int
		var name, dtype string
		var notnull, pk int
		var dflt_value sql.NullString
		rows.Scan(&cid, &name, &dtype, &notnull, &dflt_value, &pk)
		fmt.Printf("- %s (%s)\n", name, dtype)
	}

	fmt.Println("\nColumns in deployment_records:")
	rows2, err := db.Query("PRAGMA table_info(deployment_records)")
	if err != nil {
		log.Fatal(err)
	}
	defer rows2.Close()
	for rows2.Next() {
		var cid int
		var name, dtype string
		var notnull, pk int
		var dflt_value sql.NullString
		rows2.Scan(&cid, &name, &dtype, &notnull, &dflt_value, &pk)
		fmt.Printf("- %s (%s)\n", name, dtype)
	}
}
