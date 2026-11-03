// Package itemparse reads a SIAGA work item description and splits it into
// structured fields: the work done (action), the thing worked on (object),
// material, a comparable size, quantity and material source, plus pipe length
// and fittings, or hull frame, side and plate weight.
//
// SIAGA descriptions are free text built from a few recurring templates
// ("Ganti baru packing , bahan karet dia. 2" x 3 mm, jumlah 4 unit (supply
// dock)"), so recognizing their fixed phrases is enough; ~6,400 distinct names
// in one category collapse to ~200 work types. The rule set is chosen from the
// text itself (plate dimensions or hull work words -> hull rules), not from
// the SIAGA category, whose names vary too much (506 spellings for piping).
//
// Rules were tuned on the SEA CHEST & SEA VALVE, REPLATING and piping
// categories (Nov 2026) and must stay in step with the reference kept with the
// trial; change Version whenever the output can change.
package itemparse

import (
	"regexp"
	"strconv"
	"strings"
)

// Version identifies the rule set; stored with every parsed row.
const Version = "2026-11-03.1"

// Rule sets.
const (
	RulesGeneral = "umum"    // valves, pipes, packing, bolts...: the common SIAGA template
	RulesHull    = "lambung" // hull steel: plates, frames, brackets..., priced per Kg
)

// Result is one parsed description. Empty strings and nil pointers mean the
// field was not found.
type Result struct {
	Rules      string
	Action     string // e.g. "Ganti baru", "Replating"
	Object     string // e.g. "Packing", "Gate valve", "Bottom"
	Material   string // e.g. "karet", "seamless"
	Size       string // comparable size, e.g. `Ø 2" x 3 mm`, "5K-125", "plat 8 mm"
	Qty        string // e.g. "4 unit"
	Source     string // "supply dock" | "supply owner" | "material lama"
	WorkType   string // action + object (+ material where it sets the price)
	Recognized bool   // action and object both found
	PipeMM     *float64
	Elbows     *int
	Flanges    *int
	Frame      string // hull frame numbers, e.g. "16/17-17/18"
	Side       string // "kiri" | "kanan" | "kiri & kanan"
	WeightKg   *float64
}

type rule struct {
	re   *regexp.Regexp
	name string
}

func rules(pairs ...string) []rule {
	out := make([]rule, 0, len(pairs)/2)
	for i := 0; i < len(pairs); i += 2 {
		out = append(out, rule{regexp.MustCompile(pairs[i]), pairs[i+1]})
	}
	return out
}

// first returns the name of the first rule (in list order) that matches.
func first(rs []rule, text string) string {
	for _, r := range rs {
		if r.re.MatchString(text) {
			return r.name
		}
	}
	return ""
}

// earlyMatcher finds the rule matching earliest in a text; on a tie, the one
// listed first. The main work is what a label says first ("Bongkar dan pasang
// mur dan baut ... asistensi press test valve" is bolt work, not a press test).
//
// All rules are joined into one alternation, (r1)|(r2)|...: Go's regexp
// returns the leftmost match and, at that position, the first alternative that
// matches, which is exactly that rule, in one scan instead of one per rule.
type earlyMatcher struct {
	re     *regexp.Regexp
	groups []int // capture group of each rule's outer parentheses
	names  []string
}

func newEarlyMatcher(rs []rule) *earlyMatcher {
	m := &earlyMatcher{names: make([]string, len(rs)), groups: make([]int, len(rs))}
	parts := make([]string, len(rs))
	group := 1
	for i, r := range rs {
		parts[i] = "(" + r.re.String() + ")"
		m.groups[i], m.names[i] = group, r.name
		group += 1 + r.re.NumSubexp()
	}
	m.re = regexp.MustCompile(strings.Join(parts, "|"))
	return m
}

func (m *earlyMatcher) find(text string) string {
	loc := m.re.FindStringSubmatchIndex(text)
	if loc == nil {
		return ""
	}
	for i, g := range m.groups {
		if loc[2*g] >= 0 {
			return m.names[i]
		}
	}
	return ""
}

func without(rs []rule, name string) []rule {
	out := make([]rule, 0, len(rs))
	for _, r := range rs {
		if r.name != name {
			out = append(out, r)
		}
	}
	return out
}

