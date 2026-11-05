package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"shipyard/db"
	"shipyard/middleware"
)

// Ingest: external systems (Apps Script, other apps) push rows to
// POST /api/ingest/{source} with their own token. Admins create sources and
// tokens in Sumber Data Eksternal; only a SHA-256 hash of each token is kept,
// so a token is shown once, when it is created or rotated.

const (
	ingestMaxRows     = 5000
	ingestMaxBody     = 20 << 20
	ingestTokenPrefix = "shs_"
	ingestMaxProblems = 10
)

var ingestIDPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$`)

type ingestResult struct {
	Received  int      `json:"received"`
	Saved     int      `json:"saved"`     // new or changed
	Unchanged int      `json:"unchanged"` // already stored as sent
	Skipped   int      `json:"skipped"`   // unreadable rows, see problems
	Problems  []string `json:"problems"`
}

func (r *ingestResult) problem(msg string) {
	if len(r.Problems) < ingestMaxProblems {
		r.Problems = append(r.Problems, msg)
	}
}

// ingestKinds: how each kind of source stores its rows. needsKey: the source
// must name the column that identifies a row.
var ingestKinds = map[string]struct {
	label    string
	needsKey bool
	store    func(src ingestSourceAuth, rows []map[string]any) (ingestResult, error)
}{
	"attendance": {"Absensi (fingerprint)", false, func(src ingestSourceAuth, rows []map[string]any) (ingestResult, error) {
		return ingestAttendance(src.ID, rows)
	}},
	"records": {"Data umum", true, func(src ingestSourceAuth, rows []map[string]any) (ingestResult, error) {
		return ingestRecords(src.ID, src.KeyColumn, rows)
	}},
}

func hashIngestToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func newIngestToken() (token, hash, hint string, err error) {
	buf := make([]byte, 24)
	if _, err = rand.Read(buf); err != nil {
		return
	}
	token = ingestTokenPrefix + hex.EncodeToString(buf)
	return token, hashIngestToken(token), token[len(token)-4:], nil
}

type ingestSourceAuth struct {
	ID, Kind, KeyColumn, TokenHash string
	Active                         bool
}

func loadIngestSourceAuth(id string) (ingestSourceAuth, error) {
	var s ingestSourceAuth
	var active int
	err := db.QueryRow(`SELECT id, kind, COALESCE(key_column, ''), token_hash, COALESCE(is_active, 1)
		FROM ingest_sources WHERE id = ?`, id).Scan(&s.ID, &s.Kind, &s.KeyColumn, &s.TokenHash, &active)
	s.Active = active == 1
	return s, err
}

// PostIngest receives rows from an external source. No user session: the
// source's own token in "Authorization: Bearer <token>" is the credential.
func PostIngest(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	src, err := loadIngestSourceAuth(chi.URLParam(r, "source"))
	// One answer for unknown source, wrong token and inactive source, so the
	// endpoint does not reveal which sources exist.
	if err != nil || token == "" || !src.Active ||
		subtle.ConstantTimeCompare([]byte(hashIngestToken(token)), []byte(src.TokenHash)) != 1 {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "sumber atau token tidak valid, atau sumber dinonaktifkan"})
		return
	}
	kind, ok := ingestKinds[src.Kind]
	if !ok {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "jenis sumber tidak dikenal: " + src.Kind})
		return
	}

	var body struct {
		Rows []map[string]any `json:"rows"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, ingestMaxBody)).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body JSON tidak valid: " + err.Error()})
		return
	}
	if len(body.Rows) > ingestMaxRows {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": fmt.Sprintf("maksimal %d baris per kiriman", ingestMaxRows)})
		return
	}

	res, err := kind.store(src, body.Rows)
	if err != nil {
		recordIngestResult(src.ID, map[string]any{"ok": false, "error": err.Error()})
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gagal menyimpan: " + err.Error()})
		return
	}
	recordIngestResult(src.ID, map[string]any{"ok": true, "received": res.Received, "saved": res.Saved,
		"unchanged": res.Unchanged, "skipped": res.Skipped, "problems": res.Problems})
	writeJSON(w, http.StatusOK, res)
}

func recordIngestResult(id string, result map[string]any) {
	b, _ := json.Marshal(result)
	db.Exec("UPDATE ingest_sources SET last_received_at = ?, last_result = ? WHERE id = ?", time.Now().Format(time.RFC3339), string(b), id)
}

