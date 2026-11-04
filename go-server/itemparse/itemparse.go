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
// Rules were first tuned on the SEA CHEST & SEA VALVE, REPLATING and piping
// categories, then widened to every category (Nov 2026, 97% of ~398k items):
// deck machinery, electrical, facilities, cleaning and painting by area, and
// lines that are payments, bills, freight, rentals, tests or services rather
// than unit-priced work (RulesCost). The title (first line) of a description
// is read before its detail lines. Change Version whenever the output can
// change; stored items are then parsed again in the background.
package itemparse

import (
	"regexp"
	"strconv"
	"strings"
)

// Version identifies the rule set; stored with every parsed row.
const Version = "2026-11-04.1"

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
// Each rule is searched on its own and the leftmost start wins, which is what
// one alternation (r1)|(r2)|... returns. With ~150 rules, asking the
// alternation which group matched was the slowest part of parsing.
type earlyMatcher struct {
	rules []rule
}

func newEarlyMatcher(rs []rule) *earlyMatcher {
	return &earlyMatcher{rules: rs}
}

func (m *earlyMatcher) find(text string) string {
	best, name := -1, ""
	for _, r := range m.rules {
		loc := r.re.FindStringIndex(text)
		// A rule starting where the best one does loses the tie (listed later).
		if loc == nil || (best >= 0 && loc[0] >= best) {
			continue
		}
		best, name = loc[0], r.name
		if best == 0 {
			break
		}
	}
	return name
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
	labourPattern, "Lembur (tenaga harian)",
	`bongkar (dan|&) ganti baru`, "Bongkar & ganti baru",
	`bongkar pasang dan perawatan|bongkar,? pasang,? (dan )?perawatan`, "Bongkar pasang & perawatan",
	`bongkar (dan |& )?pasang|bongkar-pasang|(buka|lepas) (dan |& )?pasang`, "Bongkar pasang",
	`bongkar (dan |& )?buang`, "Bongkar buang",
	`press test|pressure test|prest test|presstest|test press|\bprest\b`, "Press test",
	`ganti baru|penggantian|re+n+ew|\bganti\b|diganti|replace`, "Ganti baru",
	`stand ?by|stanby|\bkawal\b|pengawalan|pendampingan`, "Standby / pengawalan",
	`wrap+ing|wrapping|bungkus|^cover\b|covering`, "Wrapping / cover",
	`replating`, "Replating",
	`\btap\b|bor (&|dan) tap|\bulir\b`, "Buat drat (tap)",
	// Before cleaning and painting: "sandblasting" is neither, and it once
	// matched "las" (welding).
	`sand ?blast\w*|sweep ?blast\w*|\bblasting\b|sweeping`, "Sandblasting",
	`cleaning|clening|cleanning|\bkuras\b|pengurasan|pembersihan|semprot|water ?jet|hydro ?jet|\bcuci\b|pencucian|\blap\b|dilap`, "Pembersihan",
	`\bx rp\b|rp\.? ?\d|pembelian|\bbeli\b`, "Pengadaan material",
	`pasang baru`, "Pasang baru",
	`modifikasi`, "Modifikasi",
	`buat (baru )?lubang|\bbor\b`, "Buat lubang / bor",
	`fabrikasi|pembuatan|buat baru`, "Fabrikasi",
	`^pasang\b|pemasangan|dipasang|\binstal(l|asi)?\b`, "Pasang",
	`perbaikan|repair|reparasi|memperbaiki|diperbaiki|rekondisi`, "Perbaikan",
	`perawatan|service|servis|overhaul|pembersihan|bersihkan|pelancaran|greasing|pelumasan`, "Perawatan / service",
	`pelurusan|meluruskan|fair?ing|ferr?ing`, "Pelurusan",
	`diskonek|disconnect|\bkonek\b|\bconnect\b|penyambungan|\bsambung\b`, "Sambung / lepas",
	`galian|\bgali\b|penggalian`, "Galian",
	`pengecatan|\bcat |\bdicat\b|painting`, "Pengecatan",
	`\blas\b|\bngelas|pengelasan|\bdilas\b|welding|tambal`, "Pengelasan",
	`gerinda|gurinda|grinding`, "Gerinda",
	`bubut|machining|\bfrais\b|milling`, "Bubut / machining",
	`\bscrap(ing)?\b|\bkerok|\bkeruk|skrap`, "Kerok / scraping",
	`alignment|aligment|allignment|centering|centring`, "Alignment",
	`menaikkan|menurunkan|memindahkan|pemindahan|\blangsir\b|naikkan|turunkan|\bangkat\b|pengangkatan|\btarik\b|penarikan|menarik|shifting`, "Angkat / pindah / tarik",
	`\bisi\b|pengisian|refill|\btransfer\b`, "Isi / transfer",
	`\bpotong\b|pemotongan|cutting`, "Potong",
	`\bbending\b|tekuk`, "Bending",
	`\bstel\b|setel|penyetelan|setting`, "Setel",
	`plester|plaster|\bacian\b|pengecoran|\bcor\b`, "Plester / cor",
	`pemeriksaan|pengecekan|\bcek\b|inspeksi|pengukuran|\bukur\b|measuring`, "Pemeriksaan",
	`asistensi`, "Asistensi",
	`\bbuka\b|pembukaan|^tutup\b|penutupan|menutup`, "Buka / tutup",
)

