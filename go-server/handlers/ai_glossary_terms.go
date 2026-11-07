package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"shipyard/db"
	"shipyard/middleware"
)

// Kamus Istilah (Pengaturan AI): the words people at the yard use and what
// they mean in ShipHub's data ("tongkang" = ship type Barge, "kantor" = the
// locations named so). The AI Assistant reads it with every question.
// "auto" rows are filled from the data (ship types, Job Order types and code
// prefixes, locations) and can be filled again; "manual" rows are the
// Admin's own and are never overwritten.

type aiTerm struct {
	ID        string `json:"id"`
	Term      string `json:"term"`
	Meaning   string `json:"meaning"`
	Kind      string `json:"kind"`   // kapal, jenis_jo, kode_jo, lokasi, umum
	Source    string `json:"source"` // auto | manual
	UpdatedBy string `json:"updated_by"`
	UpdatedAt string `json:"updated_at"`
}

// Everyday words for data values, used when the value exists in the data.
var shipTypeWords = map[string][]string{
	"barge":     {"tongkang", "ponton"},
	"tug":       {"kapal tunda", "tunda", "TB", "tugboat"},
	"tanker":    {"kapal tanker", "tangker", "kapal minyak"},
	"lct":       {"landing craft", "kapal pendarat"},
	"spob":      {"tongkang minyak", "self propelled oil barge"},
	"cargo":     {"kapal kargo", "kapal barang"},
	"container": {"kapal kontainer", "kapal peti kemas"},
	"ferry":     {"kapal penyeberangan", "KMP"},
	"fishing":   {"kapal ikan"},
	"patrol":    {"kapal patroli"},
	"crew":      {"crew boat", "kapal crew"},
	"rbb":       {"rigid buoyant boat"},
}

var serviceWords = map[string][]string{
	"docking repair":     {"docking", "naik dock", "reparasi docking"},
	"floating repair":    {"floating", "perbaikan apung"},
	"new building":       {"bangunan baru", "kapal baru", "newbuilding", "NB"},
	"fasilitas galangan": {"fasilitas", "proyek fasilitas"},
	"internal":           {"proyek internal"},
	"emergency repair":   {"emergency", "perbaikan darurat"},
	"running repair":     {"running repair", "perbaikan berjalan"},
}

var aiTermsCache struct {
	sync.Mutex
	prompt string
	at     time.Time
}

func invalidateAITerms() {
	aiTermsCache.Lock()
	aiTermsCache.at = time.Time{}
	aiTermsCache.Unlock()
}

