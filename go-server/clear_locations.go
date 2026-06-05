//go:build ignore
// +build ignore

package main

import (
	"database/sql"
	"log"
	"os"

	_ "modernc.org/sqlite"
)

func main() {
	dbPath := "./shipyard.sqlite"
	
	if _, err := os.Stat(dbPath); os.IsNotExist(err) {
		log.Fatalf("Database not found at %s", dbPath)
	}

	DB, err := sql.Open("sqlite", dbPath)
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer DB.Close()

	if err = DB.Ping(); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	log.Println("Menghapus semua data dari tabel master_locations...")
	
	result, err := DB.Exec("DELETE FROM master_locations")
	if err != nil {
		log.Fatalf("Gagal menghapus data: %v", err)
	}

	rowsAffected, _ := result.RowsAffected()
	log.Printf("Berhasil! %d baris data telah dihapus dari master_locations.", rowsAffected)
}
