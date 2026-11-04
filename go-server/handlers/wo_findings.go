package handlers

import (
	"fmt"
	"log"
	"math"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"shipyard/db"
	"shipyard/itemparse"
)

// ResourceItemFindings is the RBAC resource of the Data Perlu Dicek menu.
const ResourceItemFindings = "Data Perlu Dicek"

// Finding rules. ShipHub only points at items to check; fixes happen in SIAGA,
// and a finding closes itself once the item no longer matches.
const (
	RulePriceHigh  = "price_high"  // unit cost far above the reference for its work type
	RulePipeLength = "pipe_length" // pipe length in the description is implausible
)

var findingRuleLabels = map[string]string{
	RulePriceHigh:  "Harga jauh di atas acuan",
	RulePipeLength: "Panjang pipa tidak wajar",
}

const (
	// A reference needs this many approved items with a cost.
	referenceMinItems = 10
	// The reference uses approvals from this many months before the newest
	// one, so older price levels don't drag it down; with too few items in
	// that window it falls back to all years.
	referenceWindowMonths = 24
	// A pipe longer than this in one work item is most likely a typo.
	maxPipeMM = 20000
)

// pricedItem is one parsed work item as the findings job reads it.
type pricedItem struct {
	woID, itemID         string
	workType, size, unit string
	unitCost, volume     float64
	status, approvalDate string
	pipeMM               *float64
	// noUnitPrice: the cost isn't a unit price comparable within its work
	// type (see unitPriceComparable); such items neither build references
	// nor get price or pipe findings.
	noUnitPrice bool
}

// partPayment matches descriptions of a payment instalment for a whole job:
// "Pembayaran Termin X 10%", "(DP 40%)", "TERM II 30%".
var partPayment = regexp.MustCompile(`(?i)pembayaran|\btermin\b|\b(dp|term)\b[^%]{0,20}\d+\s*%`)

// unitPriceComparable reports whether an item's cost can be compared with
// others of its work type. Not so for labour (overtime is paid per hour,
// which the reference doesn't split), for job packages described over several
// lines, with a scope of work or at great length (the parser reads only their
// first action), and for payment instalments, docking bills, freight and fees
// (itemparse.CostWithoutUnitPrice).
func unitPriceComparable(action, object, label string) bool {
	if object == "Tenaga kerja" || itemparse.CostWithoutUnitPrice[action] {
		return false
	}
	low := strings.ToLower(label)
	if strings.Count(low, "<br") >= 2 || strings.Contains(low, "ruang lingkup") || len([]rune(label)) >= 200 {
		return false
	}
	return !partPayment.MatchString(label)
}

type referenceKey struct{ workType, size, unit string }

// itemReference is the reference unit cost of one work type, size and unit.
type itemReference struct {
	N                int
	P25, Median, P75 float64
	Min, Max         float64
	Basis            string // "24 bulan" or "semua"
	DateFrom, DateTo string
}

// unitKey normalises a unit for grouping ("Pcs " and "pcs" are the same).
func unitKey(unit string) string {
	return strings.ToLower(strings.TrimSpace(unit))
}

// quantile is the linear-interpolated quantile p of sorted values.
func quantile(sorted []float64, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	pos := p * float64(len(sorted)-1)
	lo := int(pos)
	if lo+1 >= len(sorted) {
		return sorted[lo]
	}
	return sorted[lo] + (sorted[lo+1]-sorted[lo])*(pos-float64(lo))
}

type datedCost struct {
	cost float64
	date string
}

func referenceFrom(costs []datedCost, basis string) itemReference {
	values := make([]float64, len(costs))
	from, to := "", ""
	for i, c := range costs {
		values[i] = c.cost
		if c.date != "" && (from == "" || c.date < from) {
			from = c.date
		}
		if c.date > to {
			to = c.date
		}
	}
	sort.Float64s(values)
	return itemReference{
		N: len(values), P25: quantile(values, .25), Median: quantile(values, .5), P75: quantile(values, .75),
		Min: values[0], Max: values[len(values)-1], Basis: basis, DateFrom: from, DateTo: to,
	}
}

