package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"shipyard/db"
)

func TestNameScore(t *testing.T) {
	name := func(s string) aiName { n := soundKey(s); return aiName{Name: s, norm: n, words: strings.Fields(n)} }
	cases := []struct {
		term, name string
		min        float64
	}{
		{"baracuda", "KP BARAKUDA 01", 0.99}, // c/k sound alike
		{"barakda", "KP BARAKUDA 01", 0.85},  // a letter missing
		{"samudera 12", "TB SAMUDRA 12", 0.85},
		{"graving", "Graving Dock", 0.9},
	}
	for _, c := range cases {
		if s := nameScore(c.term, name(c.name)); s < c.min {
			t.Errorf("%q vs %q = %.2f, want >= %.2f", c.term, c.name, s, c.min)
		}
	}
	if s := nameScore("tongkang", name("KP BARAKUDA 01")); s >= 0.7 {
		t.Errorf("unrelated word scored %.2f", s)
	}
}

func TestSplitChoices(t *testing.T) {
	answer, choices := splitChoices("Kantor yang mana?\n\nPILIHAN: Kantor Pusat | Kantor Slipway | Kantor Gudang")
	if answer != "Kantor yang mana?" || len(choices) != 3 || choices[1] != "Kantor Slipway" {
		t.Errorf("got %q %v", answer, choices)
	}
	if _, none := splitChoices("Jawaban biasa.\nLANJUT: a | b"); len(none) != 0 {
		t.Errorf("choices from a plain answer: %v", none)
	}
}

func TestAITermsAndResolve(t *testing.T) {
	db.Exec("DELETE FROM ai_glossary")
	db.Exec("DELETE FROM projects WHERE id IN ('rs-1', 'rs-2')")
	db.Exec("DELETE FROM master_locations WHERE id IN ('rs-l1', 'rs-l2')")
	t.Cleanup(func() {
		db.Exec("DELETE FROM ai_glossary")
		db.Exec("DELETE FROM projects WHERE id IN ('rs-1', 'rs-2')")
		db.Exec("DELETE FROM master_locations WHERE id IN ('rs-l1', 'rs-l2')")
		db.Exec("DELETE FROM profiles WHERE id = 'rs-admin'")
		aiNamesCache.Lock()
		aiNamesCache.names = nil
		aiNamesCache.Unlock()
	})
	db.Exec(`INSERT INTO projects (id, id_siaga, idproject, shipname) VALUES ('rs-1', 9001, 'DRT26TEST01', 'KP BARAKUDA 01'), ('rs-2', 9002, 'DRT26TEST02', 'TB SAMUDRA 12')`)
	db.Exec(`INSERT INTO master_locations (id, name) VALUES ('rs-l1', 'Kantor Pusat'), ('rs-l2', 'Kantor Proyek Slipway')`)
	db.Exec("DELETE FROM profiles WHERE id = 'rs-admin'")
	db.Exec(`INSERT INTO profiles (id, email, username, name, role) VALUES ('rs-admin', 'rs-admin@example.test', 'rsadmin', 'Admin', 'Admin')`)
	aiNamesCache.Lock()
	aiNamesCache.names = nil
	aiNamesCache.Unlock()
	invalidateAITerms()

	// Filled from the data the first time: ship type words, offices.
	prompt := aiTermsPrompt()
	if !strings.Contains(prompt, `"tongkang"`) || !strings.Contains(prompt, "tipe kapal Barge") || !strings.Contains(prompt, "Kantor Proyek Slipway, Kantor Pusat") {
		t.Errorf("glossary prompt:\n%s", prompt)
	}

	// The tool corrects a misspelled ship and explains a vague word.
	out, err := aiResolveNamesTool().Run(aiRequest("rs-admin"), json.RawMessage(`{"terms": ["baracuda", "kantor"]}`))
	if err != nil {
		t.Fatal(err)
	}
	results := out.(map[string]interface{})["results"].([]map[string]interface{})
	ship := results[0]["candidates"].([]aiNameMatch)
	if len(ship) == 0 || ship[0].Name != "KP BARAKUDA 01" || ship[0].Score < 0.99 {
		t.Errorf("baracuda: %v", ship)
	}
	if g, ok := results[1]["glossary"].([]map[string]string); !ok || len(g) == 0 || !strings.Contains(g[0]["meaning"], "Kantor Pusat") {
		t.Errorf("kantor: %v", results[1])
	}

	// A search that found nothing gets did_you_mean.
	res := map[string]interface{}{"total": 0, "job_orders": []interface{}{}}
	aiDidYouMean(aiRequest("rs-admin"), "repair_list", json.RawMessage(`{"query": "baracuda"}`), res)
	if dym, ok := res["did_you_mean"].([]aiNameMatch); !ok || dym[0].Name != "KP BARAKUDA 01" {
		t.Errorf("did_you_mean: %v", res)
	}

	// Kamus Istilah API: a manual term replaces the auto one and survives a refill.
	router := chi.NewRouter()
	router.Get("/api/ai/terms", GetAITerms)
	router.Post("/api/ai/terms", PostAITerm)
	router.Post("/api/ai/terms/autofill", PostAITermsAutofill)
	router.Put("/api/ai/terms/{id}", PutAITerm)
	router.Delete("/api/ai/terms/{id}", DeleteAITerm)
	call := func(method, path, body string) map[string]interface{} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)).WithContext(asUser("rs-admin")))
		var m map[string]interface{}
		json.Unmarshal(rec.Body.Bytes(), &m)
		return m
	}
	created := call("POST", "/api/ai/terms", `{"term": "kantor", "meaning": "Kantor Pusat (gedung utama)", "kind": "lokasi"}`)
	if created["source"] != "manual" {
		t.Fatalf("create: %v", created)
	}
	call("POST", "/api/ai/terms/autofill", "")
	var kantor []string
	for _, x := range call("GET", "/api/ai/terms", "")["terms"].([]interface{}) {
		if m := x.(map[string]interface{}); m["term"] == "kantor" {
			kantor = append(kantor, m["meaning"].(string)+"|"+m["source"].(string))
		}
	}
	if len(kantor) != 1 || kantor[0] != "Kantor Pusat (gedung utama)|manual" {
		t.Errorf("kantor after refill: %v", kantor)
	}
	if bad := call("POST", "/api/ai/terms", `{"term": "x", "meaning": ""}`); bad["error"] == nil {
		t.Errorf("short term accepted: %v", bad)
	}
	call("PUT", "/api/ai/terms/"+created["id"].(string), `{"term": "kantor", "meaning": "Kantor Pusat", "kind": "lokasi"}`)
	if !strings.Contains(aiTermsPrompt(), `"kantor": Kantor Pusat`) {
		t.Errorf("edited term not in prompt:\n%s", aiTermsPrompt())
	}
	call("DELETE", "/api/ai/terms/"+created["id"].(string), "")
	if strings.Contains(aiTermsPrompt(), `"kantor": Kantor Pusat`+"\n") {
		t.Error("deleted term still in prompt")
	}
}