// labourPattern: a day of hired labour ("Dikerjakan hari kamis ... sebanyak 3
// orang"). What the crew did is in the text too, but the line is a labour cost.
const labourPattern = `^dikerjakan hari|^lembur|sebanyak \d+ orang|man ?power|tenaga harian|overtime|tambahan lembur`

var reLabour = regexp.MustCompile(labourPattern)

// Only when no fuller phrase matched ("bongkar pasang", "bongkar dan buang").
// "Check" alone is a check, except on a check valve.
var lastResortActions = rules(
	`^bongkar\b|\bbongkar\b|gempur|\bbobok\b|pembongkaran`, "Bongkar",
	`\bperhitungan\b`, "Perhitungan (lain)",
	`\bcheck(ing)?\b`, "Pemeriksaan",
)

// Order matters on a tie: valve types before "valve", packing before pipe.
var objects = rules(
	`mur (dan|&) baut|baut (dan|&) mur|\bbaut\b|\bmur\b`, "Mur & baut",
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
	`\belbow?\b`, "Elbow",
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
	`\bsiku\b|angle bar`, "Besi siku",
	`\bplat\b|\bpelat\b`, "Plat",
	`zinc|anoda|anode`, "Zinc anode",
	`\bcover\b|tutup`, "Cover",
	`\blubang\b`, "Lubang",
	`silikon|sealant`, "Silikon / sealant",
	`sekrup|skrup|\bpaku\b`, "Sekrup / paku",
	`daun kemudi`, "Daun kemudi",
	`[ck]ort nozzle`, "Kort nozzle",
	`almari|lemari|dipet|cuci piring`, "Perabot dapur",
	`rumah kampas`, "Rumah kampas rem",
	`tan?gki|tanki|tengki|\btank\b|\bwbt\b|ballast|\bcot\b`, "Tangki",
	`\bpompa\b|\bpump\b`, "Pompa",
	`lantai|keramik|granit|vynil|vinyl`, "Lantai",
	`\bban\b|dapra|fender`, "Ban dapra / fender",
	`\bfiber\b|dempul|sirip|sandpaper`, "Fiber / lambung",
	`pintu|kusen|engsel`, "Pintu & kusen",
	`\btangga\b|ladder`, "Tangga",
	`way[ae]r|wire rope|sling`, "Wire rope",
	`sil[ie]n?cer|knalpot`, "Silencer",
	// Deck machinery and fittings.
	`kampas|brake lining|brake pad|brake band`, "Kampas rem",
	`tromol|brake drum`, "Tromol",
	`windlass|winch|wincth|capstan`, "Windlass / winch",
	`jangkar|rantai|segel|swi[fv]el|shackle`, "Jangkar & rantai",
	`stop+er\b|stoper`, "Stopper",
	`dewi[- ]?dewi|davit`, "Dewi-dewi (davit)",
	`\bcrane\b|\bderek\b|hoist|katrol|takel|chain block`, "Crane / hoist",
	`manhole|man hole`, "Manhole",
	`hatch|palka`, "Palka / hatch",
	`bol+ard|bolder`, "Bolder",
	`rail+ing|rel+ing|handrail`, "Railing",
	`pengunci|\block\b|\bkunci\b|gembok`, "Pengunci",
	`handle|handel|pegangan`, "Handle",
	`dudukan|mounting`, "Dudukan",
	`pondasi|fondasi`, "Pondasi",
	`\bpilar\b|pillar`, "Pilar",
	`\btiang\b|\bmast\b`, "Tiang / mast",
	`peranca[hk]|scaffold`, "Perancah (scaffolding)",
	`brac?ke?t|bracet|braket`, "Bracket",
	`doubling|dobling`, "Doubling",
	`bul+w[ao]rk|bullwalk|bulwark`, "Bulwark",
	`\bkemudi\b|rudder`, "Kemudi",
	`propeller|baling|\bshaft\b|\bporos\b|stern tube`, "Propeller / shaft",
	// Machinery.
	`gearbox|gear box|\bgear\b|roda gigi|sprocket|pinion`, "Gear",
	`bearing|bantalan|laher|bushing`, "Bearing / bushing",
	`oil seal|mechanical seal|\bseal\b`, "Seal",
	`kopling|coupling|copling|clutch`, "Kopling",
	`cooler|heat exchanger|radiator`, "Cooler / radiator",
	`injector|injektor`, "Injector",
	`turbo`, "Turbocharger",
	`\bfilter\b`, "Filter",
	`kompresor|compressor`, "Kompresor",
	`piston|\bliner\b|silinder|cylinder|crank ?shaft|cam ?shaft|connecting rod|stang seher`, "Komponen mesin",
	// Bare "mesin" is mostly a place ("kamar mesin"), so only named engines.
	`mesin induk|main engine|auxiliary engine|mesin bantu|overhaul mesin|mesin tempel`, "Mesin",
	// Electrical.
	`lampu|\blamp\b|armatur|lampu sorot|search ?light|\bled\b`, "Lampu",
	`elektro ?motor|electro ?motor|\bmotor\b|\belmot\b|dinamo`, "Motor listrik",
	`panel|\bmcb\b|saklar|stop ?kontak|\bswitch\b|breaker`, "Panel / saklar",
	`kabel|cable|grounding`, "Kabel",
	`blower|exhaust fan|\bfan\b|kipas|ventilator`, "Blower / fan",
	`genset|generator|alternator`, "Genset",
	`air ?con|aircon|\bac split|\bac unit|freon|chiller`, "AC / pendingin",
	`\baki\b|battery|baterai|\baccu\b`, "Aki / baterai",
	`kompas|radar|\bradio\b|\bgps\b|echo ?sounder|navigasi|navtex|epirb`, "Navigasi / komunikasi",
	// Safety and outfitting.
	`sekoci|life ?boat|rescue boat|life ?raft|\brakit\b|perahu|\bspeed ?boat\b`, "Sekoci / perahu",
	`pelampung|life ?buoy|life ?jacket`, "Alat keselamatan",
	`\bapar\b|fire extinguisher|fire ?hose|sprinkler|alarm`, "Pemadam / alarm",
	`kursi|\bmeja\b|sofa|kasur|tempat tidur|furni`, "Perabot",
	// Buildings and facilities.
	`dinding|tembok|\bbata\b|partisi`, "Dinding",
	`plafon|plapon|ceiling`, "Plafon",
	`glass? ?wool|rock ?wool|isolasi|insulasi|insulation`, "Insulasi",
	`\blis\b`, "List / lis",
	`\batap\b|genteng|spandek|galvalum|galpalum|talang|kanopi|canopy`, "Atap / kanopi",
	`jendela|\bkaca\b|porthole`, "Jendela / kaca",
	`pagar`, "Pagar",
	`toilet|kloset|closet|wastafel|kamar mandi|\bwc\b|urinoir|shower`, "Sanitasi",
	`\bgot\b|drainase|selokan|parit`, "Got / saluran",
	`kolam`, "Kolam",
	`beton|semen|paving|aspal`, "Beton / paving",
	`pimsol|plimsol|draft mark|merkah|water ?line|nama kapal|marking`, "Marka (draft / plimsol / nama)",
	`ducting|\bduct\b`, "Ducting",
	`\bkayu\b|triplek|plywood|multiplek`, "Kayu",
	`\bplug\b|sumbat`, "Plug / sumbat",
	`fitting`, "Fitting pipa",
	// Materials.
	`roundbar|round bar|besi as\b|besi beton`, "Roundbar / besi as",
	`hollow`, "Besi hollow",
	`\bunp\b|\bcnp\b|\bwf\b|i-?beam|h-?beam`, "Profil baja",
	`\bbox\b|kotak|\bpeti\b`, "Box / kotak",
	`turun dock|naik dock|\bkapal\b`, "Kapal (layanan umum)",
)

