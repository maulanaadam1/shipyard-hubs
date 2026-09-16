package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	_ "github.com/lib/pq"
	"github.com/joho/godotenv"
)

func normalizeSyncURL(value string) string {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "[http") {
		if open := strings.Index(value, "]("); open > 0 && strings.HasSuffix(value, ")") {
			return strings.TrimSpace(value[open+2 : len(value)-1])
		}
	}
	return value
}

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

	if err := conn.Ping(); err != nil {
		fmt.Println("DB ping error:", err)
		return
	}

	var urlStr, headersStr, lastSync string
	var active bool
	err = conn.QueryRow(`SELECT COALESCE(url, ''), COALESCE(headers, ''), COALESCE(last_sync, ''), COALESCE(is_active, false) FROM sync_configs WHERE id = 'JobOrders'`).Scan(&urlStr, &headersStr, &lastSync, &active)
	if err != nil {
		fmt.Println("Config JobOrders tidak ditemukan:", err)
		return
	}

	fmt.Println("Config JobOrders:")
	fmt.Println("- active:", active)
	fmt.Println("- last_sync:", lastSync)
	fmt.Println("- url:", normalizeSyncURL(urlStr))

	var projectCount int
	_ = conn.QueryRow(`SELECT COUNT(*) FROM projects WHERE UPPER(COALESCE(idproject, '')) NOT LIKE 'WO%'`).Scan(&projectCount)
	fmt.Println("- projects non-WO:", projectCount)
	var woProjectCount int
	_ = conn.QueryRow(`SELECT COUNT(*) FROM projects WHERE UPPER(COALESCE(idproject, '')) LIKE 'WO%'`).Scan(&woProjectCount)
	fmt.Println("- projects WO mixed in:", woProjectCount)

	rows, err := conn.Query(`SELECT id, idproject, shipname, updated_at FROM projects WHERE UPPER(COALESCE(idproject, '')) NOT LIKE 'WO%' ORDER BY updated_at DESC NULLS LAST LIMIT 5`)
	if err == nil {
		defer rows.Close()
		fmt.Println("Sample projects:")
		for rows.Next() {
			var id, code, ship string
			var updated sql.NullString
			_ = rows.Scan(&id, &code, &ship, &updated)
			fmt.Printf("- %s | %s | %s | %s\n", id, code, ship, updated.String)
		}
	}

	woRows, err := conn.Query(`SELECT id, idproject, shipname, updated_at FROM projects WHERE UPPER(COALESCE(idproject, '')) LIKE 'WO%' ORDER BY updated_at DESC NULLS LAST LIMIT 10`)
	if err == nil {
		defer woRows.Close()
		fmt.Println("Sample WO rows incorrectly in projects:")
		for woRows.Next() {
			var id, code, ship string
			var updated sql.NullString
			_ = woRows.Scan(&id, &code, &ship, &updated)
			fmt.Printf("- %s | %s | %s | %s\n", id, code, ship, updated.String)
		}
	}

	headers := map[string]string{}
	if headersStr != "" {
		_ = json.Unmarshal([]byte(headersStr), &headers)
	}

	pageURL := normalizeSyncURL(urlStr)
	if strings.Contains(pageURL, "?") {
		pageURL += "&page=1"
	} else {
		pageURL += "?page=1"
	}

	req, err := http.NewRequest("GET", pageURL, nil)
	if err != nil {
		fmt.Println("HTTP request create error:", err)
		return
	}
	for key, value := range headers {
		req.Header.Set(key, value)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Println("Remote fetch error:", err)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	fmt.Println("Remote status:", resp.Status)
	fmt.Println("Remote first bytes:", string(body))
}