func only(rs []rule, names map[string]bool) []rule {
	out := make([]rule, 0, len(rs))
	for _, r := range rs {
		if names[r.name] {
			out = append(out, r)
		}
	}
	return out
}

// ---------------------------------------------------------------- cleaning

var (
	fractions = strings.NewReplacer("¼", " 1/4", "½", " 1/2", "¾", " 3/4", "⅛", " 1/8", "⅜", " 3/8", "⅝", " 5/8", "⅞", " 7/8")
	reStyle   = regexp.MustCompile(`(?i)<style[\s\S]*?</style>`)
	reTag     = regexp.MustCompile(`<[^>]+>`)
	reQuotes  = regexp.MustCompile(`[”“″]`)
	symbols   = strings.NewReplacer("&nbsp;", " ", "''", `"`, "×", "x", "Ø", "dia. ", "ø", "dia. ")
)

// Clean removes HTML, normalizes quotes, fractions and the diameter sign, and
// collapses whitespace.
func Clean(label string) string {
	s := fractions.Replace(label)
	s = reStyle.ReplaceAllString(s, " ")
	s = reTag.ReplaceAllString(s, " ")
	s = strings.ReplaceAll(s, "&nbsp;", " ")
	s = reQuotes.ReplaceAllString(s, `"`)
	s = symbols.Replace(s)
	return strings.Join(strings.Fields(s), " ")
}

// ----------------------------------------------------------- general rules

var actions = rules(
	`^dikerjakan hari|^lembur|sebanyak \d+ orang`, "Lembur (tenaga harian)",
	`bongkar (dan|&) ganti baru`, "Bongkar & ganti baru",
	`bongkar pasang dan perawatan|bongkar,? pasang,? (dan )?perawatan`, "Bongkar pasang & perawatan",
	`bongkar (dan |& )?pasang|bongkar-pasang`, "Bongkar pasang",
	`bongkar (dan |& )?buang`, "Bongkar buang",
	`press test|pressure test|prest test|presstest`, "Press test",
	`ganti baru|penggantian|re+n+ew`, "Ganti baru",
	`stand ?by|stanby|\bkawal\b|pengawalan|pendampingan`, "Standby / pengawalan",
	`wrap+ing|wrapping|bungkus|^cover\b`, "Wrapping / cover",
	`replating`, "Replating",
	`\btap\b|bor (&|dan) tap`, "Buat drat (tap)",
	`cleaning|\bkuras\b|pembersihan`, "Pembersihan",
	`\bx rp\b|rp\.? ?\d|pembelian|\bbeli\b`, "Pengadaan material",
	`pasang baru`, "Pasang baru",
	`modifikasi`, "Modifikasi",
	`buat (baru )?lubang|\bbor\b`, "Buat lubang / bor",
	`fabrikasi|pembuatan|buat baru`, "Fabrikasi",
	`^pasang\b`, "Pasang",
	`perawatan|service|servis|overhaul|pembersihan|bersihkan`, "Perawatan / service",
	`pengecatan|cat `, "Pengecatan",
	`las|welding|tambal`, "Pengelasan",
)

