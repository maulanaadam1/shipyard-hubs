package itemparse

import (
	"regexp"
	"strconv"
	"strings"
)

// RepairVersion identifies the repair list rules on top of the WO rules;
// stored with every parsed repair list activity. Change it whenever
// ParseRepair's output can change.
const RepairVersion = Version + "+rl.2"

// Component of a repair list line that is one part of a job priced in parts:
// SIAGA repair lists often split a job into "jasa" and "material" lines under
// the activity that names the work.
const (
	ComponentService  = "jasa"
	ComponentMaterial = "material"
)

// RulesPackage marks a whole-vessel package (a new building contract priced
// as one line), which has no unit price to compare.
const RulesPackage = "paket"

// RepairResult is one parsed repair list activity.
type RepairResult struct {
	Result
	Component string // ComponentService | ComponentMaterial | ""
}

var (
	reRepairService  = regexp.MustCompile(`^(jasa|upah|ongkos( kerja)?|labou?r( cost)?|biaya jasa|service cost)\b`)
	reRepairMaterial = regexp.MustCompile(`^(material|bahan|material cost)\b|/ ?material$|\b(jotun|jotafix|jotamastic|jotacote|hempel|hempadur|nippon|kansai|international paint|interzinc|intershield|thinner|primer)\b`)
	// Surface preparation words SIAGA repair lists use that WO items rarely do.
	reRepairPrep = regexp.MustCompile(`amplas\w*|ampelas\w*|power ?tool\w*|wire ?brush\w*|chipping|sikat kawat`)
	reDocking    = regexp.MustCompile(`\b(un)?docking\b|\b(naik|turun) (dock|dok)\b|\bdock ?(&|dan|/)? ?undock`)
	rePackage    = regexp.MustCompile(`\bpembangunan\b|\bbangunan baru\b|\bkapal baru\b|\bnew ?building\b|^(barge|tug ?boat|rbb|oil tanker|tanker|lct|landing craft|kapal)\b.*\b(s\.? ?\d{3,4}|feet|meter|ton|hp)\b`)
	reAreaUnit   = regexp.MustCompile(`^(m2|m²|meter persegi)$`)
)

const prepAction = "Persiapan permukaan"

// ParseRepair reads a repair list activity. groups are the names of the
// groups above it, outermost first (the repair list's own hierarchy, without
// version headings); unit and qty are the activity's own columns, which SIAGA
// keeps out of the description.
//
// The activity decides when it names the work. A "jasa" or "material" line,
// or one that names no work, takes the work from the nearest group that does;
// an activity naming only the action ("Lakukan pengecatan 2 layer") takes the
// object from its groups ("Dinding luar wheel house"). Docking lines and new
// building packages are named as such.
func ParseRepair(desc, unit string, qty float64, groups []string) RepairResult {
	low := strings.ToLower(Clean(desc))
	label := desc
	if u := strings.TrimSpace(unit); u != "" {
		label += ", " + strconv.FormatFloat(qty, 'f', -1, 64) + " " + u
	}
	out := RepairResult{Result: parseRepairText(label)}
	// "Pembangunan 1 unit kapal baru ..." reads as general ship work; on a
	// repair list it is the whole new building contract.
	if (!out.Recognized || out.Object == "Kapal (layanan umum)") && rePackage.MatchString(low) {
		out.Result = Result{Rules: RulesPackage, Action: "Paket", Object: "Pembangunan kapal baru", Qty: out.Qty,
			WorkType: "Paket pembangunan kapal baru", Recognized: true}
		return out
	}
	switch {
	case reRepairService.MatchString(low):
		out.Component = ComponentService
	case reRepairMaterial.MatchString(low):
		out.Component = ComponentMaterial
	}

	if out.Component != "" {
		// The line is one part of its group's job: the group names the work.
		if g, ok := groupWork(groups); ok {
			g.Qty, g.Source = out.Qty, out.Source
			if out.Size != "" {
				g.Size = out.Size
			}
			out.Result = g
		}
		return out
	}
	if out.Recognized {
		// "Pengecatan 2 layer, 50 m2" under "Dinding luar wheel house": the
		// group names the surface.
		if out.Object == surfaceObject {
			if obj := groupObject(groups); obj != "" {
				out.Object, out.WorkType, out.FromActivity = obj, joinWords(out.Action, strings.ToLower(obj)), true
			}
		}
		return out
	}

	action := out.Action
	if action == "" && reRepairPrep.MatchString(low) {
		action = prepAction
	}
	if action != "" && action != noVerbAction && out.Object == "" {
		obj, fromGroup := groupObject(groups), true
		if obj == "" && (surfaceActions[action] || action == prepAction) && reAreaUnit.MatchString(strings.ToLower(strings.TrimSpace(unit))) {
			obj, fromGroup = surfaceObject, false
		}
		if obj != "" {
			out.Action, out.Object = action, obj
			out.WorkType, out.Recognized, out.FromActivity = joinWords(action, strings.ToLower(obj)), true, fromGroup
			if action == prepAction && obj == surfaceObject {
				out.WorkType = prepAction + " (per m2)"
			}
			return out
		}
	}
	if g, ok := groupWork(groups); ok {
		g.Qty, g.Source = out.Qty, out.Source
		if out.Size != "" {
			g.Size = out.Size
		}
		out.Result = g
		return out
	}
	if reDocking.MatchString(low) || (len(groups) > 0 && reDocking.MatchString(strings.ToLower(groups[len(groups)-1]))) {
		out.Result = Result{Rules: RulesCost, Action: "Biaya / jasa", Object: "Docking & undocking", Qty: out.Qty,
			WorkType: "Biaya / jasa docking & undocking", Recognized: true}
		return out
	}
	return out
}

