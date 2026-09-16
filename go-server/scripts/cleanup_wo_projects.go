package main

import (
	"database/sql"
	"fmt"
	"os"

	_ "github.com/lib/pq"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	dsn := os.Getenv("POSTGRES_URL")
	if dsn == "" {
		fmt.Println("POSTGRES_URL kosong")
		return
	}

	conn, err := sql.Open("postgres", dsn)
	if err != nil {
		fmt.Println("DB open error:", err)
		return
	}
	defer conn.Close()

	result, err := conn.Exec(`DELETE FROM projects WHERE UPPER(COALESCE(idproject, '')) LIKE 'WO%'`)
	if err != nil {
		fmt.Println("Delete error:", err)
		return
	}

	affected, _ := result.RowsAffected()
	fmt.Println("Deleted WO rows from projects:", affected)
}