// Order matters on a tie: valve types before "valve", packing before pipe.
var objects = rules(
	`mur (dan|&) baut|baut (dan|&) mur|\bbaut\b`, "Mur & baut",
	`packing|gasket|paking`, "Packing",
	`gate valve`, "Gate valve",
	`globe valve`, "Globe valve",
	`angle valve|angel valve`, "Angle valve",
	`butterfly valve|butterfly`, "Butterfly valve",
	`storm valve`, "Storm valve",
	`ball valve`, "Ball valve",
	`check valve|non return|swing check`, "Check valve",
	`safety valve|relief valve`, "Safety valve",
	`strainer|strener|saringan`, "Strainer",
	`kotak laut|sea ?chest`, "Sea chest (kotak laut)",
	`air vent head|\bavh\b`, "Air vent head",
	`\bvalve\b|kran`, "Valve (lain)",
	`\belbow\b`, "Elbow",
	`reducer`, "Reducer",
	`nipple|nepel`, "Nipple",
	`\bdop\b`, "Dop",
	`u-?bolt`, "U-bolt",
	`\bblank\b|\bblenk\b`, "Blank flange",
	`wire ?ma?e?sh|wiremash|waremes`, "Wire mesh",
	// A bare JIS valve code ("bongkar dan pasang 5k50") is a valve.
	`\b\d{1,2}\s?k\s?-?\s?\d{2,3}\b`, "Valve (lain)",
	`penghalang pipa`, "Pipa penghalang",
	`\bsock\b|\bsok\b`, "Sock",
	`\bdrat\b`, "Drat pipa",
	`\bpipa\b|\bpipe\b`, "Pipa",
	`\bhose\b|selang`, "Hose",
	`flange|flens|flengs`, "Flange",
	`clem|klem|clamp`, "Klem",
	`\bsiku\b`, "Besi siku",
	`\bplat\b|\bpelat\b`, "Plat",
	`zinc|anoda|anode`, "Zinc anode",
	`\bcover\b|tutup`, "Cover",
	`\blubang\b`, "Lubang",
	`silikon|sealant`, "Silikon / sealant",
	`sekrup|skrup`, "Sekrup",
	`daun kemudi`, "Daun kemudi",
	`[ck]ort nozzle`, "Kort nozzle",
	`almari|lemari|dipet|cuci piring`, "Perabot dapur",
	`tan?gki|tanki`, "Tangki",
	`\bpompa\b`, "Pompa",
	`lantai kayu|lapisan lantai|vynil|vinyl`, "Lantai",
	`\bfiber\b|dempul|fender|sirip|sandpaper`, "Fiber / lambung",
	`pintu|kusen|engsel`, "Pintu & kusen",
	`tangga`, "Tangga",
	`way[ae]r|wire rope|sling`, "Wire rope",
	`sil[ie]n?cer|knalpot`, "Silencer",
	`turun dock|naik dock|\bkapal\b`, "Kapal (layanan umum)",
)

// Piping words the general lists do not have.
var pipingActions = rules(
	`\bbending\b|tekuk`, "Bending",
	`wra[bp]+ing|wrapping|bungkus`, "Wrapping / cover",
	`^cover\b`, "Wrapping / cover",
	`\bstel\b|setel|setting`, "Setel",
	`kalibrasi|calibrat`, "Kalibrasi",
	`flushing`, "Flushing",
)

var pipingObjects = rules(
	`\bpipa\b|\bpipe\b`, "Pipa",
	`kabel|cable|grounding`, "Kabel",
	`\bskun\b|terminal lug`, "Skun",
	`pres+ure gauge|manometer|pressure indicator`, "Pressure gauge",
	`thermometer|termometer`, "Termometer",
	`sounding`, "Sounding (pipa ukur)",
	`\btee\b|\bt-?piece\b`, "Tee",
	`\bunion\b|\bwatermur\b`, "Union / watermur",
	`\bbend\b`, "Bend",
	`\bpvc\b`, "Pipa PVC",
	`flexib|fleksib`, "Flexible hose",
	`\bplate\b|\bplat\b`, "Plat",
)

var materials = rules(
	`stainless|sus ?3\d\d|\bss\b`, "stainless",
	`\bkaret\b|rubber`, "karet",
	`tombo`, "tombo",
	`seamless`, "seamless",
	`galvanis|galvanized`, "galvanis",
	`\bsteel\b|\bbesi\b`, "steel",
)

var sources = rules(
	`supply owner|suply owner|dari owner|owner supply`, "supply owner",
	`supply dock|suply dock|dari galangan|supply galangan`, "supply dock",
	`material lama|barang lama|bahan lama|eks lama`, "material lama",
)

var pipeObjects = map[string]bool{"Pipa": true, "Pipa penghalang": true, "Sock": true, "Drat pipa": true}

// -------------------------------------------------------------- hull rules

var hullActions = rules(
	`angkat (dan|&) geser|geser plat`, "Angkat & geser plat",
	`pelurusan|meluruskan|fairing`, "Pelurusan",
	`perhitungan bevel|\bbevel\b`, "Bevel / nat las",
	`las ulang|pengelasan ulang`, "Las ulang",
	`\bbending\b`, "Bending",
	`^b/p\b|\bb/p\b`, "Bongkar pasang",
	`^g/b\b|\bg/b\b`, "Ganti baru",
	`^pasang\b`, "Pasang",
	`ultrasonic|thickness test|\but\b test|penetrant|\bmpi\b|magnetic particle`, "Inspeksi (UT / MPI / penetrant)",
	`consumable|opnam|opname|transportasi|kekurangan`, "Biaya lain",
	`ferr?ing|fairing`, "Pelurusan",
	`\bprest\b|\bpres\b`, "Press test",
	`asistensi`, "Asistensi",
	`perhitungan`, "Perhitungan (lain)",
	`\bseset\b|gouging`, "Seset / gouging",
	`bongkar (dan |& )?ganti baru`, "Bongkar & ganti baru",
)

