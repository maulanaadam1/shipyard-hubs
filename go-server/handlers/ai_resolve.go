package handlers

import (
	"encoding/json"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"

	"shipyard/db"
)

// resolve_names: what a name typed in a question most likely means in the
// data. People spell names as they hear them ("baracuda" for BARAKUDA) or use
// words the data doesn't ("tongkang"); this tool finds the closest ship, Job
// Order, customer, vendor, location, ship type or job type, and the glossary
// meaning of a term, so the assistant can go on without asking the user to
// type again, or ask with choices when several are equally likely.

type aiName struct {
	Name, Kind, Detail string
	norm               string
	words              []string
}

var aiNamesCache struct {
	sync.Mutex
	names []aiName
	at    time.Time
}

// soundKey folds spellings that sound alike in Indonesian: c/k/q, ph/f, oe/u,
// dj/j, tj/c, doubled letters, and drops everything but letters and digits.
func soundKey(s string) string {
	s = strings.ToLower(s)
	for _, p := range [][2]string{{"ph", "f"}, {"oe", "u"}, {"dj", "j"}, {"tj", "c"}, {"ch", "k"}, {"q", "k"}, {"x", "ks"}, {"c", "k"}, {"y", "i"}, {"v", "f"}, {"z", "s"}} {
		s = strings.ReplaceAll(s, p[0], p[1])
	}
	var b strings.Builder
	var last rune
	for _, r := range s {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != ' ' {
			r = ' '
		}
		if r != last || r == ' ' {
			b.WriteRune(r)
		}
		last = r
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func levenshtein(a, b string) int {
	ra, rb := []rune(a), []rune(b)
	prev := make([]int, len(rb)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ra); i++ {
		cur := make([]int, len(rb)+1)
		cur[0] = i
		for j := 1; j <= len(rb); j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			cur[j] = min(prev[j]+1, cur[j-1]+1, prev[j-1]+cost)
		}
		prev = cur
	}
	return prev[len(rb)]
}

func similarity(a, b string) float64 {
	if a == "" || b == "" {
		return 0
	}
	n := len([]rune(a))
	if m := len([]rune(b)); m > n {
		n = m
	}
	return 1 - float64(levenshtein(a, b))/float64(n)
}

// nameScore: how well a typed term matches a name, 0..1. The whole name, a
// run of its words as long as the term, or the name containing the term.
func nameScore(term string, n aiName) float64 {
	t := soundKey(term)
	if t == "" {
		return 0
	}
	if t == n.norm {
		return 1
	}
	best := similarity(t, n.norm)
	tw := len(strings.Fields(t))
	for i := 0; i+tw <= len(n.words); i++ {
		if s := similarity(t, strings.Join(n.words[i:i+tw], " ")); s > best {
			best = s
		}
	}
	if len([]rune(t)) >= 4 && strings.Contains(n.norm, t) && best < 0.9 {
		best = 0.9
	}
	return best
}

// aiNames lists the names the user may see, cached for 10 minutes (the
// permission filter is applied per request).
func aiNames() []aiName {
	aiNamesCache.Lock()
	defer aiNamesCache.Unlock()
	if aiNamesCache.names != nil && time.Since(aiNamesCache.at) < 10*time.Minute {
		return aiNamesCache.names
	}
	var out []aiName
	seen := map[string]bool{}
	add := func(name, kind, detail string) {
		name = strings.TrimSpace(name)
		key := kind + "|" + strings.ToLower(name)
		if len([]rune(name)) < 2 || seen[key] {
			return
		}
		seen[key] = true
		norm := soundKey(name)
		out = append(out, aiName{Name: name, Kind: kind, Detail: detail, norm: norm, words: strings.Fields(norm)})
	}
	queries := []struct{ kind, q string }{
		{"kapal", `SELECT COALESCE(shipname, ''), COALESCE(idproject, '') FROM projects`},
		{"kapal", `SELECT COALESCE(shipname, ''), COALESCE(type, '') FROM ships`},
		{"job_order", `SELECT COALESCE(idproject, ''), COALESCE(shipname, '') FROM projects`},
		{"customer", `SELECT DISTINCT COALESCE(cust_company, ''), '' FROM projects`},
		{"vendor", `SELECT DISTINCT COALESCE(vendor_name, ''), '' FROM work_order_summary`},
		{"vendor", `SELECT COALESCE(vendor, ''), COALESCE(nama_pt, '') FROM vendors`},
		{"perusahaan", `SELECT COALESCE(company_name, ''), COALESCE(company_type, '') FROM companies`},
		{"lokasi", `SELECT COALESCE(name, ''), '' FROM master_locations`},
		{"tipe_kapal", `SELECT DISTINCT COALESCE(label, ''), '' FROM dropdown_configs WHERE category = 'ship_types'`},
		{"jenis_jo", `SELECT COALESCE(name, ''), '' FROM master_services`},
	}
	for _, q := range queries {
		rows, err := db.Query(q.q)
		if err != nil {
			continue
		}
		for rows.Next() {
			var name, detail string
			if rows.Scan(&name, &detail) == nil {
				add(name, q.kind, detail)
			}
		}
		rows.Close()
	}
	if permits, err := loadWorkPermits(); err == nil {
		for _, p := range permits {
			add(p.Area, "lokasi", "area kerja izin kerja")
		}
	}
	aiNamesCache.names, aiNamesCache.at = out, time.Now()
	return out
}

// aiNameKinds: the kinds of names this user may see, by the pages they open.
func aiNameKinds(r *http.Request) map[string]bool {
	can := func(resources ...string) bool {
		for _, res := range resources {
			if HasResourcePermission(r, res, "view") {
				return true
			}
		}
		return false
	}
	jo := can("Job Order", "Work Order", ResourceRepairList)
	return map[string]bool{
		"kapal": jo || can("Master Kapal"), "job_order": jo, "customer": jo || can("Master Company"),
		"vendor": can("Work Order", "Master Vendor"), "perusahaan": can("Master Company"),
		"lokasi": true, "tipe_kapal": true, "jenis_jo": true,
	}
}

type aiNameMatch struct {
	Name   string  `json:"name"`
	Kind   string  `json:"kind"`
	Detail string  `json:"detail,omitempty"`
	Score  float64 `json:"score"`
}

// resolveName returns the closest names (score 0.7 and up), best first.
func resolveName(r *http.Request, term string, limit int) []aiNameMatch {
	kinds := aiNameKinds(r)
	var out []aiNameMatch
	for _, n := range aiNames() {
		if !kinds[n.Kind] {
			continue
		}
		if s := nameScore(term, n); s >= 0.7 {
			out = append(out, aiNameMatch{Name: n.Name, Kind: n.Kind, Detail: n.Detail, Score: float64(int(s*100)) / 100})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		return len(out[i].Name) < len(out[j].Name)
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

// glossaryFor returns the Kamus Istilah meanings of a term.
func glossaryFor(term string) []map[string]string {
	t := strings.ToLower(strings.TrimSpace(term))
	terms, _ := loadAITerms()
	var out []map[string]string
	for _, g := range terms {
		gt := strings.ToLower(g.Term)
		if gt == t || (len(t) >= 4 && (strings.Contains(gt, t) || strings.Contains(t, gt))) || similarity(soundKey(gt), soundKey(t)) >= 0.85 {
			out = append(out, map[string]string{"term": g.Term, "meaning": g.Meaning})
		}
	}
	return out
}

func aiResolveNamesTool() aiTool {
	return aiTool{
		Name: "resolve_names",
		Description: "Finds what a name or word typed by the user means in the data: the closest ships, Job Orders, customers, vendors, " +
			"companies, locations, ship types and Job Order types (spelling-tolerant: \"baracuda\" finds BARAKUDA), and the meaning of an " +
			"office term from the glossary (\"tongkang\", \"kantor\"). Call this when another search found nothing for a name, when a name " +
			"looks misspelled, or when a word is vague. Then: one candidate with score >= 0.85 clearly above the rest: use it and say " +
			"\"Saya anggap maksudnya ...\"; several similar candidates or a vague word with several meanings: don't guess, ask which one " +
			"with the PILIHAN line.",
		Schema: aiSchema(map[string]interface{}{
			"terms": map[string]interface{}{"type": "array", "items": map[string]interface{}{"type": "string"}, "maxItems": 5,
				"description": "The names or words to look up, as the user typed them, e.g. [\"baracuda\", \"kantor\"]."},
		}, "terms"),
		// Only next to a data tool the user may use: names are of no use alone.
		Available: func(r *http.Request) bool {
			for _, t := range aiTools() {
				if t.Name != "resolve_names" && t.allowed(r) {
					return true
				}
			}
			return false
		},
		Run: func(r *http.Request, input json.RawMessage) (interface{}, error) {
			var in struct {
				Terms []string `json:"terms"`
			}
			if err := decodeAIInput(input, &in); err != nil {
				return nil, err
			}
			if len(in.Terms) == 0 {
				return nil, inputErrorf("isi terms dengan kata yang dicari")
			}
			results := []map[string]interface{}{}
			for i, t := range in.Terms {
				if i >= 5 {
					break
				}
				res := map[string]interface{}{"term": t, "candidates": resolveName(r, t, 6)}
				if g := glossaryFor(t); len(g) > 0 {
					res["glossary"] = g
				}
				results = append(results, res)
			}
			return map[string]interface{}{"results": results}, nil
		},
	}
}

const aiChoicePrefix = "PILIHAN:"

// splitChoices takes the choice line ("PILIHAN: a | b | c") of a clarifying
// question off the end of an answer; the app shows them as buttons.
func splitChoices(answer string) (string, []string) {
	choices := []string{}
	lines := strings.Split(strings.TrimRight(answer, " \n"), "\n")
	for i := len(lines) - 1; i >= 0 && i >= len(lines)-3; i-- {
		line := strings.TrimSpace(strings.Trim(strings.TrimSpace(lines[i]), "*_`"))
		if !strings.HasPrefix(strings.ToUpper(line), aiChoicePrefix) {
			continue
		}
		for _, c := range strings.Split(line[len(aiChoicePrefix):], "|") {
			c = strings.Trim(c, " \t\"'<>*_`")
			if c != "" && len([]rune(c)) <= 80 && len(choices) < 6 {
				choices = append(choices, c)
			}
		}
		lines = append(lines[:i], lines[i+1:]...)
		break
	}
	return strings.TrimSpace(strings.Join(lines, "\n")), choices
}

// aiDidYouMean adds the closest names to a tool result that found nothing
// for the name the model searched, so it can correct a typo in one step.
func aiDidYouMean(r *http.Request, tool string, input json.RawMessage, result interface{}) {
	m, ok := result.(map[string]interface{})
	if !ok || tool == "resolve_names" {
		return
	}
	var in map[string]interface{}
	if json.Unmarshal(input, &in) != nil {
		return
	}
	term := ""
	for _, k := range []string{"query", "search", "q", "ship", "vendor", "customer"} {
		if s, _ := in[k].(string); strings.TrimSpace(s) != "" {
			term = s
			break
		}
	}
	if term == "" {
		return
	}
	empty := false
	for _, k := range []string{"total", "matched", "count"} {
		if v, ok := m[k]; ok {
			switch n := v.(type) {
			case int:
				empty = n == 0
			case float64:
				empty = n == 0
			}
			if empty {
				break
			}
		}
	}
	if !empty {
		for _, k := range []string{"work_orders", "job_orders", "items", "rows", "permits", "results"} {
			if v, ok := m[k]; ok {
				if list, ok := v.([]interface{}); ok && len(list) == 0 {
					empty = true
				}
				if list, ok := v.([]map[string]interface{}); ok && len(list) == 0 {
					empty = true
				}
			}
		}
	}
	if !empty {
		return
	}
	if matches := resolveName(r, term, 5); len(matches) > 0 {
		m["did_you_mean"] = matches
	}
}