// weakObjects are what is cleaned out, poured or used up rather than the thing
// worked on: only when nothing else is named ("Cleaning lumpur tanki 1" is tank
// cleaning, "Pengecatan anti fouling plat bottom" is painting the bottom).
var weakObjects = rules(
	`lumpur|sludge|kerak|endapan|sampah|limbah`, "Lumpur / limbah",
	`\boli\b|pelumas|grease|gemuk`, "Oli / pelumas",
	`\bbbm\b|\bsolar\b|bahan bakar|\bfuel\b`, "BBM",
	`\bcat\b|\bprimer\b|thinner|epoxy|anti ?fouling`, "Cat / coating",
	`\bair\b|\bminyak\b`, "Air / minyak",
	`\bpasir\b`, "Pasir",
)

// Piping words the general lists do not have.
var pipingActions = rules(
	`\bbending\b|tekuk`, "Bending",
	`wra[bp]+ing|wrapping|bungkus`, "Wrapping / cover",
	`^cover\b`, "Wrapping / cover",
	`\bstel\b|setel|setting`, "Setel",
	`kalibrasi|calibrat`, "Kalibrasi",
	`flushing|flasing|flusing`, "Flushing",
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
	`\btangga\b`, "Tangga",
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
	// Machinery and fittings whose parts are often given in plate sizes
	// ("Plat rumah kampas rem ..., uk. 1200 mm x 90 mm x 10 mm").
	"Rumah kampas rem": true, "Kampas rem": true, "Tromol": true, "Windlass / winch": true, "Stopper": true,
	"Dewi-dewi (davit)": true, "Crane / hoist": true, "Manhole": true, "Pengunci": true, "Dudukan": true,
	"Gear": true, "Bearing / bushing": true, "Seal": true, "Kopling": true, "Lampu": true, "Motor listrik": true,
	"Panel / saklar": true, "Kabel": true, "Blower / fan": true, "Cooler / radiator": true, "Filter": true,
	"Sanitasi": true, "Plafon": true, "Insulasi": true, "Atap / kanopi": true, "Pagar": true, "Tiang / mast": true,
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
	matchLastResort     = newEarlyMatcher(lastResortActions)
	matchObjects        = newEarlyMatcher(objects)
	matchWeakObjects    = newEarlyMatcher(weakObjects)
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
	noVerbAction  = "Pekerjaan"
	labourAction  = "Lembur (tenaga harian)"
	standbyAction = "Standby / pengawalan"
	labourObject  = "Tenaga kerja"
)