// Only when no fuller phrase ("bongkar pasang", "bongkar dan buang") matched.
var hullLastResort = rules(`^bongkar\b`, "Bongkar")

var hullObjects = rules(
	`side ?board|lambung|shell plat`, "Sideboard / lambung",
	`\bbilga\b|\bbilge\b`, "Bilga",
	`\bbott?om\b|\bbotom\b`, "Bottom",
	`\bdeck\b|main ?deck|geladak`, "Deck",
	`\blajur\b|strake`, "Lajur (strake)",
	`kon?struksi dalam|kontruksi`, "Konstruksi dalam",
	`roundbar|round bar|besi as\b`, "Roundbar / besi as",
	`pisang`, "Fender pisang-pisang",
	`\bpilar\b|pillar`, "Pilar",
	`palka|hatch`, "Palka",
	`\bweb\b`, "Gading / web frame",
	`\blis\b`, "List",
	`jendela`, "Jendela",
	`pintu|engsel|handel|handle`, "Pintu & engsel",
	`peranca[hk]|scaffold`, "Perancah (scaffolding)",
	`\bban\b|dapra`, "Ban dapra",
	`\bbull\b|bolder|bollard`, "Bolder",
	`\bbox\b`, "Box",
	`propeller|shaft|rudder stock`, "Propeller / shaft",
	`\bw ?rang\b|\bfloor\b`, "Wrang",
	`\bsiku\b`, "Siku",
	`brac?ke?t|bracet|braket`, "Bracket",
	`\bs?e?kat\b|\bskat\b|bulkhead`, "Sekat",
	`girder|penumpu`, "Girder",
	`web frame|gading|\bframe\b`, "Gading / web frame",
	`\btop\b`, "Top",
	`collar|kolar`, "Collar",
	`doubling|dobling`, "Doubling",
	`bul+w[ao]rk|bullwalk|bulwark`, "Bulwark",
	`\bstay\b`, "Stay",
	`pondasi|fondasi`, "Pondasi",
	`dinding`, "Dinding",
	`\blunas\b|\bkeel\b|\bkill\b`, "Lunas",
	`transom|transum|\bcenta\b`, "Transom",
	`h-?beam`, "H-beam",
	`tulangan|penguat`, "Penguat / tulangan",
	`\bsepatu\b`, "Sepatu",
	`temporer|strip plat`, "Temporer / strip",
	`pimsol|plimsol|draft mark|merkah`, "Plimsoll / draft mark",
	`daun kemudi|kemudi`, "Kemudi",
	`list cover|\blist\b`, "List",
	`tangga`, "Tangga",
	`jangkar|rantai|segel|swi[fv]el`, "Jangkar & rantai",
	`railing|reling`, "Railing",
)

// Fittings that also show up in hull work (taken from the general list).
// Tangki and pompa are left out: in hull work they name a location
// ("pekerjaan dalam tanki"), not the thing being worked on.
var hullFittings = only(objects, map[string]bool{
	"Mur & baut": true, "Packing": true, "Gate valve": true, "Globe valve": true, "Angle valve": true,
	"Butterfly valve": true, "Storm valve": true, "Ball valve": true, "Check valve": true, "Safety valve": true,
	"Valve (lain)": true, "Pipa": true, "Pipa penghalang": true, "Sock": true, "Hose": true, "Flange": true,
	"Klem": true, "Elbow": true, "Zinc anode": true, "Lubang": true, "Cover": true,
})

// A plain "plat" only when no hull part is named ("Replating plat bullwork" is bulwark).
var genericPlate = rules(`\bplat\b|\bpelat\b`, "Plat (lain)")

var hullParts = func() map[string]bool {
	m := map[string]bool{"Plat (lain)": true}
	for _, r := range hullObjects {
		m[r.name] = true
	}
	return m
}()

