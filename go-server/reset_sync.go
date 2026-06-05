//go:build ignore
// +build ignore

package scripts

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

	_, err = db.Exec("UPDATE sync_configs SET last_sync = '' WHERE id = 'JobOrders'")
	if err != nil {
		log.Fatal("Gagal mereset last_sync:", err)
	}

	fmt.Println("✅ Memori waktu sinkronisasi berhasil di-reset!")
	fmt.Println("Silakan kembali ke aplikasi dan klik tombol Manual Sync (petir) lagi. Sistem akan melakukan FULL SYNC dan memproses semua data historis Anda.")
}