var reCalcPrefix = regexp.MustCompile(`^perhitungan\s+`)

// reLineBreak ends the title of a description: SIAGA labels name the work on
// their first line and list details (other parts, materials) below it.
var reLineBreak = regexp.MustCompile(`(?i)<br\s*/?>|\n`)

// Parse reads one work item description.
func Parse(label string) Result {
	text := Clean(label)
	low := strings.ToLower(text)
	title := low
	if parts := reLineBreak.Split(label, 2); len(parts) == 2 {
		title = strings.ToLower(Clean(parts[0]))
	}
	if r, ok := parseCost(low, title); ok {
		return r
	}
	// "Perhitungan fabrikasi pondasi ..." is the cost of that work: read the
	// work, not the word "perhitungan" (which stays a last resort).
	if m := reCalcPrefix.FindStringIndex(title); m != nil && matchActions.find(title[m[1]:]) != "" {
		low, title = low[m[1]:], title[m[1]:]
	}
	if plateThickness(low) != "" || hullTrigger.MatchString(low) {
		return parseHull(low, title)
	}
	return parseGeneral(low, title)
}

// findTitleFirst matches the title first and the whole text only when the
// title names nothing: "Kampas rem rampdoor, 1 unit <br>- ganti baut" is
// brake lining work, not bolt work.
func findTitleFirst(m *earlyMatcher, title, low string) string {
	if v := m.find(title); v != "" {
		return v
	}
	if title == low {
		return ""
	}
	return m.find(low)
}

// ------------------------------------------------- payments, fees, services