// Plate dimensions or hull work words choose the hull rules.
var hullTrigger = regexp.MustCompile(`replating|angkat (dan|&) geser|pelurusan|las ulang|\bbevel\b|\blajur\b`)

// The rule lists, compiled once as earliest-match alternations.
var (
	matchActions        = newEarlyMatcher(actions)
	matchObjects        = newEarlyMatcher(objects)
	matchObjectsNoCover = newEarlyMatcher(without(objects, "Cover"))
	matchPipingActions  = newEarlyMatcher(pipingActions)
	matchPipingObjects  = newEarlyMatcher(pipingObjects)
	matchHullActions    = newEarlyMatcher(append(append([]rule{}, hullActions...), actions...))
	matchHullLastResort = newEarlyMatcher(hullLastResort)
	matchHullObjects    = newEarlyMatcher(append(append([]rule{}, hullObjects...), hullFittings...))
	matchGenericPlate   = newEarlyMatcher(genericPlate)
)

// ------------------------------------------------------------------- sizes

const num = `\d+(?:[.,]\d+)?(?:\s+\d/\d+)?|\d/\d+`
const inch = `(?:` + num + `)\s*(?:"|inch|in\b|inc\b)`

var (
	reInchUnit    = regexp.MustCompile(`\s*(inch|in|inc)\b`)
	reDecimalInch = regexp.MustCompile(`^(\d+)\.(25|5|50|75)$`)
	reLeadingDot  = regexp.MustCompile(`^0?\.(25|5|75)$`)

	reValveDNPN   = regexp.MustCompile(`\bdn\s?(\d{2,3})\s*pn\s?(\d{1,2})`)
	reValveJIS    = regexp.MustCompile(`(\d{1,2})\s*k\s*[- ]?\s*(\d{2,3})\b`)
	reValveInchK  = regexp.MustCompile(`(` + inch + `)\s*-?\s*(\d{1,2})\s*k\b`)
	reDiaInch     = regexp.MustCompile(`(?:dia\.?|uk\.?)\s*(` + inch + `)`)
	reAnyInch     = regexp.MustCompile(`(` + inch + `)`)
	reBoltMetric  = regexp.MustCompile(`\bm\s?(\d{1,2})\s*x\s*(\d{2,3})\b`)
	reBoltInch    = regexp.MustCompile(`uk\.?\s*(` + num + `)\s*"?\s*x\s*(` + num + `)\s*"?`)
	rePacking     = regexp.MustCompile(`dia\.?\s*(` + num + `)\s*"?\s*x\s*(` + num + `)\s*mm`)
	reReducer     = regexp.MustCompile(`(` + inch + `)\s*x\s*(` + num + `)\s*"?`)
	reSchedule    = regexp.MustCompile(`sch\.?\s*(\d+)`)
	reAngleL      = regexp.MustCompile(`\(\s*(\d+)\s*\+\s*(\d+)\s*\)\s*mm\s*x\s*\d+\s*mm\s*x\s*(\d+)\s*mm`)
	reAngleLDec   = regexp.MustCompile(`\(\s*(\d+)\s*\+\s*(\d+)\s*\)\s*mm\s*x\s*\d+\s*mm\s*x\s*(\d+(?:[.,]\d+)?)\s*mm`)
	rePlateDims   = regexp.MustCompile(`(\d+)\s*mm\s*x\s*(\d+)\s*mm\s*x\s*(\d+)\s*mm`)
	reQty         = regexp.MustCompile(`(?:jumlah|sebanyak)?\s*(\d+)\s*(unit|pcs|buah|bh|set|lbr|lembar|batang|btg|orang)\b`)
	reUBolt       = regexp.MustCompile(`u-?bolt`)
	reThickPieces = regexp.MustCompile(`(\d+(?:[.,]\d+)?)\s*mm\s*x\s*\d+\s*(?:lbr|lembar|batang|btg|pcs|unit|bh|buah)\b`)
	reThickThird  = regexp.MustCompile(`\d+\s*mm?\s*x\s*\d+\s*mm?\s*x\s*(\d+(?:[.,]\d+)?)\s*mm`)
	reThickWeight = regexp.MustCompile(`x\s*(\d+(?:[.,]\d+)?)\s*mm\s*=\s*[\d.,]+\s*kg`)
)

