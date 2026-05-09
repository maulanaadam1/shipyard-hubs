package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	_ "modernc.org/sqlite"
)

func main() {
	db, err := sql.Open("sqlite", "../go-server/shipyard.sqlite")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	rows, err := db.Query("SELECT * FROM deployment_records WHERE return_status = 'Deployed'")
	if err != nil {
		log.Fatal(err)
	}
	defer rows.Close()

	var deployments []map[string]interface{}
	cols, _ := rows.Columns()
	for rows.Next() {
		columns := make([]interface{}, len(cols))
		columnPointers := make([]interface{}, len(cols))
		for i := range columns {
			columnPointers[i] = &columns[i]
		}
		rows.Scan(columnPointers...)
		m := make(map[string]interface{})
		for i, colName := range cols {
			val := columnPointers[i].(*interface{})
			m[colName] = *val
		}
		deployments = append(deployments, m)
	}
	
	b, _ := json.MarshalIndent(deployments, "", "  ")
	fmt.Println("Deployed Records:")
	fmt.Println(string(b))

	eqRows, err := db.Query("SELECT * FROM equipment WHERE pic IS NOT NULL")
	if err != nil {
		log.Fatal(err)
	}
	defer eqRows.Close()

	var equipment []map[string]interface{}
	cols, _ = eqRows.Columns()
	for eqRows.Next() {
		columns := make([]interface{}, len(cols))
		columnPointers := make([]interface{}, len(cols))
		for i := range columns {
			columnPointers[i] = &columns[i]
		}
		eqRows.Scan(columnPointers...)
		m := make(map[string]interface{})
		for i, colName := range cols {
			val := columnPointers[i].(*interface{})
			m[colName] = *val
		}
		equipment = append(equipment, m)
	}
	
	b, _ = json.MarshalIndent(equipment, "", "  ")
	fmt.Println("\nEquipment with PIC:")
	fmt.Println(string(b))
}