// Lines that are not a piece of work priced per unit: payment stages of a
// whole project, docking bills, freight, rentals, tests and fees. They get a
// work type of their own (RulesCost) so they neither stay unrecognized nor
// get compared with unit prices.
var (
	reDockingBill = regexp.MustCompile(`biaya docking|jasa docking|docking repair|final biaya|biaya (turun|naik) dock`)
	rePayment     = regexp.MustCompile(`\btermin\b|\bterm\s+(?:[ivx]+|\d+)\b|\bdp\b|down payment|pelunasan|\bprogres+\b|\bprogress\b|\bpembayaran\b|\bpayment\b|negosiasi`)
	reStageBill   = regexp.MustCompile(`\btahap\b.*\b(biaya|bayar|docking|repair)|\b(biaya|bayar|docking|repair)\b.*\btahap\b`)
	reFreight     = regexp.MustCompile(`ocean freight|\bfreight\b|pengiriman|ekspedisi|ongkos kirim|transportasi|\btransport\b|mobilisasi|demobilisasi|mob demob|mob-demob|breakbulk|trucking|angkutan`)
	reRental      = regexp.MustCompile(`\bsewa\b|\brental\b|penyewaan|pemakaian (forklift|crane|truk|truck|kompresor|genset)`)
	reTest        = regexp.MustCompile(`ultrasonic|\but\b|thickness|megger|penetrant|\bmpi\b|magnetic particle|function test|load test|running test|runing test|sea ?trial|uji coba|pengujian|\bndt\b|x-?ray|radiograph|clearen?ce|\buji\b`)
	reShorePower  = regexp.MustCompile(`supply listrik|shore (power|connection|supply)|layanan shore|pemakaian listrik|listrik darat|(connect|konek).*listrik`)
	rePortService = regexp.MustCompile(`pelayanan|layanan|\bpandu\b|kapal tunda|\bfogging\b|catering|konsumsi`)
	reFee         = regexp.MustCompile(`opnam|opname|\bfee\b|consumable|retribusi|asuransi|insurance|administrasi|surveyor|\bsurvey\b|sertifikat|certificate|\bklas\b|\bbki\b|\bppn\b|pajak|discount|\bdiskon\b|operasional|fumigasi|keamanan|^biaya\b`)
)

// RulesCost marks payments, fees, freight, rentals and tests.
const RulesCost = "biaya"

// Cost lines that are never a unit price (whole-project or whole-docking
// amounts and fees); rentals and tests are, per day or per test.
var CostWithoutUnitPrice = map[string]bool{
	"Pembayaran termin / progres": true, "Biaya docking": true, "Pengiriman / transport": true, "Biaya / jasa": true,
}

var rentalTools = rules(
	`crane`, "Crane",
	`forklift`, "Forklift",
	`truck|truk|trailer|dump`, "Truk / trailer",
	`excavator|beko`, "Excavator",
	`kompresor|compressor`, "Kompresor",
	`genset|generator`, "Genset",
	`ponton|pontoon|tongkang|barge`, "Ponton / tongkang",
	`tug ?boat|kapal tunda|\btb\b`, "Kapal tunda",
	`peranca[hk]|scaffold`, "Perancah",
	`manlift|man lift|boom lift|scissor`, "Manlift",
	`mobil|kendaraan|\bbus\b`, "Kendaraan",
)

var testKinds = rules(
	`ultrasonic|\but\b|thickness`, "Ketebalan (UT)",
	`megger|tahanan isolasi`, "Isolasi listrik (megger)",
	`penetrant|\bmpi\b|magnetic particle|\bndt\b|x-?ray|radiograph`, "NDT las",
	`clearen?ce`, "Clearance",
	`sea ?trial|uji coba|function test|load test|running test|runing test|\buji\b|pengujian`, "Uji fungsi / beban",
)

var serviceKinds = rules(
	`\bpandu\b`, "Pandu",
	`tunda`, "Kapal tunda",
	`fogging`, "Fogging",
	`catering|konsumsi`, "Konsumsi",
	`docking|undocking`, "Layanan docking",
)

var feeKinds = rules(
	`opnam|opname`, "Opname",
	`consumable`, "Consumable",
	`surveyor|\bsurvey\b|sertifikat|certificate|\bklas\b|\bbki\b`, "Survey / sertifikasi",
	`asuransi|insurance`, "Asuransi",
	`\bppn\b|pajak`, "Pajak",
	`discount|\bdiskon\b`, "Diskon",
	`operasional`, "Biaya operasional",
	`fumigasi`, "Fumigasi",
)