func normInch(s string) string {
	s = strings.ReplaceAll(strings.TrimSpace(s), ",", ".")
	s = reInchUnit.ReplaceAllString(s, "")
	s = strings.TrimSpace(strings.ReplaceAll(s, `"`, ""))
	// 2.5 and 2 1/2 are the same size: write inches as fractions.
	frac := map[string]string{"25": "1/4", "5": "1/2", "50": "1/2", "75": "3/4"}
	if m := reDecimalInch.FindStringSubmatch(s); m != nil {
		if m[1] != "0" {
			s = m[1] + " " + frac[m[2]]
		} else {
			s = frac[m[2]]
		}
	}
	if m := reLeadingDot.FindStringSubmatch(s); m != nil {
		s = frac[m[1]]
	}
	return s + `"`
}

func parseSize(t, obj string) string {
	if strings.HasSuffix(obj, "valve") || obj == "Valve (lain)" || obj == "Strainer" || obj == "Air vent head" {
		if m := reValveDNPN.FindStringSubmatch(t); m != nil {
			return "DN" + m[1] + " PN" + m[2]
		}
		if m := reValveJIS.FindStringSubmatch(t); m != nil {
			return m[1] + "K-" + m[2]
		}
		if m := reValveInchK.FindStringSubmatch(t); m != nil {
			return normInch(m[1]) + " " + m[2] + "K"
		}
		if m := reDiaInch.FindStringSubmatch(t); m != nil {
			return normInch(m[1])
		}
	}
	if obj == "Mur & baut" {
		if m := reBoltMetric.FindStringSubmatch(t); m != nil {
			return "M" + m[1] + " x " + m[2] + " mm"
		}
		if m := reBoltInch.FindStringSubmatch(t); m != nil {
			return normInch(m[1]) + " x " + normInch(m[2])
		}
	}
	if obj == "Packing" {
		if m := rePacking.FindStringSubmatch(t); m != nil {
			return "Ø " + normInch(m[1]) + " x " + strings.ReplaceAll(m[2], ",", ".") + " mm"
		}
	}
	switch obj {
	case "Pipa", "Pipa penghalang", "Sock", "Drat pipa", "Hose", "Flange", "Klem", "Elbow", "Nipple", "Dop", "U-bolt", "Reducer":
		if obj == "Reducer" {
			if m := reReducer.FindStringSubmatch(t); m != nil {
				return normInch(m[1]) + " x " + normInch(m[2])
			}
		}
		var parts []string
		dia := reDiaInch.FindStringSubmatch(t)
		if dia == nil {
			dia = reAnyInch.FindStringSubmatch(t)
		}
		if dia != nil {
			parts = append(parts, "Ø "+normInch(dia[1]))
		}
		if sch := reSchedule.FindStringSubmatch(t); sch != nil {
			parts = append(parts, "sch "+sch[1])
		}
		return strings.Join(parts, " ")
	}
	if obj == "Besi siku" {
		// (50 + 50) mm x 300 mm x 5 mm: the L profile; it is priced per Kg.
		if m := reAngleL.FindStringSubmatch(t); m != nil {
			return "L " + m[1] + "x" + m[2] + "x" + m[3] + " mm"
		}
	}
	if obj == "Plat" || obj == "Besi siku" {
		if m := rePlateDims.FindStringSubmatch(t); m != nil {
			return m[1] + " x " + m[2] + " x " + m[3] + " mm"
		}
	}
	return ""
}

// plateThickness is the plate thickness in "Uk. 1830 mm x 750 mm x 12 mm x 1
// lbr = 129.29 Kg", the size that hull work is compared by.
func plateThickness(t string) string {
	for _, re := range []*regexp.Regexp{reThickPieces, reThickThird, reThickWeight} {
		if m := re.FindStringSubmatch(t); m != nil {
			return "plat " + strings.ReplaceAll(m[1], ",", ".") + " mm"
		}
	}
	return ""
}

func parseQty(t string) string {
	m := reQty.FindStringSubmatch(t)
	if m == nil {
		return ""
	}
	unit := map[string]string{"buah": "pcs", "bh": "pcs", "lembar": "lbr", "btg": "batang"}[m[2]]
	if unit == "" {
		unit = m[2]
	}
	return m[1] + " " + unit
}

