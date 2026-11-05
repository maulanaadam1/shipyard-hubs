package handlers

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"shipyard/db"
	"shipyard/middleware"
)

var reToolName = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

// Every tool is a valid Claude tool definition with descriptions the model
// can choose by, and is tied to an RBAC resource.
func TestAIToolDefinitions(t *testing.T) {
	seen := map[string]bool{}
	for _, tool := range aiTools() {
		if !reToolName.MatchString(tool.Name) || seen[tool.Name] {
			t.Errorf("bad or duplicate name %q", tool.Name)
		}
		seen[tool.Name] = true
		if len(tool.Description) < 120 || !strings.Contains(tool.Description, "Call this when") {
			t.Errorf("%s: description should say when to call it", tool.Name)
		}
		if (tool.Resource == "" && tool.Available == nil) || tool.Run == nil {
			t.Errorf("%s: missing resource or run", tool.Name)
		}
		s := tool.Schema
		if s["type"] != "object" || s["additionalProperties"] != false {
			t.Errorf("%s: schema must be a closed object", tool.Name)
		}
		props, _ := s["properties"].(map[string]interface{})
		for name, p := range props {
			if d, _ := p.(map[string]interface{})["description"].(string); d == "" {
				t.Errorf("%s.%s: no description", tool.Name, name)
			}
		}
		for _, req := range s["required"].([]string) {
			if props[req] == nil {
				t.Errorf("%s: required %q is not a property", tool.Name, req)
			}
		}
	}
	if !strings.Contains(aiGlossary, "Harga acuan") || len(aiGlossary) < 2000 {
		t.Error("glossary not embedded")
	}
}

func seedAIData(t *testing.T) {
	t.Helper()
	resetWorkOrderTables(t)
	if err := ProcessWorkOrderList([]byte(`{"data": [{"id": 410, "code": "WO-410", "m_ship_name": "Kapal B", "m_vendor_name": "Vendor A", "min_approval_level": 5, "updated_at": "2026-10-05 09:00:00"}]}`)); err != nil {
		t.Fatal(err)
	}
	db.Exec("INSERT INTO work_order_details (wo_id, raw_json) VALUES (?, ?)", "410", workTypeDetail)
	if err := RebuildWorkOrderDerived(); err != nil {
		t.Fatal(err)
	}
}

// The eval questions name existing tools, and their example inputs pass the
// tools' validation (only "not found" is acceptable on the small test data).
func TestAIEvalQuestions(t *testing.T) {
	seedAIData(t)
	raw, err := os.ReadFile("ai/eval_questions.json")
	if err != nil {
		t.Fatal(err)
	}
	var questions []struct {
		ID, Question, Expect string
		Tools                []string
		Input                json.RawMessage
	}
	if err := json.Unmarshal(raw, &questions); err != nil {
		t.Fatal(err)
	}
	if len(questions) < 30 {
		t.Errorf("only %d eval questions", len(questions))
	}
	tools := map[string]aiTool{}
	for _, tool := range aiTools() {
		tools[tool.Name] = tool
	}
	// As an Admin: some sources (MasterOperation) check the user's rights.
	db.Exec("DELETE FROM profiles WHERE id = 'ai-eval-admin'")
	db.Exec(`INSERT INTO profiles (id, email, username, name, role) VALUES ('ai-eval-admin', 'ai-eval-admin@example.test', 'aievaladmin', 'Eval Admin', 'Admin')`)
	defer db.Exec("DELETE FROM profiles WHERE id = 'ai-eval-admin'")
	req := httptest.NewRequest("POST", "/", nil).WithContext(asUser("ai-eval-admin"))
	for _, q := range questions {
		if q.Question == "" || q.Expect == "" || len(q.Tools) == 0 {
			t.Errorf("%s: incomplete", q.ID)
			continue
		}
		for _, name := range q.Tools {
			if _, ok := tools[name]; !ok {
				t.Errorf("%s: unknown tool %s", q.ID, name)
			}
		}
		if _, err := tools[q.Tools[0]].Run(req, q.Input); err != nil && !strings.Contains(err.Error(), "tidak ditemukan") {
			t.Errorf("%s: %s(%s): %v", q.ID, q.Tools[0], q.Input, err)
		}
	}
}

func asUser(id string) context.Context {
	return context.WithValue(context.Background(), middleware.UserClaimsKey, middleware.UserClaims{ID: id, Email: id + "@example.test"})
}

func TestAIToolsEndpoints(t *testing.T) {
	seedAIData(t)
	db.Exec("DELETE FROM profiles WHERE id IN ('ai-admin', 'ai-nobody')")
	db.Exec(`INSERT INTO profiles (id, email, username, name, role) VALUES ('ai-admin', 'ai-admin@example.test', 'aiadmin', 'AI Admin', 'Admin')`)
	db.Exec(`INSERT INTO profiles (id, email, username, name, role, roles) VALUES ('ai-nobody', 'ai-nobody@example.test', 'ainobody', 'No Rights', 'Staff', '')`)
	defer db.Exec("DELETE FROM profiles WHERE id IN ('ai-admin', 'ai-nobody')")

	router := chi.NewRouter()
	router.Get("/api/ai/tools", GetAITools)
	router.Post("/api/ai/tools/{name}", RunAITool)
	call := func(user, method, path, body string) (int, map[string]interface{}) {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(method, path, strings.NewReader(body)).WithContext(asUser(user))
		router.ServeHTTP(rec, req)
		var out map[string]interface{}
		json.Unmarshal(rec.Body.Bytes(), &out)
		return rec.Code, out
	}

	if _, out := call("ai-admin", "GET", "/api/ai/tools", ""); len(out["tools"].([]interface{})) != len(aiTools()) {
		t.Errorf("admin tools: %v", out["tools"])
	}
	if _, out := call("ai-nobody", "GET", "/api/ai/tools", ""); len(out["tools"].([]interface{})) != 0 {
		t.Errorf("a user without rights got tools: %v", out["tools"])
	}
	if code, _ := call("ai-nobody", "POST", "/api/ai/tools/search_work_orders", `{}`); code != 403 {
		t.Errorf("no rights: %d", code)
	}

	code, out := call("ai-admin", "POST", "/api/ai/tools/search_work_items", `{"group_by": "work_type", "sort": "count"}`)
	res, _ := out["result"].(map[string]interface{})
	if code != 200 || res["total_groups"].(float64) != 2 {
		t.Fatalf("work item groups: %d %v", code, out)
	}
	code, out = call("ai-admin", "POST", "/api/ai/tools/get_work_order", `{"wo_code": "wo-410"}`)
	res, _ = out["result"].(map[string]interface{})
	if code != 200 || res["vendor"] != "Vendor A" || !strings.HasSuffix(res["siaga_url"].(string), "/410") || len(res["top_items"].([]interface{})) != 3 {
		t.Errorf("get_work_order: %d %v", code, out)
	}
	// Input errors come back for the model to correct, with status 200.
	code, out = call("ai-admin", "POST", "/api/ai/tools/search_work_orders", `{"status": "Selesai"}`)
	if code != 200 || out["is_error"] != true || !strings.Contains(out["error"].(string), "Approval Level 5") {
		t.Errorf("bad enum: %d %v", code, out)
	}
	code, out = call("ai-admin", "POST", "/api/ai/tools/search_work_orders", `{"kapal": "B"}`)
	if code != 200 || out["is_error"] != true {
		t.Errorf("unknown field: %d %v", code, out)
	}
	if code, _ := call("ai-admin", "POST", "/api/ai/tools/drop_tables", `{}`); code != 404 {
		t.Errorf("unknown tool: %d", code)
	}
}
