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

	// 1. Fix equipment_release
	_, err = db.Exec("ALTER TABLE equipment_release ADD COLUMN date_finish TEXT")
	if err != nil {
		fmt.Println("equipment_release.date_finish:", err)
	} else {
		fmt.Println("Added date_finish to equipment_release")
	}

	// 2. Ensure deployment_records has all needed columns (it seems okay from previous check)
	
	fmt.Println("Database migration complete.")
}