// ------------------------------------------------------------ pipe details

var (
	rePlateInPipe = regexp.MustCompile(`x\s*\d+\s*(?:lbr|lembar|batang)\b|=\s*[\d.,]+\s*kg`)
	rePipeLength  = regexp.MustCompile(`(?:uk\.?|dia\.?\s*[\d\s/.,]+"?\s*,)\s*((?:\d+(?:[.,]\d+)?\s*mm\s*\+\s*)*\d+(?:[.,]\d+)?)\s*mm`)
	reNumber      = regexp.MustCompile(`\d+(?:[.,]\d+)?`)
	reElbows      = regexp.MustCompile(`(?:elbow)\s*,?\s*(\d+)\s*(?:unit|pcs|bh|buah)`)
	reFlanges     = regexp.MustCompile(`(?:flange?s?|flens)\s*,?\s*(\d+)\s*(?:unit|pcs|bh|buah)`)
)

func parseFloat(s string) float64 {
	f, _ := strconv.ParseFloat(strings.ReplaceAll(s, ",", "."), 64)
	return f
}

// pipeDetails reads pipe length (mm, summed over "100 mm + 200 mm") and the
// elbow / flange counts, e.g. `Dia. 2", 300 mm (supply dock) Elbow, 1 unit`.
func pipeDetails(t string) (*float64, *int, *int) {
	if rePlateInPipe.MatchString(t) {
		return nil, nil, nil // plate dimensions, not a pipe length
	}
	var length *float64
	if m := rePipeLength.FindStringSubmatch(t); m != nil {
		var sum float64
		for _, n := range reNumber.FindAllString(m[1], -1) {
			sum += parseFloat(n)
		}
		length = &sum
	}
	count := func(re *regexp.Regexp) *int {
		if m := re.FindStringSubmatch(t); m != nil {
			n, _ := strconv.Atoi(m[1])
			return &n
		}
		return nil
	}
	return length, count(reElbows), count(reFlanges)
}

// ------------------------------------------------------------ hull details

var (
	reFrame      = regexp.MustCompile(`\bfr\.?\s*((?:\d+(?:/\d+)?\s*(?:[-,&]|s/d|sd)?\s*)+)`)
	reSpaces     = regexp.MustCompile(`\s+`)
	reBothSides  = regexp.MustCompile(`\bp\s?&\s?s\b|kanan (dan|&) kiri|kiri (dan|&) kanan|\bps\b`)
	rePortSide   = regexp.MustCompile(`\bkiri\b|\bport\b|\(p\)`)
	reStbdSide   = regexp.MustCompile(`\bkanan\b|\bstarboard\b|\(s\)|\bsb\b`)
	reWeightKg   = regexp.MustCompile(`=\s*([\d.,]+)\s*kg`)
	reStripChars = "-,&"
)

func hullLocation(t string) (frame, side string, weight *float64) {
	if m := reFrame.FindStringSubmatch(t); m != nil {
		frame = strings.Trim(reSpaces.ReplaceAllString(m[1], ""), reStripChars)
	}
	switch {
	case reBothSides.MatchString(t):
		side = "kiri & kanan"
	case rePortSide.MatchString(t):
		side = "kiri"
	case reStbdSide.MatchString(t):
		side = "kanan"
	}
	if m := reWeightKg.FindStringSubmatch(t); m != nil {
		w := parseFloat(m[1])
		weight = &w
	}
	return frame, side, weight
}

// ------------------------------------------------------------------- parse

const (
	labourAction  = "Lembur (tenaga harian)"
	standbyAction = "Standby / pengawalan"
	labourObject  = "Tenaga kerja"
)

// Parse reads one work item description.
func Parse(label string) Result {
	text := Clean(label)
	low := strings.ToLower(text)
	if plateThickness(low) != "" || hullTrigger.MatchString(low) {
		return parseHull(low)
	}
	return parseGeneral(low)
}