func parseCost(low, title string) (Result, bool) {
	if reLabour.MatchString(low) {
		return Result{}, false
	}
	var action, obj string
	switch {
	case reDockingBill.MatchString(low) || ((rePayment.MatchString(low) || reStageBill.MatchString(low)) && strings.Contains(low, "docking")):
		action, obj = "Biaya docking", "Kapal"
	case rePayment.MatchString(low) || reStageBill.MatchString(low):
		action, obj = "Pembayaran termin / progres", "Paket pekerjaan"
	case reFreight.MatchString(title) || (title != low && reFreight.MatchString(low) && matchActions.find(title) == ""):
		action, obj = "Pengiriman / transport", "Barang / material"
	case reShorePower.MatchString(low):
		action, obj = "Biaya / jasa", "Listrik darat (shore power)"
	case reRental.MatchString(low):
		action, obj = "Sewa alat", first(rentalTools, low)
		if obj == "" {
			obj = "Alat (lain)"
		}
	case reTest.MatchString(title) && matchActions.find(title) == "":
		action, obj = "Pengujian / pengukuran", first(testKinds, title)
	case rePortService.MatchString(title) && matchActions.find(title) == "":
		action, obj = "Biaya / jasa", first(serviceKinds, title)
		if obj == "" {
			obj = "Layanan lain"
		}
	case reFee.MatchString(title) && matchActions.find(title) == "":
		action, obj = "Biaya / jasa", first(feeKinds, title)
		if obj == "" {
			obj = "Biaya lain"
		}
	default:
		return Result{}, false
	}
	return Result{Rules: RulesCost, Action: action, Object: obj, Qty: parseQty(low), Source: first(sources, low),
		WorkType: joinWords(action, strings.ToLower(obj)), Recognized: true}, true
}

// Area work with no part named ("Sandblasting lambung, 1.200 m2" names one,
// "Sweepblasting, luasan 350 m2" doesn't) is work on a surface, priced per m2.
var (
	surfaceActions = map[string]bool{"Sandblasting": true, "Pengecatan": true, "Pembersihan": true, "Plester / cor": true}
	reArea         = regexp.MustCompile(`\bm2\b|m²|\bluas|meter persegi`)
)

const surfaceObject = "Permukaan (per m2)"

func parseGeneral(low, title string) Result {
	action := findTitleFirst(matchActions, title, low)
	if action == "" {
		action = findTitleFirst(matchLastResort, title, low)
	}
	obj := findTitleFirst(matchObjects, title, low)
	// "U-bolt" also matches the bolt pattern at the same spot; keep U-bolt.
	if obj == "Mur & baut" && reUBolt.MatchString(low) {
		obj = "U-bolt"
	}
	// "cover pipa": cover is the work here, the pipe is the object.
	if action == "Wrapping / cover" && obj == "Cover" {
		obj = findTitleFirst(matchObjectsNoCover, title, low)
	}
	if obj == "" && surfaceActions[action] && reArea.MatchString(low) {
		obj = surfaceObject
	}
	if obj == "" {
		obj = findTitleFirst(matchWeakObjects, title, low)
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
		action = findTitleFirst(matchPipingActions, title, low)
	}
	if obj == "" || obj == "Cover" {
		if o := findTitleFirst(matchPipingObjects, title, low); o != "" {
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

	// An object with no verb anywhere ("pipa seamless sch. 40, Dia. 2"...") is
	// still work on that object, as "Pekerjaan plat (tanpa kata kerja)" is in
	// hull work.
	if action == "" && obj != "" && obj != labourObject {
		action = noVerbAction
		recognized = true
		work = joinWords(action, strings.ToLower(obj))
		if (obj == "Packing" || obj == "Mur & baut") && material != "" {
			work = joinWords(work, material)
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

func parseHull(low, title string) Result {
	action := findTitleFirst(matchHullActions, title, low)
	if action == "" {
		action = findTitleFirst(matchHullLastResort, title, low)
	}
	obj := findTitleFirst(matchHullObjects, title, low)
	if obj == "" {
		obj = findTitleFirst(matchGenericPlate, title, low)
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
