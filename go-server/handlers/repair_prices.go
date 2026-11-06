package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	"shipyard/db"
)

// Repair-list prices: the price agreed with the customer for each activity of
// a Job Order's repair list. A WO detail repeats the activities it works on,
// with their price, so one activity done by two vendors appears in two WOs:
// its price is counted once per Job Order (by the activity's uniqcode), while
// each WO adds its own vendor cost. See job_margins.go.

// ResourceRepairPrices is the data permission (Role Management) for customer
// prices and Job Order margins.
const ResourceRepairPrices = "Harga Penawaran"

type repairActivity struct {
	Key, Path, Name, Category, Unit string
	JOID, JOCode                    string
	Quantity, UnitPrice, Price      float64
	Version                         int
	JOVersion                       int // the Job Order's latest repair-list version
}

// repairActivitiesFromDetail reads the top-level repair_list entries of a WO
// detail: the activities with their customer price.
func repairActivitiesFromDetail(raw []byte) []repairActivity {
	data, err := dataObject(raw)
	if err != nil {
		return nil
	}
	joID := firstString(data, "t_job_order_id")
	joCode, joVersion := "", 0
	if jo, ok := data["t_job_order"].(map[string]interface{}); ok {
		joCode = firstString(jo, "code_project", "code")
		joVersion = int(parseFloatAny(jo["latest_version"]))
		if joID == "" {
			joID = firstString(jo, "id")
		}
	}
	list, _ := data["repair_list"].([]interface{})
	var out []repairActivity
	seen := map[string]bool{}
	for i, e := range list {
		it, ok := e.(map[string]interface{})
		if !ok {
			continue
		}
		key := firstString(it, "uniqcode", "id")
		if key == "" {
			key = fmt.Sprintf("path:%s#%d", firstString(it, "path"), i)
		}
		if seen[key] {
			continue
		}
		seen[key] = true
		qty := parseFloatAny(it["quantity"])
		unitPrice := parseFloatAny(it["price"])
		price := 0.0
		if p, ok := it["parameter"].(map[string]interface{}); ok {
			price = parseFloatAny(p["total_price"])
		}
		if price == 0 {
			price = unitPrice * qty
		}
		name, category := activityNames(it)
		out = append(out, repairActivity{
			Key: key, Path: firstString(it, "path"), Name: name, Category: category, Unit: firstString(it, "unit"),
			JOID: firstString(it, "t_job_order_id"), JOCode: joCode,
			Quantity: qty, UnitPrice: unitPrice, Price: price, Version: int(parseFloatAny(it["version"])), JOVersion: joVersion,
		})
		if out[len(out)-1].JOID == "" {
			out[len(out)-1].JOID = joID
		}
	}
	return out
}

// writeRepairActivities replaces the stored activities of the given WOs.
func writeRepairActivities(exec func(string, ...interface{}) (sql.Result, error), byWO map[string][]repairActivity) error {
	if len(byWO) == 0 {
		return nil
	}
	ids := make([]interface{}, 0, len(byWO))
	marks := make([]string, 0, len(byWO))
	for id := range byWO {
		ids = append(ids, id)
		marks = append(marks, "?")
	}
	if _, err := exec(db.FormatQuery("DELETE FROM wo_repair_activities WHERE wo_id IN ("+strings.Join(marks, ", ")+")"), ids...); err != nil {
		return err
	}
	const batch = 200
	var rows []string
	var args []interface{}
	flush := func() error {
		if len(rows) == 0 {
			return nil
		}
		_, err := exec(db.FormatQuery(`INSERT INTO wo_repair_activities (wo_id, activity_key, activity_path, jo_id, jo_code, name, category, unit,
			quantity, unit_price, price, version, jo_version) VALUES `+strings.Join(rows, ", ")+` ON CONFLICT(wo_id, activity_key) DO NOTHING`), args...)
		rows, args = rows[:0], args[:0]
		return err
	}
	for woID, acts := range byWO {
		for _, a := range acts {
			rows = append(rows, "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
			args = append(args, woID, a.Key, a.Path, a.JOID, a.JOCode, a.Name, a.Category, a.Unit, a.Quantity, a.UnitPrice, a.Price, a.Version, a.JOVersion)
			if len(rows) >= batch {
				if err := flush(); err != nil {
					return err
				}
			}
		}
	}
	return flush()
}

// repairPricesVersion: bump to re-read every stored detail.
const repairPricesVersion = "2026-11-06.2" // .2: jo_version

// backfillRepairActivities fills wo_repair_activities from the WO details
// already stored, a batch at a time, resuming after the last WO done.
func backfillRepairActivities() (int, error) {
	if appMeta("repair_prices_version") == repairPricesVersion {
		return 0, nil
	}
	const batchSize = 50
	pause := time.Duration(envInt("WO_REPAIR_PRICES_PAUSE_MS", 200)) * time.Millisecond
	cursor := appMeta("repair_prices_cursor")
	written := 0
	for {
		rows, err := db.Query(`SELECT wo_id, raw_json FROM work_order_details WHERE wo_id > ? ORDER BY wo_id LIMIT ?`, cursor, batchSize)
		if err != nil {
			return written, err
		}
		byWO := map[string][]repairActivity{}
		read := 0
		last := cursor
		for rows.Next() {
			var id string
			var raw sql.NullString
			if err := rows.Scan(&id, &raw); err != nil {
				rows.Close()
				return written, err
			}
			read++
			last = id
			byWO[id] = repairActivitiesFromDetail([]byte(raw.String))
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return written, err
		}
		if read == 0 {
			break
		}
		if err := writeRepairActivities(db.Exec, byWO); err != nil {
			return written, err
		}
		for _, acts := range byWO {
			written += len(acts)
		}
		cursor = last
		setAppMeta("repair_prices_cursor", cursor)
		if read < batchSize {
			break
		}
		time.Sleep(pause)
	}
	setAppMeta("repair_prices_version", repairPricesVersion)
	setAppMeta("repair_prices_cursor", "")
	InvalidateWorkOrderCache()
	return written, nil
}

func appMeta(key string) string {
	var v string
	db.QueryRow("SELECT COALESCE(value, '') FROM app_meta WHERE key = ?", key).Scan(&v)
	return v
}

// startRepairActivitiesBackfill runs the backfill in the background, retrying
// a failed run every WO_PARSE_RETRY_MINUTES (5).
func startRepairActivitiesBackfill() {
	retry := time.Duration(envInt("WO_PARSE_RETRY_MINUTES", 5)) * time.Minute
	go func() {
		start := time.Now()
		total := 0
		retryUntilDone(func() error {
			n, err := backfillRepairActivities()
			total += n
			if err != nil {
				log.Printf("[REPAIR PRICES] backfill paused after %d activities: %v (retrying in %s)", total, err, retry)
			}
			return err
		}, retry, time.Sleep)
		if total > 0 {
			log.Printf("[REPAIR PRICES] stored %d repair-list activities in %s", total, time.Since(start).Round(time.Second))
		}
	}()
}
