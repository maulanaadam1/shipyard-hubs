package handlers

import (
	"sort"
	"strings"
)

// Crossing attendance with the HSE work permits: the punches say when a
// worker was at the yard, not on which ship or job. A work permit says which
// ship, area and job, on which days, for which vendor, often with the names
// of the people on it. Matching the two gives each attendance day its likely
// work:
//   - "nama di izin kerja": the worker's name is on a permit active that day;
//   - "izin kerja vendor": no permit names the worker, but the worker's
//     vendor (kepala subkon or PT) has permits active that day;
//   - none: unknown.

const (
	matchByName   = "nama di izin kerja"
	matchByVendor = "izin kerja vendor"
)

type dayWork struct {
	Ship    string `json:"ship"`
	Project string `json:"project,omitempty"`
	Work    string `json:"pekerjaan,omitempty"`
	Area    string `json:"area,omitempty"`
	Permit  string `json:"no_workpermit,omitempty"`
	Match   string `json:"match"`
}

// permitIndex holds the approved-or-not permits by the names and vendors on
// them, for one attendance period.
type permitIndex struct {
	byPerson map[string][]workPermit
	byVendor map[string][]workPermit
}

func personKey(name string) string { return soundKey(strings.TrimSpace(name)) }

func newPermitIndex(permits []workPermit, from, to string) permitIndex {
	idx := permitIndex{byPerson: map[string][]workPermit{}, byVendor: map[string][]workPermit{}}
	for _, p := range permits {
		finish := p.DateFinish
		if finish == "" {
			finish = p.DateStart
		}
		if p.DateStart == "" || p.DateStart > to || finish < from {
			continue
		}
		for _, n := range p.Persons {
			if k := personKey(n); k != "" {
				idx.byPerson[k] = append(idx.byPerson[k], p)
			}
		}
		if k := normalizeVendorName(p.Vendor); k != "" {
			idx.byVendor[k] = append(idx.byVendor[k], p)
		}
	}
	return idx
}

// workFor is the likely work of one attendance day, at most 3 permits.
func (idx permitIndex) workFor(d attendanceDay) []dayWork {
	pick := func(list []workPermit, match string) []dayWork {
		var out []dayWork
		seen := map[string]bool{}
		for _, p := range list {
			if !p.activeOn(d.Date) || seen[p.Ship+"|"+p.Work] {
				continue
			}
			seen[p.Ship+"|"+p.Work] = true
			out = append(out, dayWork{Ship: p.Ship, Project: p.ProjectID, Work: p.Work, Area: p.Area, Permit: p.No, Match: match})
			if len(out) == 3 {
				break
			}
		}
		return out
	}
	if w := pick(idx.byPerson[personKey(d.Name)], matchByName); len(w) > 0 {
		return w
	}
	if !d.VendorWorker && d.Group != "" {
		return nil // internal employees have no vendor permits
	}
	for _, v := range []string{d.KepalaSubkon, d.NamaPT} {
		if k := normalizeVendorName(v); k != "" && k != "-" {
			if w := pick(idx.byVendor[k], matchByVendor); len(w) > 0 {
				return w
			}
		}
	}
	return nil
}

type shipAgg struct {
	ship                string
	workers             map[string]bool
	manDays             float64
	estimated, overtime float64 // minutes, split over the ships of a day
	works               map[string]int
	byName, byVendor    int
}

// attendanceByShip sums attendance per ship through the permits. A day
// linked to several ships counts a share for each; unmatched days go to
// "Tidak diketahui".
func attendanceByShip(days []attendanceDay, idx permitIndex, sortBy string, limit int) ([]map[string]interface{}, map[string]int) {
	groups := map[string]*shipAgg{}
	matched := map[string]int{}
	get := func(ship string) *shipAgg {
		g := groups[ship]
		if g == nil {
			g = &shipAgg{ship: ship, workers: map[string]bool{}, works: map[string]int{}}
			groups[ship] = g
		}
		return g
	}
	for _, d := range days {
		work := idx.workFor(d)
		ships := map[string][]dayWork{}
		for _, w := range work {
			ships[w.Ship] = append(ships[w.Ship], w)
		}
		if len(ships) == 0 {
			matched["tidak_diketahui"]++
			g := get("Tidak diketahui")
			g.workers[d.EmpCode] = true
			g.manDays++
			g.estimated += float64(d.EstimatedMinutes)
			g.overtime += float64(d.OvertimeMinutes)
			continue
		}
		matched[work[0].Match]++
		share := 1 / float64(len(ships))
		for ship, ws := range ships {
			if ship == "" {
				ship = "Tanpa nama kapal"
			}
			g := get(ship)
			g.workers[d.EmpCode] = true
			g.manDays += share
			g.estimated += float64(d.EstimatedMinutes) * share
			g.overtime += float64(d.OvertimeMinutes) * share
			for _, w := range ws {
				if w.Work != "" {
					g.works[w.Work]++
				}
			}
			if ws[0].Match == matchByName {
				g.byName++
			} else {
				g.byVendor++
			}
		}
	}
	list := make([]*shipAgg, 0, len(groups))
	for _, g := range groups {
		list = append(list, g)
	}
	sort.Slice(list, func(i, j int) bool {
		a, b := list[i].estimated, list[j].estimated
		if sortBy == "overtime" {
			a, b = list[i].overtime, list[j].overtime
		}
		if a != b {
			return a > b
		}
		return list[i].ship < list[j].ship
	})
	rows := []map[string]interface{}{}
	for _, g := range list {
		if len(rows) == limit {
			break
		}
		works := make([]string, 0, len(g.works))
		for w := range g.works {
			works = append(works, w)
		}
		sort.Slice(works, func(i, j int) bool { return g.works[works[i]] > g.works[works[j]] })
		if len(works) > 5 {
			works = works[:5]
		}
		row := map[string]interface{}{"ship": g.ship, "workers": len(g.workers), "man_days": float64(int(g.manDays*10)) / 10,
			"hours_incl_estimates": hours(int(g.estimated)), "overtime_hours": hours(int(g.overtime))}
		if len(works) > 0 {
			row["pekerjaan"] = works
		}
		if g.ship != "Tidak diketahui" {
			row["days_by_name"], row["days_by_vendor_permit"] = g.byName, g.byVendor
		}
		rows = append(rows, row)
	}
	return rows, matched
}