// ingestRecords stores rows of a "records" source as JSON, one per value of
// the source's key column.
func ingestRecords(sourceID, keyColumn string, rows []map[string]any) (ingestResult, error) {
	res := ingestResult{Received: len(rows)}
	key := columnName(keyColumn)
	type record struct{ key, data string }
	var records []record
	for i, row := range rows {
		k := cellString(normalizeRow(row)[key])
		if k == "" {
			res.problem(fmt.Sprintf("baris %d: kolom %s kosong", i+1, keyColumn))
			continue
		}
		data, _ := json.Marshal(row)
		records = append(records, record{k, string(data)})
	}
	if len(records) == 0 {
		res.Skipped = len(rows)
		return res, nil
	}

	tx, err := db.DB.Begin()
	if err != nil {
		return res, err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(db.FormatQuery(`INSERT INTO external_records (source_id, record_key, data, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (source_id, record_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
		WHERE external_records.data IS DISTINCT FROM excluded.data`))
	if err != nil {
		return res, err
	}
	defer stmt.Close()
	now := time.Now().Format(time.RFC3339)
	for _, rec := range records {
		r, err := stmt.Exec(sourceID, rec.key, rec.data, now)
		if err != nil {
			return res, err
		}
		if n, _ := r.RowsAffected(); n > 0 {
			res.Saved++
		}
	}
	res.Unchanged = len(records) - res.Saved
	res.Skipped = len(rows) - len(records)
	return res, tx.Commit()
}

// --- Admin: Sumber Data Eksternal ---

type ingestSourceView struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	Kind           string          `json:"kind"`
	KindLabel      string          `json:"kind_label"`
	KeyColumn      string          `json:"key_column"`
	TokenHint      string          `json:"token_hint"`
	IsActive       bool            `json:"is_active"`
	CreatedBy      string          `json:"created_by"`
	CreatedAt      string          `json:"created_at"`
	TokenRotatedAt string          `json:"token_rotated_at"`
	LastReceivedAt string          `json:"last_received_at"`
	LastResult     json.RawMessage `json:"last_result"`
	Rows           int             `json:"rows"`
}

func ingestRowCounts() map[string]int {
	counts := map[string]int{}
	for _, q := range []string{
		"SELECT source_id, COUNT(*) FROM attendance_punches GROUP BY source_id",
		"SELECT source_id, COUNT(*) FROM external_records GROUP BY source_id",
	} {
		rows, err := db.Query(q)
		if err != nil {
			continue
		}
		for rows.Next() {
			var id string
			var n int
			if rows.Scan(&id, &n) == nil {
				counts[id] += n
			}
		}
		rows.Close()
	}
	return counts
}

func listIngestSources(where string, args ...any) ([]ingestSourceView, error) {
	rows, err := db.Query(`SELECT id, name, kind, COALESCE(key_column, ''), COALESCE(token_hint, ''), COALESCE(is_active, 1),
		COALESCE(created_by, ''), COALESCE(created_at, ''), COALESCE(token_rotated_at, ''),
		COALESCE(last_received_at, ''), COALESCE(last_result, '')
		FROM ingest_sources`+where+` ORDER BY name`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := ingestRowCounts()
	out := []ingestSourceView{}
	for rows.Next() {
		var s ingestSourceView
		var active int
		var last string
		if err := rows.Scan(&s.ID, &s.Name, &s.Kind, &s.KeyColumn, &s.TokenHint, &active,
			&s.CreatedBy, &s.CreatedAt, &s.TokenRotatedAt, &s.LastReceivedAt, &last); err != nil {
			return nil, err
		}
		s.IsActive = active == 1
		s.KindLabel = ingestKinds[s.Kind].label
		if last != "" {
			s.LastResult = json.RawMessage(last)
		}
		s.Rows = counts[s.ID]
		out = append(out, s)
	}
	return out, rows.Err()
}

func getIngestSource(id string) (ingestSourceView, error) {
	list, err := listIngestSources(" WHERE id = ?", id)
	if err != nil {
		return ingestSourceView{}, err
	}
	if len(list) == 0 {
		return ingestSourceView{}, sql.ErrNoRows
	}
	return list[0], nil
}

// GetIngestSources lists sources (never their tokens) and the kinds available.
func GetIngestSources(w http.ResponseWriter, r *http.Request) {
	list, err := listIngestSources("")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	kinds := []map[string]any{}
	for _, k := range []string{"attendance", "records"} {
		kinds = append(kinds, map[string]any{"value": k, "label": ingestKinds[k].label, "needs_key": ingestKinds[k].needsKey})
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": list, "kinds": kinds})
}

// slugifyIngestID turns "Absensi Fingerprint" into "absensi-fingerprint".
func slugifyIngestID(name string) string {
	var b strings.Builder
	dash := false
	for _, c := range strings.ToLower(name) {
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			b.WriteRune(c)
			dash = false
		} else if !dash && b.Len() > 0 {
			b.WriteByte('-')
			dash = true
		}
	}
	s := b.String()
	if len(s) > 50 {
		s = s[:50]
	}
	return strings.Trim(s, "-")
}

type ingestSourceInput struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	KeyColumn string `json:"key_column"`
	IsActive  *bool  `json:"is_active"`
}