// autofillAITerms replaces the "auto" rows with terms built from the data.
// Manual rows stay; an auto term that has a manual row is skipped.
func autofillAITerms() (int, error) {
	manual := map[string]bool{}
	if rows, err := db.Query(`SELECT LOWER(term) FROM ai_glossary WHERE source = 'manual'`); err == nil {
		for rows.Next() {
			var t string
			if rows.Scan(&t) == nil {
				manual[t] = true
			}
		}
		rows.Close()
	}
	type entry struct{ term, meaning, kind string }
	var out []entry
	seen := map[string]bool{}
	add := func(term, meaning, kind string) {
		key := strings.ToLower(strings.TrimSpace(term))
		if key == "" || manual[key] || seen[key] {
			return
		}
		seen[key] = true
		out = append(out, entry{strings.TrimSpace(term), meaning, kind})
	}
	list := func(q string) []string {
		var vals []string
		rows, err := db.Query(q)
		if err != nil {
			return nil
		}
		defer rows.Close()
		for rows.Next() {
			var v string
			if rows.Scan(&v) == nil && strings.TrimSpace(v) != "" {
				vals = append(vals, strings.TrimSpace(v))
			}
		}
		return vals
	}

	// Ship types: the dropdown, Master Kapal and MasterOperation's ships.
	types := map[string]bool{}
	for _, q := range []string{
		`SELECT DISTINCT COALESCE(label, '') FROM dropdown_configs WHERE category = 'ship_types'`,
		`SELECT DISTINCT COALESCE(type, '') FROM ships`,
	} {
		for _, v := range list(q) {
			types[v] = true
		}
	}
	for t := range types {
		low := strings.ToLower(t)
		for key, words := range shipTypeWords {
			if strings.Contains(low, key) {
				for _, w := range words {
					add(w, "tipe kapal "+t, "kapal")
				}
			}
		}
	}

	// Job Order types (Master Service) and their everyday words.
	services := list(`SELECT DISTINCT COALESCE(name, '') FROM master_services`)
	for _, s := range services {
		if words, ok := serviceWords[strings.ToLower(s)]; ok {
			for _, w := range words {
				add(w, "Job Order jenis "+s, "jenis_jo")
			}
		}
	}
	// Job Order code prefixes that mostly mean one type ("DR..." = Docking Repair).
	if rows, err := db.Query(`SELECT UPPER(SUBSTR(COALESCE(p.idproject, ''), 1, 2)), COALESCE(ms.name, ''), COUNT(*)
		FROM projects p LEFT JOIN master_services ms ON CAST(ms.id AS TEXT) = p.docking_type
		WHERE COALESCE(p.idproject, '') <> '' GROUP BY 1, 2`); err == nil {
		byPrefix := map[string]map[string]int{}
		for rows.Next() {
			var prefix, service string
			var n int
			if rows.Scan(&prefix, &service, &n) == nil && service != "" {
				if byPrefix[prefix] == nil {
					byPrefix[prefix] = map[string]int{}
				}
				byPrefix[prefix][service] += n
			}
		}
		rows.Close()
		for prefix, m := range byPrefix {
			total, best, bestN := 0, "", 0
			for s, n := range m {
				total += n
				if n > bestN {
					best, bestN = s, n
				}
			}
			if total >= 3 && bestN*10 >= total*7 {
				add("kode JO "+prefix, fmt.Sprintf("Job Order berawalan %s umumnya %s", prefix, best), "kode_jo")
			}
		}
	}

	// Locations: "kantor" and names that share a first word ("slipway").
	locations := list(`SELECT DISTINCT COALESCE(name, '') FROM master_locations`)
	if rows, err := loadWorkPermits(); err == nil {
		for _, p := range rows {
			locations = append(locations, p.Area)
		}
	}
	// One spelling per place ("SLIPWAY E" and "Slipway E" are the same).
	set := map[string]bool{}
	unique := locations[:0]
	for _, l := range locations {
		if key := strings.ToLower(strings.TrimSpace(l)); key != "" && !set[key] {
			set[key] = true
			unique = append(unique, strings.TrimSpace(l))
		}
	}
	locations = unique
	sort.Strings(locations)
	var offices []string
	byWord := map[string][]string{}
	for _, l := range locations {
		low := strings.ToLower(l)
		if strings.Contains(low, "kantor") || strings.Contains(low, "office") {
			offices = append(offices, l)
		}
		if f := strings.Fields(low); len(f) > 1 && len(f[0]) > 3 {
			byWord[f[0]] = append(byWord[f[0]], l)
		}
	}
	if len(offices) > 0 {
		add("kantor", "lokasi "+strings.Join(offices, ", ")+"; bila tidak jelas yang mana, tanyakan", "lokasi")
	} else {
		add("kantor", "tidak ada lokasi bernama kantor di data; tanyakan maksudnya (mis. lokasi, departemen atau vendor)", "lokasi")
	}
	for word, names := range byWord {
		if len(names) >= 2 && len(names) <= 15 {
			add(word, "lokasi "+strings.Join(names, ", ")+"; bila tidak jelas yang mana, tanyakan", "lokasi")
		}
	}

	tx, err := db.DB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(db.FormatQuery(`DELETE FROM ai_glossary WHERE source = 'auto'`)); err != nil {
		return 0, err
	}
	now := time.Now().Format("2006-01-02 15:04:05")
	for _, e := range out {
		if _, err := tx.Exec(db.FormatQuery(`INSERT INTO ai_glossary (id, term, meaning, kind, source, updated_by, updated_at) VALUES (?, ?, ?, ?, 'auto', 'Isi otomatis', ?)`),
			uuid.NewString(), e.term, e.meaning, e.kind, now); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	invalidateAITerms()
	return len(out), nil
}

func loadAITerms() ([]aiTerm, error) {
	rows, err := db.Query(`SELECT id, COALESCE(term, ''), COALESCE(meaning, ''), COALESCE(kind, ''), COALESCE(source, ''),
		COALESCE(updated_by, ''), COALESCE(updated_at, '') FROM ai_glossary ORDER BY kind, LOWER(term)`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []aiTerm{}
	for rows.Next() {
		var t aiTerm
		if rows.Scan(&t.ID, &t.Term, &t.Meaning, &t.Kind, &t.Source, &t.UpdatedBy, &t.UpdatedAt) == nil {
			out = append(out, t)
		}
	}
	return out, rows.Err()
}

// ensureAITerms fills the glossary from the data the first time.
func ensureAITerms() {
	var n int
	if db.QueryRow(`SELECT COUNT(*) FROM ai_glossary`).Scan(&n) == nil && n == 0 {
		autofillAITerms()
	}
}

// aiTermsPrompt is the glossary as the system prompt takes it, terms with the
// same meaning on one line; cached for 5 minutes and after every edit.
func aiTermsPrompt() string {
	aiTermsCache.Lock()
	if !aiTermsCache.at.IsZero() && time.Since(aiTermsCache.at) < 5*time.Minute {
		defer aiTermsCache.Unlock()
		return aiTermsCache.prompt
	}
	aiTermsCache.Unlock()
	ensureAITerms() // fills (and invalidates the cache) the first time
	terms, _ := loadAITerms()
	byMeaning := map[string][]string{}
	var order []string
	for _, t := range terms {
		if _, ok := byMeaning[t.Meaning]; !ok {
			order = append(order, t.Meaning)
		}
		byMeaning[t.Meaning] = append(byMeaning[t.Meaning], `"`+t.Term+`"`)
	}
	var b strings.Builder
	if len(order) > 0 {
		b.WriteString("## Kamus istilah kantor\n\nIstilah yang dipakai pengguna dan artinya di data. Pakai saat menafsirkan pertanyaan dan saat memilih filter; jangan menjelaskan kamus ini ke pengguna.\n\n")
		for i, m := range order {
			if i >= 200 {
				break
			}
			b.WriteString("- " + strings.Join(byMeaning[m], ", ") + ": " + m + "\n")
		}
	}
	aiTermsCache.Lock()
	aiTermsCache.prompt, aiTermsCache.at = b.String(), time.Now()
	aiTermsCache.Unlock()
	return b.String()
}

// --- API (Pengaturan AI) ---

func GetAITerms(w http.ResponseWriter, r *http.Request) {
	ensureAITerms()
	terms, err := loadAITerms()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"terms": terms})
}