// buildReferences derives reference unit costs from approved items with a
// cost: the last referenceWindowMonths when that has enough items, else all.
func buildReferences(items []pricedItem) map[referenceKey]itemReference {
	latest := ""
	for _, it := range items {
		if it.status == "approved" && it.approvalDate > latest {
			latest = it.approvalDate
		}
	}
	windowStart := ""
	if t, err := time.Parse("2006-01-02", latest); err == nil {
		windowStart = t.AddDate(0, -referenceWindowMonths, 0).Format("2006-01-02")
	}

	all := map[referenceKey][]datedCost{}
	recent := map[referenceKey][]datedCost{}
	for _, it := range items {
		if it.status != "approved" || it.unitCost <= 0 || it.workType == "" || it.noUnitPrice {
			continue
		}
		k := referenceKey{it.workType, it.size, it.unit}
		c := datedCost{it.unitCost, it.approvalDate}
		all[k] = append(all[k], c)
		if windowStart != "" && it.approvalDate >= windowStart {
			recent[k] = append(recent[k], c)
		}
	}
	refs := map[referenceKey]itemReference{}
	for k, costs := range all {
		switch {
		case len(recent[k]) >= referenceMinItems:
			refs[k] = referenceFrom(recent[k], fmt.Sprintf("%d bulan", referenceWindowMonths))
		case len(costs) >= referenceMinItems:
			refs[k] = referenceFrom(costs, "semua")
		}
	}
	return refs
}

// itemFinding is one flagged item as the job computes it.
type itemFinding struct {
	woID, itemID, rule   string
	detail               string
	workType, size, unit string
	unitCost, reference  float64
	excess               float64
}

// formatThousands writes a rounded number with Indonesian thousand dots.
func formatThousands(v float64) string {
	s := fmt.Sprintf("%.0f", math.Round(v))
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "." + s[i:]
	}
	if neg {
		s = "-" + s
	}
	return s
}

func formatRupiah(v float64) string { return "Rp " + formatThousands(v) }

// evaluateFindings applies the rules to every item. A price is "far above"
// when it is more than twice the median and beyond p75 + 3 x IQR, so a
// naturally wide price range doesn't flag its upper end.
func evaluateFindings(items []pricedItem, refs map[referenceKey]itemReference) []itemFinding {
	var out []itemFinding
	for _, it := range items {
		if it.noUnitPrice {
			continue
		}
		if it.pipeMM != nil && *it.pipeMM > maxPipeMM {
			out = append(out, itemFinding{
				woID: it.woID, itemID: it.itemID, rule: RulePipeLength,
				detail:   fmt.Sprintf("Panjang pipa %s mm (di atas %d m), cek input di SIAGA", formatThousands(*it.pipeMM), maxPipeMM/1000),
				workType: it.workType, size: it.size, unit: it.unit, unitCost: it.unitCost,
			})
		}
		if it.unitCost <= 0 {
			continue
		}
		ref, ok := refs[referenceKey{it.workType, it.size, it.unit}]
		if !ok || ref.Median <= 0 {
			continue
		}
		if it.unitCost > 2*ref.Median && it.unitCost > ref.P75+3*(ref.P75-ref.P25) {
			volume := it.volume
			if volume <= 0 {
				volume = 1
			}
			out = append(out, itemFinding{
				woID: it.woID, itemID: it.itemID, rule: RulePriceHigh,
				detail: fmt.Sprintf("Harga satuan %s, %.1fx median %s (%d item, %s)",
					formatRupiah(it.unitCost), it.unitCost/ref.Median, formatRupiah(ref.Median), ref.N, ref.Basis),
				workType: it.workType, size: it.size, unit: it.unit,
				unitCost: it.unitCost, reference: ref.Median, excess: (it.unitCost - ref.Median) * volume,
			})
		}
	}
	return out
}

