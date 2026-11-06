package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"shipyard/db"
)

func resetIngest(t *testing.T) {
	t.Helper()
	for _, table := range []string{"ingest_sources", "external_records", "attendance_punches"} {
		if _, err := db.Exec("DELETE FROM " + table); err != nil {
			t.Fatalf("clear %s: %v", table, err)
		}
	}
}

// ingestCall runs a request through the same routes as main.go (without the
// Admin guard, which is middleware) and decodes the JSON answer.
func ingestCall(t *testing.T, method, path, token, body string) (int, map[string]any) {
	t.Helper()
	r := chi.NewRouter()
	r.Post("/api/ingest/{source}", PostIngest)
	r.Get("/api/ingest-sources", GetIngestSources)
	r.Post("/api/ingest-sources", CreateIngestSource)
	r.Put("/api/ingest-sources/{id}", UpdateIngestSource)
	r.Post("/api/ingest-sources/{id}/rotate-token", RotateIngestSourceToken)

	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	var out map[string]any
	json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func createIngestSource(t *testing.T, body string) (id, token string) {
	t.Helper()
	code, out := ingestCall(t, "POST", "/api/ingest-sources", "", body)
	if code != http.StatusCreated {
		t.Fatalf("create %s: %d %v", body, code, out)
	}
	return out["source"].(map[string]any)["id"].(string), out["token"].(string)
}

func TestIngestSourceAdmin(t *testing.T) {
	resetIngest(t)
	id, token := createIngestSource(t, `{"name": "Absensi Fingerprint", "kind": "attendance", "key_column": "diabaikan"}`)
	if id != "absensi-fingerprint" || !strings.HasPrefix(token, "shs_") || len(token) != 52 {
		t.Fatalf("id %q token %q", id, token)
	}

	// Only the hash is stored; the list shows the last 4 characters, never the token.
	var hash, keyCol string
	db.QueryRow("SELECT token_hash, COALESCE(key_column, '') FROM ingest_sources WHERE id = ?", id).Scan(&hash, &keyCol)
	if hash == token || hash != hashIngestToken(token) || keyCol != "" {
		t.Errorf("stored hash %q key_column %q", hash, keyCol)
	}
	code, out := ingestCall(t, "GET", "/api/ingest-sources", "", "")
	raw, _ := json.Marshal(out)
	list := out["data"].([]any)
	if code != 200 || len(list) != 1 || strings.Contains(string(raw), token) || strings.Contains(string(raw), hash) ||
		list[0].(map[string]any)["token_hint"] != token[len(token)-4:] || len(out["kinds"].([]any)) != len(ingestKindOrder) {
		t.Errorf("list: %d %s", code, raw)
	}

	for body, want := range map[string]int{
		`{"name": "Absensi Fingerprint", "kind": "attendance"}`:                                  http.StatusConflict,   // same id
		`{"name": "Vendor", "kind": "records"}`:                                                  http.StatusBadRequest, // no key column
		`{"name": "Vendor", "kind": "lain"}`:                                                     http.StatusBadRequest,
		`{"name": "", "kind": "attendance"}`:                                                     http.StatusBadRequest,
		`{"id": "Pakai Spasi", "name": "X", "kind": "attendance"}`:                               http.StatusBadRequest,
		`{"id": "vendor-detail", "name": "Vendor", "kind": "records", "key_column": "emp_code"}`: http.StatusCreated,
		// A long name still gives a valid id (cut to 50 characters).
		`{"name": "Absensi Fingerprint Galangan Absensi Fingerprint Galangan", "kind": "attendance"}`: http.StatusCreated,
	} {
		if code, out := ingestCall(t, "POST", "/api/ingest-sources", "", body); code != want {
			t.Errorf("create %s: want %d, got %d %v", body, want, code, out)
		}
	}

	if code, _ := ingestCall(t, "PUT", "/api/ingest-sources/tidak-ada", "", `{"name": "X"}`); code != 404 {
		t.Errorf("update unknown: %d", code)
	}
	code, out = ingestCall(t, "PUT", "/api/ingest-sources/"+id, "", `{"name": "Absensi Galangan", "kind": "records"}`)
	src := out["source"].(map[string]any)
	if code != 200 || src["name"] != "Absensi Galangan" || src["kind"] != "attendance" {
		t.Errorf("update keeps kind: %d %v", code, out)
	}
}

func TestIngestAuth(t *testing.T) {
	resetIngest(t)
	id, token := createIngestSource(t, `{"name": "Absensi", "kind": "attendance"}`)
	_, other := createIngestSource(t, `{"name": "Lain", "kind": "attendance"}`)
	path := "/api/ingest/" + id
	empty := `{"rows": []}`

	for name, tok := range map[string]string{"no token": "", "wrong token": "shs_salah", "other source's token": other} {
		if code, _ := ingestCall(t, "POST", path, tok, empty); code != 401 {
			t.Errorf("%s: want 401, got %d", name, code)
		}
	}
	if code, _ := ingestCall(t, "POST", "/api/ingest/tidak-ada", token, empty); code != 401 {
		t.Errorf("unknown source: want 401, got %d", code)
	}
	if code, out := ingestCall(t, "POST", path, token, empty); code != 200 {
		t.Fatalf("right token: %d %v", code, out)
	}

	ingestCall(t, "PUT", "/api/ingest-sources/"+id, "", `{"is_active": false}`)
	if code, _ := ingestCall(t, "POST", path, token, empty); code != 401 {
		t.Errorf("inactive source: want 401, got %d", code)
	}
	ingestCall(t, "PUT", "/api/ingest-sources/"+id, "", `{"is_active": true}`)

	_, out := ingestCall(t, "POST", "/api/ingest-sources/"+id+"/rotate-token", "", "")
	fresh := out["token"].(string)
	if code, _ := ingestCall(t, "POST", path, token, empty); code != 401 {
		t.Errorf("old token after rotate: want 401, got %d", code)
	}
	if code, _ := ingestCall(t, "POST", path, fresh, empty); code != 200 {
		t.Errorf("new token after rotate: want 200, got %d", code)
	}

	if code, _ := ingestCall(t, "POST", path, fresh, `{"rows": [`); code != 400 {
		t.Errorf("broken JSON: want 400, got %d", code)
	}
	rows := make([]string, ingestMaxRows+1)
	for i := range rows {
		rows[i] = "{}"
	}
	if code, _ := ingestCall(t, "POST", path, fresh, `{"rows": [`+strings.Join(rows, ",")+`]}`); code != 413 {
		t.Errorf("too many rows: want 413, got %d", code)
	}
}

func TestIngestAttendance(t *testing.T) {
	resetIngest(t)
	id, token := createIngestSource(t, `{"name": "Absensi", "kind": "attendance"}`)
	path := "/api/ingest/" + id

	body := `{"rows":[
		{"id": 101, "emp_code": "E1", "first_name": "Budi", "last_name": "S", "Kepala Subkon": "Pak A", "nama_pt": "PT Las", "punch_time": "2026-11-02 07:55:00"},
		{"id": "102", "emp_code": "E1", "punch_time": "2026-11-02T17:10:30", "nama_pt": "PT Las"},
		{"id": 103, "emp_code": "E2", "date": "2026-11-02", "time": "08:01:00"},
		{"id": 104, "emp_code": "", "punch_time": "2026-11-02 08:00:00"},
		{"id": 105, "emp_code": "E3", "punch_time": "kemarin"}
	]}`
	code, out := ingestCall(t, "POST", path, token, body)
	if code != 200 || out["saved"].(float64) != 3 || out["skipped"].(float64) != 2 || len(out["problems"].([]any)) != 2 {
		t.Fatalf("first send: %d %v", code, out)
	}

	var subkon, at string
	db.QueryRow("SELECT kepala_subkon FROM attendance_punches WHERE id = '101'").Scan(&subkon)
	db.QueryRow("SELECT punch_time FROM attendance_punches WHERE id = '102'").Scan(&at)
	if subkon != "Pak A" || at != "2026-11-02 17:10:30" {
		t.Errorf("kepala_subkon %q, punch_time %q", subkon, at)
	}

	// Resending identical rows changes nothing.
	if _, out = ingestCall(t, "POST", path, token, body); out["saved"].(float64) != 0 || out["unchanged"].(float64) != 3 {
		t.Errorf("identical resend: %v", out)
	}
	// The same id with new content updates the row instead of duplicating it.
	_, out = ingestCall(t, "POST", path, token, `{"rows":[{"id": 101, "emp_code": "E1", "nama_pt": "PT Las Baru", "punch_time": "2026-11-02 07:55:00"}]}`)
	var n int
	var pt string
	db.QueryRow("SELECT COUNT(*) FROM attendance_punches").Scan(&n)
	db.QueryRow("SELECT nama_pt FROM attendance_punches WHERE id = '101'").Scan(&pt)
	if out["saved"].(float64) != 1 || n != 3 || pt != "PT Las Baru" {
		t.Errorf("changed resend: %v, %d rows, nama_pt %q", out, n, pt)
	}

	// Another machine may reuse the same transaction ids.
	id2, token2 := createIngestSource(t, `{"name": "Absensi Gudang", "kind": "attendance"}`)
	ingestCall(t, "POST", "/api/ingest/"+id2, token2, `{"rows":[{"id": 101, "emp_code": "G1", "punch_time": "2026-11-02 07:00:00"}]}`)
	db.QueryRow("SELECT COUNT(*) FROM attendance_punches").Scan(&n)
	if n != 4 {
		t.Errorf("same id from two sources: %d rows", n)
	}

	_, out = ingestCall(t, "GET", "/api/ingest-sources", "", "")
	for _, s := range out["data"].([]any) {
		src := s.(map[string]any)
		if src["id"] == id {
			last := src["last_result"].(map[string]any)
			if src["rows"].(float64) != 3 || src["last_received_at"] == "" || last["ok"] != true || last["saved"].(float64) != 1 || last["problems"] != nil {
				t.Errorf("source status: %v", src)
			}
		}
	}
}

func TestIngestRecords(t *testing.T) {
	resetIngest(t)
	id, token := createIngestSource(t, `{"name": "Vendor Detail", "kind": "records", "key_column": "Emp Code"}`)
	path := "/api/ingest/" + id

	code, out := ingestCall(t, "POST", path, token, `{"rows":[
		{"emp_code": 7, "kepala_subkon": "Pak A", "nama_pt": "PT Las"},
		{"emp_code": "E8", "kepala_subkon": "Pak B"},
		{"emp_code": "", "kepala_subkon": "Tanpa kode"}
	]}`)
	if code != 200 || out["saved"].(float64) != 2 || out["skipped"].(float64) != 1 {
		t.Fatalf("records: %d %v", code, out)
	}
	var data string
	db.QueryRow("SELECT data FROM external_records WHERE source_id = ? AND record_key = '7'", id).Scan(&data)
	if !strings.Contains(data, `"nama_pt":"PT Las"`) {
		t.Errorf("stored data %q", data)
	}

	_, out = ingestCall(t, "POST", path, token, `{"rows":[{"emp_code": 7, "kepala_subkon": "Pak A", "nama_pt": "PT Las"}, {"emp_code": "E8", "kepala_subkon": "Pak C"}]}`)
	if out["saved"].(float64) != 1 || out["unchanged"].(float64) != 1 {
		t.Errorf("resend: %v", out)
	}
}