func readAITerm(w http.ResponseWriter, r *http.Request) (aiTerm, bool) {
	var in aiTerm
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "data tidak valid"})
		return in, false
	}
	in.Term, in.Meaning, in.Kind = strings.TrimSpace(in.Term), strings.TrimSpace(in.Meaning), strings.TrimSpace(in.Kind)
	if len([]rune(in.Term)) < 2 || len([]rune(in.Term)) > 60 || len([]rune(in.Meaning)) < 2 || len([]rune(in.Meaning)) > 300 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Isi istilah (2-60 huruf) dan artinya (2-300 huruf)."})
		return in, false
	}
	if in.Kind == "" {
		in.Kind = "umum"
	}
	return in, true
}

func PostAITerm(w http.ResponseWriter, r *http.Request) {
	in, ok := readAITerm(w, r)
	if !ok {
		return
	}
	claims, _ := r.Context().Value(middleware.UserClaimsKey).(middleware.UserClaims)
	// A manual term replaces an auto one with the same word.
	db.Exec(`DELETE FROM ai_glossary WHERE LOWER(term) = ? AND source = 'auto'`, strings.ToLower(in.Term))
	in.ID, in.Source, in.UpdatedBy, in.UpdatedAt = uuid.NewString(), "manual", claims.Email, time.Now().Format("2006-01-02 15:04:05")
	if _, err := db.Exec(`INSERT INTO ai_glossary (id, term, meaning, kind, source, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		in.ID, in.Term, in.Meaning, in.Kind, in.Source, in.UpdatedBy, in.UpdatedAt); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	invalidateAITerms()
	writeJSON(w, http.StatusOK, in)
}

// PutAITerm edits a term; an edited auto term becomes manual (kept on refill).
func PutAITerm(w http.ResponseWriter, r *http.Request) {
	in, ok := readAITerm(w, r)
	if !ok {
		return
	}
	claims, _ := r.Context().Value(middleware.UserClaimsKey).(middleware.UserClaims)
	res, err := db.Exec(`UPDATE ai_glossary SET term = ?, meaning = ?, kind = ?, source = 'manual', updated_by = ?, updated_at = ? WHERE id = ?`,
		in.Term, in.Meaning, in.Kind, claims.Email, time.Now().Format("2006-01-02 15:04:05"), chi.URLParam(r, "id"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "istilah tidak ditemukan"})
		return
	}
	invalidateAITerms()
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func DeleteAITerm(w http.ResponseWriter, r *http.Request) {
	db.Exec(`DELETE FROM ai_glossary WHERE id = ?`, chi.URLParam(r, "id"))
	invalidateAITerms()
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func PostAITermsAutofill(w http.ResponseWriter, r *http.Request) {
	n, err := autofillAITerms()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"status": "ok", "auto_terms": n})
}