func loadPricedItems() ([]pricedItem, error) {
	rows, err := db.Query(`SELECT i.wo_id, i.item_id, COALESCE(p.work_type, ''), COALESCE(p.size, ''), COALESCE(i.unit, ''),
			COALESCE(i.unit_cost, 0), COALESCE(i.volume, 0), COALESCE(i.status, ''), COALESCE(i.approval_date, ''), p.pipe_mm,
			COALESCE(p.action, ''), COALESCE(p.object, ''), COALESCE(i.label, '')
		FROM wo_items i JOIN wo_item_parsed p ON p.wo_id = i.wo_id AND p.item_id = i.item_id
		WHERE p.recognized`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var items []pricedItem
	for rows.Next() {
		var it pricedItem
		var pipe *float64
		var action, object, label string
		if err := rows.Scan(&it.woID, &it.itemID, &it.workType, &it.size, &it.unit, &it.unitCost, &it.volume,
			&it.status, &it.approvalDate, &pipe, &action, &object, &label); err != nil {
			return nil, err
		}
		it.noUnitPrice = !unitPriceComparable(action, object, label)
		it.unit = unitKey(it.unit)
		it.approvalDate = dateOnly(it.approvalDate)
		it.pipeMM = pipe
		items = append(items, it)
	}
	return items, rows.Err()
}

func saveReferences(refs map[referenceKey]itemReference) error {
	tx, err := db.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec("DELETE FROM wo_item_reference"); err != nil {
		return err
	}
	keys := make([]referenceKey, 0, len(refs))
	for k := range refs {
		keys = append(keys, k)
	}
	const batch = 300
	for start := 0; start < len(keys); start += batch {
		end := start + batch
		if end > len(keys) {
			end = len(keys)
		}
		marks := make([]string, 0, end-start)
		args := make([]interface{}, 0, (end-start)*12)
		for _, k := range keys[start:end] {
			r := refs[k]
			marks = append(marks, "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
			args = append(args, k.workType, k.size, k.unit, r.N, r.P25, r.Median, r.P75, r.Min, r.Max, r.Basis, r.DateFrom, r.DateTo)
		}
		if _, err := tx.Exec(db.FormatQuery(`INSERT INTO wo_item_reference (work_type, size, unit, n, p25, median, p75, min_cost, max_cost, basis, date_from, date_to)
			VALUES `+strings.Join(marks, ", ")), args...); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// findingsSync is what syncFindings changed.
type findingsSync struct{ Opened, Updated, Resolved, Removed int }

// syncFindings brings wo_item_findings in line with the computed findings:
// new ones open, resolved ones that match again reopen, open and ignored ones
// get fresh values, and open or ignored ones that no longer match resolve.
// Ignored findings stay ignored. Findings of items the rules no longer cover
// (outOfScope, by wo_id and item_id) are removed rather than shown as solved.
// Writes go in small batches with a pause.
func syncFindings(found []itemFinding, outOfScope map[[2]string]bool, now string) (findingsSync, error) {
	var res findingsSync
	type stored struct {
		status              string
		detail              string
		unitCost, reference float64
	}
	existing := map[[3]string]stored{}
	rows, err := db.Query(`SELECT wo_id, item_id, rule, COALESCE(status, 'open'), COALESCE(detail, ''), COALESCE(unit_cost, 0), COALESCE(reference, 0) FROM wo_item_findings`)
	if err != nil {
		return res, err
	}
	for rows.Next() {
		var k [3]string
		var s stored
		if rows.Scan(&k[0], &k[1], &k[2], &s.status, &s.detail, &s.unitCost, &s.reference) == nil {
			existing[k] = s
		}
	}
	rows.Close()

	pause := time.Duration(envInt("WO_FINDINGS_PAUSE_MS", 200)) * time.Millisecond
	batchSize := envInt("WO_FINDINGS_BATCH", 500)
	type write struct {
		query string
		args  []interface{}
	}
	var writes []write
	seen := map[[3]string]bool{}
	for _, f := range found {
		k := [3]string{f.woID, f.itemID, f.rule}
		if seen[k] {
			continue
		}
		seen[k] = true
		old, ok := existing[k]
		switch {
		case !ok:
			res.Opened++
			writes = append(writes, write{`INSERT INTO wo_item_findings (wo_id, item_id, rule, status, detail, work_type, size, unit, unit_cost, reference, excess, first_seen, last_seen)
				VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[]interface{}{f.woID, f.itemID, f.rule, f.detail, f.workType, f.size, f.unit, f.unitCost, f.reference, f.excess, now, now}})
		case old.status == "resolved":
			res.Opened++
			writes = append(writes, write{`UPDATE wo_item_findings SET status = 'open', resolved_at = NULL, detail = ?, work_type = ?, size = ?, unit = ?,
				unit_cost = ?, reference = ?, excess = ?, last_seen = ? WHERE wo_id = ? AND item_id = ? AND rule = ?`,
				[]interface{}{f.detail, f.workType, f.size, f.unit, f.unitCost, f.reference, f.excess, now, f.woID, f.itemID, f.rule}})
		case old.detail != f.detail || math.Abs(old.unitCost-f.unitCost) > 0.5 || math.Abs(old.reference-f.reference) > 0.5:
			res.Updated++
			writes = append(writes, write{`UPDATE wo_item_findings SET detail = ?, work_type = ?, size = ?, unit = ?, unit_cost = ?, reference = ?, excess = ?, last_seen = ?
				WHERE wo_id = ? AND item_id = ? AND rule = ?`,
				[]interface{}{f.detail, f.workType, f.size, f.unit, f.unitCost, f.reference, f.excess, now, f.woID, f.itemID, f.rule}})
		}
	}
	for k, old := range existing {
		if !seen[k] && outOfScope[[2]string{k[0], k[1]}] {
			res.Removed++
			writes = append(writes, write{`DELETE FROM wo_item_findings WHERE wo_id = ? AND item_id = ? AND rule = ?`, []interface{}{k[0], k[1], k[2]}})
			continue
		}
		if !seen[k] && old.status != "resolved" {
			res.Resolved++
			writes = append(writes, write{`UPDATE wo_item_findings SET status = 'resolved', resolved_at = ? WHERE wo_id = ? AND item_id = ? AND rule = ?`,
				[]interface{}{now, k[0], k[1], k[2]}})
		}
	}

	for start := 0; start < len(writes); start += batchSize {
		end := start + batchSize
		if end > len(writes) {
			end = len(writes)
		}
		tx, err := db.DB.Begin()
		if err != nil {
			return res, err
		}
		for _, wr := range writes[start:end] {
			if _, err := tx.Exec(db.FormatQuery(wr.query), wr.args...); err != nil {
				tx.Rollback()
				return res, err
			}
		}
		if err := tx.Commit(); err != nil {
			return res, err
		}
		if end < len(writes) {
			time.Sleep(pause)
		}
	}
	return res, nil
}

var findingsJob struct {
	sync.Mutex
	running bool
}

// RunItemFindings rebuilds the reference costs and the findings from the
// stored items, and records when it ran. One run at a time.
func RunItemFindings() (findingsSync, error) {
	findingsJob.Lock()
	if findingsJob.running {
		findingsJob.Unlock()
		return findingsSync{}, fmt.Errorf("pemeriksaan data sedang berjalan")
	}
	findingsJob.running = true
	findingsJob.Unlock()
	defer func() {
		findingsJob.Lock()
		findingsJob.running = false
		findingsJob.Unlock()
	}()

	start := time.Now()
	items, err := loadPricedItems()
	if err != nil {
		return findingsSync{}, err
	}
	refs := buildReferences(items)
	if err := saveReferences(refs); err != nil {
		return findingsSync{}, err
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	outOfScope := map[[2]string]bool{}
	for _, it := range items {
		if it.noUnitPrice {
			outOfScope[[2]string{it.woID, it.itemID}] = true
		}
	}
	res, err := syncFindings(evaluateFindings(items, refs), outOfScope, now)
	if err != nil {
		return res, err
	}
	setAppMeta("wo_findings_last_run", now)
	log.Printf("[WO FINDINGS] %d items, %d references; findings opened %d, updated %d, resolved %d, removed %d in %s",
		len(items), len(refs), res.Opened, res.Updated, res.Resolved, res.Removed, time.Since(start).Round(time.Second))
	InvalidateWorkOrderCache()
	return res, nil
}

func setAppMeta(key, value string) {
	if _, err := db.Exec("UPDATE app_meta SET value = ? WHERE key = ?", value, key); err == nil {
		var n int
		db.QueryRow("SELECT COUNT(*) FROM app_meta WHERE key = ?", key).Scan(&n)
		if n > 0 {
			return
		}
	}
	db.Exec("INSERT INTO app_meta (key, value) VALUES (?, ?)", key, value)
}

// StartItemFindingsWorker checks the items a few minutes after start (once
// parsed descriptions are in) and then every WO_FINDINGS_HOURS hours (6).
//
// A failed run (database restarting, disk full) is tried again after
// WO_FINDINGS_RETRY_MINUTES (30) instead of waiting for the next 6-hour turn.
func StartItemFindingsWorker() {
	every := time.Duration(envInt("WO_FINDINGS_HOURS", 6)) * time.Hour
	retry := time.Duration(envInt("WO_FINDINGS_RETRY_MINUTES", 30)) * time.Minute
	go func() {
		time.Sleep(time.Duration(envInt("WO_FINDINGS_DELAY_SECONDS", 300)) * time.Second)
		for {
			if _, err := RunItemFindings(); err != nil {
				log.Printf("[WO FINDINGS] %v (retrying in %s)", err, retry)
				time.Sleep(retry)
				continue
			}
			time.Sleep(every)
		}
	}()
}