func validateIngestInput(in *ingestSourceInput) error {
	in.Name = strings.TrimSpace(in.Name)
	in.KeyColumn = strings.TrimSpace(in.KeyColumn)
	if in.Name == "" {
		return errors.New("nama sumber wajib diisi")
	}
	kind, ok := ingestKinds[in.Kind]
	if !ok {
		return errors.New("jenis sumber tidak dikenal")
	}
	if kind.needsKey && columnName(in.KeyColumn) == "" {
		return errors.New("kolom kunci wajib diisi untuk jenis ini")
	}
	if !kind.needsKey {
		in.KeyColumn = ""
	}
	return nil
}

func ingestActor(r *http.Request) string {
	if c, ok := middleware.GetUserClaims(r); ok {
		if c.Name != "" {
			return c.Name
		}
		return c.Email
	}
	return ""
}

// CreateIngestSource adds a source and returns its token, the only time the
// token is ever shown.
func CreateIngestSource(w http.ResponseWriter, r *http.Request) {
	var in ingestSourceInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body JSON tidak valid"})
		return
	}
	if err := validateIngestInput(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	id := strings.TrimSpace(in.ID)
	if id == "" {
		id = slugifyIngestID(in.Name)
	}
	if !ingestIDPattern.MatchString(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "ID hanya huruf kecil, angka dan tanda minus, 3-50 karakter"})
		return
	}
	var exists int
	db.QueryRow("SELECT COUNT(*) FROM ingest_sources WHERE id = ?", id).Scan(&exists)
	if exists > 0 {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "ID " + id + " sudah dipakai sumber lain"})
		return
	}

	token, hash, hint, err := newIngestToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gagal membuat token"})
		return
	}
	now := time.Now().Format(time.RFC3339)
	if _, err := db.Exec(`INSERT INTO ingest_sources (id, name, kind, key_column, token_hash, token_hint, is_active, created_by, created_at, token_rotated_at)
		VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`, id, in.Name, in.Kind, in.KeyColumn, hash, hint, ingestActor(r), now, now); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	src, _ := getIngestSource(id)
	writeJSON(w, http.StatusCreated, map[string]any{"source": src, "token": token})
}

// UpdateIngestSource changes the name, key column or active flag. The kind
// is fixed: rows already stored belong to it.
func UpdateIngestSource(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	cur, err := getIngestSource(id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "sumber tidak ditemukan"})
		return
	}
	in := ingestSourceInput{Name: cur.Name, Kind: cur.Kind, KeyColumn: cur.KeyColumn}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "body JSON tidak valid"})
		return
	}
	in.Kind = cur.Kind
	if err := validateIngestInput(&in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	active := cur.IsActive
	if in.IsActive != nil {
		active = *in.IsActive
	}
	activeInt := 0
	if active {
		activeInt = 1
	}
	if _, err := db.Exec("UPDATE ingest_sources SET name = ?, key_column = ?, is_active = ? WHERE id = ?",
		in.Name, in.KeyColumn, activeInt, id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	src, _ := getIngestSource(id)
	writeJSON(w, http.StatusOK, map[string]any{"source": src})
}

// RotateIngestSourceToken replaces the token; the old one stops working at once.
func RotateIngestSourceToken(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if _, err := getIngestSource(id); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "sumber tidak ditemukan"})
		return
	}
	token, hash, hint, err := newIngestToken()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "gagal membuat token"})
		return
	}
	if _, err := db.Exec("UPDATE ingest_sources SET token_hash = ?, token_hint = ?, token_rotated_at = ? WHERE id = ?",
		hash, hint, time.Now().Format(time.RFC3339), id); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	src, _ := getIngestSource(id)
	writeJSON(w, http.StatusOK, map[string]any{"source": src, "token": token})
}

// RequireAdminWith lets only Admins through (role read from profiles, like
// RequireAdmin) and answers others with msg.
func RequireAdminWith(msg string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !isAdminRequest(r) {
				writeJSON(w, http.StatusForbidden, map[string]string{"error": msg})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