func parseGeneral(low string) Result {
	action := matchActions.find(low)
	obj := matchObjects.find(low)
	// "U-bolt" also matches the bolt pattern at the same spot; keep U-bolt.
	if obj == "Mur & baut" && reUBolt.MatchString(low) {
		obj = "U-bolt"
	}
	// "cover pipa": cover is the work here, the pipe is the object.
	if action == "Wrapping / cover" && obj == "Cover" {
		obj = matchObjectsNoCover.find(low)
	}
	material := first(materials, low)
	if obj == "Packing" && (material == "" || material == "steel") {
		if m := first(materials[1:3], low); m != "" {
			material = m
		}
	}
	if action == labourAction || action == standbyAction {
		obj = labourObject
	}
	size := parseSize(low, obj)
	// Work type from the general lists: packing and bolts carry their material.
	work := joinWords(action, strings.ToLower(obj))
	if (obj == "Packing" || obj == "Mur & baut") && material != "" {
		work = joinWords(work, material)
	}
	recognized := action != "" && obj != ""

	// Piping words the general lists do not have.
	if action == "" {
		action = matchPipingActions.find(low)
	}
	if obj == "" || obj == "Cover" {
		if o := matchPipingObjects.find(low); o != "" {
			obj = o
		}
	}
	if !recognized && action != "" && obj != "" {
		recognized = true
		work = joinWords(action, strings.ToLower(obj))
		if size == "" {
			size = parseSize(low, obj)
		}
	}

	r := Result{Rules: RulesGeneral, Action: action, Object: obj, Material: material, Size: size,
		Qty: parseQty(low), Source: first(sources, low), Recognized: recognized}
	// Pipe work: the pipe material sets the price (seamless vs galvanised), plus
	// length and fittings.
	if pipeObjects[obj] {
		r.PipeMM, r.Elbows, r.Flanges = pipeDetails(low)
		if recognized && (material == "seamless" || material == "galvanis" || material == "stainless") {
			work = action + " " + strings.ToLower(obj) + " " + material
		}
	}
	r.WorkType = work
	return r
}

func joinWords(a, b string) string {
	switch {
	case a == "":
		return b
	case b == "":
		return a
	}
	return a + " " + b
}

func parseHull(low string) Result {
	action := matchHullActions.find(low)
	if action == "" {
		action = matchHullLastResort.find(low)
	}
	obj := matchHullObjects.find(low)
	if obj == "" {
		obj = matchGenericPlate.find(low)
	}
	if obj == "Mur & baut" && reUBolt.MatchString(low) {
		obj = "U-bolt"
	}
	thickness := plateThickness(low)
	switch {
	case action == labourAction || action == standbyAction:
		obj = labourObject
	case action == "Angkat & geser plat" && obj == "":
		obj = "Plat (lain)"
	case action == "Biaya lain":
		obj = "Consumable / opname / transport"
	case action == "Inspeksi (UT / MPI / penetrant)" && obj == "":
		obj = "Pelat lambung (titik ukur)"
	}
	// Plate dimensions with no part named ("Replating lajur E kiri, Uk. 1830 mm
	// x ...") is plate work on the hull.
	if action != "" && obj == "" && thickness != "" {
		obj = "Plat (lain)"
	}
	// A hull part with plate dimensions and no verb ("Doubling plat uk. ...") is
	// still plate work; the label just leaves the verb out.
	if obj != "" && action == "" && thickness != "" {
		action = "Pekerjaan plat (tanpa kata kerja)"
	}

	var size string
	if obj == "Siku" {
		if m := reAngleLDec.FindStringSubmatch(low); m != nil {
			size = "L " + m[1] + "x" + m[2] + "x" + m[3] + " mm"
		} else {
			size = thickness
		}
	} else {
		// Plate dimensions win whatever part is named ("penguat dalam pipa ...,
		// Uk. 650 x 70 x 8 mm x 1 lbr" is plate work).
		size = thickness
		if size == "" && !hullParts[obj] {
			size = parseSize(low, obj)
		}
	}

	r := Result{Rules: RulesHull, Action: action, Object: obj, Material: first(materials, low), Size: size,
		Qty: parseQty(low), Source: first(sources, low), Recognized: action != "" && obj != ""}
	r.Frame, r.Side, r.WeightKg = hullLocation(low)
	switch {
	case action == "Angkat & geser plat" || action == "Biaya lain":
		r.WorkType = action // the object is already in the name
	case action != "" && obj != "":
		r.WorkType = action + " " + strings.ToLower(obj)
	default:
		r.WorkType = strings.TrimSpace(action + " " + strings.ToLower(obj))
	}
	return r
}
