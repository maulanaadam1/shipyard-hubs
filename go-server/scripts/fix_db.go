package main

import (
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	err := filepath.WalkDir(".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if d.Name() == "db" {
				return filepath.SkipDir // Do not touch db/db.go
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.Contains(path, "fix_db.go") {
			return nil
		}

		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}

		text := string(content)
		modified := false

		if strings.Contains(text, "db.DB.") {
			text = strings.ReplaceAll(text, "db.DB.QueryRow", "db.QueryRow")
			text = strings.ReplaceAll(text, "db.DB.Query", "db.Query")
			text = strings.ReplaceAll(text, "db.DB.Exec", "db.Exec")
			modified = true
		}

		if strings.Contains(text, "IFNULL") {
			text = strings.ReplaceAll(text, "IFNULL", "COALESCE")
			modified = true
		}

		if modified {
			err = os.WriteFile(path, []byte(text), 0644)
			if err != nil {
				return err
			}
			log.Printf("✅ Fixed file: %s", path)
		}
		return nil
	})
	if err != nil {
		log.Fatal(err)
	}
	log.Println("🎉 All files have been converted to support Postgres Syntax!")
}
