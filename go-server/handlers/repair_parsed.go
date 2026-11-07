package handlers

import (
	"strings"
	"time"

	"shipyard/db"
	"shipyard/itemparse"
)

// repairGroups are the group names above a repair list activity, outermost
// first, from its stored full name ("A > B > activity"), without the version
// headings fetchRepairList adds.
func repairGroups(fullName string) []string {
	parts := strings.Split(fullName, " > ")
	if len(parts) <= 1 {
		return nil
	}
	var groups []string
	for _, g := range parts[:len(parts)-1] {
		if g == "" || strings.HasPrefix(g, "Repair list versi ") || strings.HasPrefix(g, "Repair list tambahan versi ") {
			continue
		}
		groups = append(groups, g)
	}
	return groups
}

func parseRepairItem(desc, fullName, unit string, qty float64) itemparse.RepairResult {
	return itemparse.ParseRepair(desc, unit, qty, repairGroups(fullName))
}

// backfillRepairParsed parses stored repair list activities that have no
// parsed fields or ones from older rules (after this was introduced, or after
// new rules), one Job Order at a time with a pause in between. Lists fetched
// meanwhile are parsed as they are stored. Returns the activities written.
func backfillRepairParsed() (int, error) {
	pause := time.Duration(envInt("REPAIR_PARSE_PAUSE_MS", 300)) * time.Millisecond
	written := 0
	done := map[string]bool{} // a Job Order rewritten meanwhile isn't read twice
	for {
		rows, err := db.Query(`SELECT DISTINCT jo_id FROM jo_repair_items WHERE is_leaf AND COALESCE(parser_version, '') <> ? LIMIT 50`, itemparse.RepairVersion)
		if err != nil {
			return written, err
		}
		var jos []string
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil && !done[id] {
				jos = append(jos, id)
			}
		}
		rows.Close()
		if len(jos) == 0 {
			return written, nil
		}
		for _, jo := range jos {
			done[jo] = true
			n, err := parseRepairJobOrder(jo)
			written += n
			if err != nil {
				return written, err
			}
			time.Sleep(pause)
		}
	}
}

// parseRepairJobOrder parses one Job Order's outdated activities in one transaction.
func parseRepairJobOrder(joID string) (int, error) {
	type todo struct {
		uniq, desc, full, unit string
		qty                    float64
	}
	rows, err := db.Query(`SELECT uniqcode, COALESCE(description, ''), COALESCE(full_name, ''), COALESCE(unit, ''), COALESCE(quantity, 0)
		FROM jo_repair_items WHERE jo_id = ? AND is_leaf AND COALESCE(parser_version, '') <> ?`, joID, itemparse.RepairVersion)
	if err != nil {
		return 0, err
	}
	var list []todo
	for rows.Next() {
		var t todo
		if err := rows.Scan(&t.uniq, &t.desc, &t.full, &t.unit, &t.qty); err != nil {
			rows.Close()
			return 0, err
		}
		list = append(list, t)
	}
	rows.Close()
	if len(list) == 0 {
		return 0, nil
	}
	tx, err := db.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(db.FormatQuery(`UPDATE jo_repair_items SET rules = ?, action = ?, object = ?, material = ?, size = ?, source = ?,
		work_type = ?, component = ?, recognized = ?, from_group = ?, parser_version = ? WHERE jo_id = ? AND uniqcode = ?`))
	if err != nil {
		return 0, err
	}
	defer stmt.Close()
	for _, t := range list {
		p := parseRepairItem(t.desc, t.full, t.unit, t.qty)
		if _, err := stmt.Exec(p.Rules, p.Action, p.Object, p.Material, p.Size, p.Source, p.WorkType, p.Component,
			p.Recognized, p.FromActivity, itemparse.RepairVersion, joID, t.uniq); err != nil {
			return 0, err
		}
	}
	return len(list), tx.Commit()
}
