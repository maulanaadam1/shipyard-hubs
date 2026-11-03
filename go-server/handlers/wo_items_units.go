package handlers

import (
	"sort"
	"strconv"
	"strings"
	"unicode"

	"shipyard/db"
)

// Volume per unit for summary groups that are not split by unit (activity,
// category, vendor, project...): adding Kg, Unit and Orang into one number
// means nothing, so those groups report one total per unit instead.

type unitVolume struct {
	Unit      string  `json:"unit"`
	Volume    float64 `json:"volume"`
	ItemCount int     `json:"item_count"`
	// UnitKeys are the normalized units (woItemUnitKey) merged into this one,
	// for listing its items with the unit_key filter.
	UnitKeys []string `json:"unit_keys"`
}

// woItemUnitKey normalizes an item's unit the way the breakdown merges them.
const woItemUnitKey = "LOWER(TRIM(COALESCE(i.unit, '')))"

const noUnitLabel = "tanpa satuan"

// hasUnit reports whether the group is already split by unit (Per Item views),
// in which case its total volume is a single, meaningful number.
func (g woItemGroup) hasUnit() bool {
	for _, label := range g.labels {
		if label == "unit" {
			return true
		}
	}
	return false
}

func groupKeyString(keys []string) string {
	return strings.Join(keys, "\x00")
}

// unitLabel cleans a unit as typed in SIAGA: blank or punctuation-only
// entries (", ", "'", ".") become one "tanpa satuan" bucket.
func unitLabel(raw string) string {
	raw = strings.TrimSpace(raw)
	for _, r := range raw {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return raw
		}
	}
	return noUnitLabel
}

// woItemVolumeByUnit sums item volume per unit for each group matching the
// filters, keyed by groupKeyString of the group's values. only limits it to
// the given groups (a page); nil means every group (the export). Units differing
// only in case or surrounding spaces count as one; most items first.
func woItemVolumeByUnit(group woItemGroup, where string, args []interface{}, only [][]string) (map[string][]unitVolume, error) {
	queryArgs := append([]interface{}{}, args...)
	if only != nil {
		if len(only) == 0 {
			return map[string][]unitVolume{}, nil
		}
		ors := make([]string, 0, len(only))
		for _, keys := range only {
			conds := make([]string, len(group.keys))
			for i, expr := range group.keys {
				// Compare the bare column so its index applies (COALESCE(x, '') = ?
				// would scan every item); '' stands for NULL as in the key.
				col := strings.TrimSuffix(strings.TrimPrefix(expr, "COALESCE("), ", '')")
				if keys[i] == "" {
					conds[i] = "(" + col + " IS NULL OR " + col + " = '')"
				} else {
					conds[i] = col + " = ?"
					queryArgs = append(queryArgs, keys[i])
				}
			}
			ors = append(ors, "("+strings.Join(conds, " AND ")+")")
		}
		where += " AND (" + strings.Join(ors, " OR ") + ")"
	}
	unitKey := woItemUnitKey
	keyList := group.keyList()
	rows, err := db.Query(`SELECT `+keyList+`, `+unitKey+`, MIN(TRIM(COALESCE(i.unit, ''))), COUNT(*), COALESCE(SUM(i.volume), 0)`+
		woItemFrom+where+` GROUP BY `+keyList+`, `+unitKey, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string][]unitVolume{}
	for rows.Next() {
		keys := make([]string, len(group.keys))
		var unitKeyValue, display string
		var count int
		var volume float64
		dest := make([]interface{}, 0, len(keys)+4)
		for i := range keys {
			dest = append(dest, &keys[i])
		}
		dest = append(dest, &unitKeyValue, &display, &count, &volume)
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		k := groupKeyString(keys)
		label := unitLabel(display)
		merged := false
		for i := range result[k] {
			if result[k][i].Unit == label { // e.g. several punctuation-only units
				result[k][i].Volume += volume
				result[k][i].ItemCount += count
				result[k][i].UnitKeys = append(result[k][i].UnitKeys, unitKeyValue)
				merged = true
				break
			}
		}
		if !merged {
			result[k] = append(result[k], unitVolume{Unit: label, Volume: volume, ItemCount: count, UnitKeys: []string{unitKeyValue}})
		}
	}
	for _, units := range result {
		sort.Slice(units, func(a, b int) bool {
			if units[a].ItemCount != units[b].ItemCount {
				return units[a].ItemCount > units[b].ItemCount
			}
			return units[a].Unit < units[b].Unit
		})
	}
	return result, rows.Err()
}

// formatVolumeByUnit renders a breakdown for the Excel export, Indonesian
// number style: "116.766,78 Kg; 2.524 Unit; 1.759 Orang".
func formatVolumeByUnit(units []unitVolume) string {
	parts := make([]string, len(units))
	for i, u := range units {
		parts[i] = formatIDNumber(u.Volume) + " " + u.Unit
	}
	return strings.Join(parts, "; ")
}

func formatIDNumber(v float64) string {
	s := strconv.FormatFloat(v, 'f', 2, 64)
	s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	intPart, frac, _ := strings.Cut(s, ".")
	neg := strings.HasPrefix(intPart, "-")
	intPart = strings.TrimPrefix(intPart, "-")
	var b strings.Builder
	for i, r := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(r)
	}
	out := b.String()
	if frac != "" {
		out += "," + frac
	}
	if neg {
		out = "-" + out
	}
	return out
}