var rePaintWork = regexp.MustCompile(`pengecatan|\bdicat\b|\bcat \d|painting|\blayer\b|\bcoat`)

// parseRepairText is Parse, except that "pembersihan dan pengecatan 2 layer"
// is painting: repair lists name the cleaning before the paint job it
// prepares, and the line is priced as painting.
func parseRepairText(text string) Result {
	r := Parse(text)
	if r.Action == "Pembersihan" && rePaintWork.MatchString(strings.ToLower(Clean(text))) {
		r.Action = "Pengecatan"
		r.WorkType = joinWords(r.Action, strings.ToLower(r.Object))
		if r.Object == "" {
			r.WorkType = r.Action
		}
	}
	return r
}

// groupWork is the work named by the groups: the nearest action and the
// nearest thing worked on, which can sit in different groups ("Pengecatan" >
// "Lambung"), else the nearest group naming work at all. A group that is a
// cost, labour or project heading doesn't count.
func groupWork(groups []string) (Result, bool) {
	var act, obj, whole *Result
	for i := len(groups) - 1; i >= 0; i-- {
		g := parseRepairText(groups[i])
		if g.Rules == RulesCost || g.Object == "Kapal (layanan umum)" || g.Object == labourObject {
			continue
		}
		if act == nil && g.Action != "" && g.Action != noVerbAction {
			act = &g
		}
		if obj == nil && g.Object != "" {
			obj = &g
		}
		if whole == nil && g.Recognized {
			whole = &g
		}
	}
	var r Result
	switch {
	case act != nil && obj != nil && act == obj:
		r = *act
	case act != nil && obj != nil:
		r = *obj
		r.Action, r.WorkType = act.Action, joinWords(act.Action, strings.ToLower(obj.Object))
		r.Recognized = true
	case whole != nil:
		r = *whole
	default:
		return Result{}, false
	}
	r.FromActivity = true
	return r, true
}

// groupObject is the thing worked on named by the nearest group that names one.
func groupObject(groups []string) string {
	for i := len(groups) - 1; i >= 0; i-- {
		if g := parseRepairText(groups[i]); g.Object != "" && g.Object != "Kapal (layanan umum)" && g.Object != labourObject && g.Rules != RulesCost {
			return g.Object
		}
	}
	return ""
}
