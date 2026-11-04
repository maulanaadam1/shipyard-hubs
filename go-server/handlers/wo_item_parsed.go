package handlers

import (
	"log"
	"strings"
	"time"

	"shipyard/db"
	"shipyard/itemparse"
)

// backfillParsedItems fills wo_item_parsed for items that have no parsed row
// or one from an older parser version: after the table is introduced, after
// new parsing rules, or after an interrupted rebuild. It walks wo_items in key
// order, a small batch at a time with a pause in between, and only writes
// wo_item_parsed, so it stays light on the database (a full rebuild rewrites
// four tables). Rows already parsed with the current version are skipped, so
// it resumes where it stopped. Returns the number of rows written.
func backfillParsedItems() (int, error) {
	batchSize := envInt("WO_PARSE_BATCH", 500)
	pause := time.Duration(envInt("WO_PARSE_PAUSE_MS", 1000)) * time.Millisecond

	type todo struct{ wo, item, label, activity string }
	written := 0
	lastWO, lastItem := "", ""
	for {
		// Two key-range reads rather than a join: a LEFT JOIN made PostgreSQL
		// walk wo_item_parsed's index from the start on every batch (123 ms
		// mid-table on production, growing as the table fills).
		fromWO, fromItem := lastWO, lastItem
		rows, err := db.Query(`SELECT wo_id, item_id, COALESCE(label, ''), COALESCE(activity_name, '') FROM wo_items
			WHERE (wo_id, item_id) > (?, ?) ORDER BY wo_id, item_id LIMIT ?`, fromWO, fromItem, batchSize)
		if err != nil {
			return written, err
		}
		var batch []todo
		for rows.Next() {
			var t todo
			if err := rows.Scan(&t.wo, &t.item, &t.label, &t.activity); err != nil {
				rows.Close()
				return written, err
			}
			batch = append(batch, t)
		}
		rows.Close()
		read := len(batch)
		if read == 0 {
			return written, nil
		}
		lastWO, lastItem = batch[read-1].wo, batch[read-1].item

		current := map[string]bool{}
		rows, err = db.Query(`SELECT wo_id, item_id FROM wo_item_parsed
			WHERE (wo_id, item_id) > (?, ?) AND (wo_id, item_id) <= (?, ?) AND parser_version = ?`,
			fromWO, fromItem, lastWO, lastItem, itemparse.Version)
		if err != nil {
			return written, err
		}
		for rows.Next() {
			var wo, item string
			if rows.Scan(&wo, &item) == nil {
				current[wo+"\x00"+item] = true
			}
		}
		rows.Close()
		var pending []todo
		for _, t := range batch {
			if !current[t.wo+"\x00"+t.item] {
				pending = append(pending, t)
			}
		}

		if len(pending) > 0 {
			marks := make([]string, 0, len(pending))
			args := make([]interface{}, 0, len(pending)*19)
			for _, t := range pending {
				p := itemparse.ParseItem(t.label, t.activity)
				marks = append(marks, "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
				args = append(args, t.wo, t.item, p.Rules, p.Action, p.Object, p.Material, p.Size, p.Qty, p.Source,
					p.WorkType, p.Recognized, p.PipeMM, p.Elbows, p.Flanges, p.Frame, p.Side, p.WeightKg, p.FromActivity, itemparse.Version)
			}
			// A WO rewritten meanwhile by the detail worker already has current
			// rows; the WHERE leaves those alone.
			if _, err := db.Exec(`INSERT INTO wo_item_parsed (wo_id, item_id, rules, action, object, material, size, qty,
				source, work_type, recognized, pipe_mm, elbows, flanges, frame, side, weight_kg, from_activity, parser_version) VALUES `+strings.Join(marks, ", ")+`
				ON CONFLICT(wo_id, item_id) DO UPDATE SET rules = excluded.rules, action = excluded.action, object = excluded.object,
					material = excluded.material, size = excluded.size, qty = excluded.qty, source = excluded.source,
					work_type = excluded.work_type, recognized = excluded.recognized, pipe_mm = excluded.pipe_mm,
					elbows = excluded.elbows, flanges = excluded.flanges, frame = excluded.frame, side = excluded.side,
					weight_kg = excluded.weight_kg, from_activity = excluded.from_activity, parser_version = excluded.parser_version
				WHERE COALESCE(wo_item_parsed.parser_version, '') <> excluded.parser_version`, args...); err != nil {
				return written, err
			}
			written += len(pending)
		}
		if read < batchSize {
			return written, nil
		}
		if len(pending) > 0 {
			time.Sleep(pause)
		}
	}
}

// startParsedItemsBackfill runs the backfill in the background and logs the
// outcome; rows it skips cost one indexed read per batch.
func startParsedItemsBackfill() {
	go func() {
		start := time.Now()
		n, err := backfillParsedItems()
		if err != nil {
			log.Printf("[WO PARSE] backfill stopped after %d rows: %v (resumes on next start)", n, err)
			return
		}
		if n > 0 {
			log.Printf("[WO PARSE] parsed %d work items (parser %s) in %s", n, itemparse.Version, time.Since(start).Round(time.Second))
		}
	}()
}
