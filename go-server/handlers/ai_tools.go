package handlers

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"

	"shipyard/itemparse"
)

// The AI tool layer: read-only tools a future Claude chat can call to answer
// questions about ShipHub data. Each tool is a Claude tool definition (name,
// description, input_schema) plus a Go function, and is tied to the RBAC
// resource of the page its data comes from, so the assistant can only show a
// user what that user may open anyway. Tools answer through the same handlers
// as the pages (aiCall), so a number in a chat answer is the number on screen.

// aiGlossary is the domain vocabulary for the assistant's system prompt.
//
//go:embed ai/glossary.md
var aiGlossary string

// aiTool is one tool: its Claude definition, the resource a user needs view
// rights on, and the function that runs it on validated input.
type aiTool struct {
	Name        string
	Description string
	Schema      map[string]interface{}
	Resource    string
	// Available, when set, replaces the view check on Resource (a tool over
	// several pages' data checks each page itself).
	Available func(r *http.Request) bool
	// Run decodes and validates input (an error is shown to the model as a
	// tool error it can correct) and returns a JSON-serialisable result.
	Run func(r *http.Request, input json.RawMessage) (interface{}, error)
}

// aiToolDefinition is the tool as the Messages API takes it.
type aiToolDefinition struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"input_schema"`
}

func (t aiTool) definition() aiToolDefinition {
	return aiToolDefinition{Name: t.Name, Description: t.Description, InputSchema: t.Schema}
}

// aiInputError is a problem with the model's input, returned to it as an
// is_error tool result so it can call again with corrected arguments.
type aiInputError struct{ msg string }

func (e aiInputError) Error() string { return e.msg }

func inputErrorf(format string, args ...interface{}) error {
	return aiInputError{fmt.Sprintf(format, args...)}
}

// decodeAIInput decodes input strictly: unknown fields are an error the model
// can read, not something silently ignored.
func decodeAIInput(input json.RawMessage, dst interface{}) error {
	if len(bytes.TrimSpace(input)) == 0 {
		input = json.RawMessage("{}")
	}
	dec := json.NewDecoder(bytes.NewReader(input))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return inputErrorf("input tidak valid: %v", err)
	}
	return nil
}

// aiSchema builds an object schema; required lists the mandatory properties.
func aiSchema(properties map[string]interface{}, required ...string) map[string]interface{} {
	if required == nil {
		required = []string{}
	}
	return map[string]interface{}{"type": "object", "properties": properties, "required": required, "additionalProperties": false}
}

func aiString(description string, enum ...string) map[string]interface{} {
	p := map[string]interface{}{"type": "string", "description": description}
	if len(enum) > 0 {
		p["enum"] = enum
	}
	return p
}

func aiInteger(description string, min, max int) map[string]interface{} {
	return map[string]interface{}{"type": "integer", "description": description, "minimum": min, "maximum": max}
}

func oneOf(field, value string, allowed ...string) error {
	if value == "" {
		return nil
	}
	for _, a := range allowed {
		if value == a {
			return nil
		}
	}
	return inputErrorf("%s harus salah satu dari: %s", field, strings.Join(allowed, ", "))
}

func limitOr(limit, def, max int) int {
	if limit <= 0 {
		return def
	}
	if limit > max {
		return max
	}
	return limit
}

// aiCall runs one of the page handlers in-process with the given query and
// decodes its JSON answer. The caller has already checked the user's rights
// on the tool's resource (the handlers' own middleware is not involved).
func aiCall(handler http.HandlerFunc, r *http.Request, path string, q url.Values) (map[string]interface{}, error) {
	req := httptest.NewRequest(http.MethodGet, path+"?"+q.Encode(), nil).WithContext(r.Context())
	rec := httptest.NewRecorder()
	handler(rec, req)
	var out map[string]interface{}
	if rec.Code == http.StatusNotFound {
		return nil, inputErrorf("data tidak ditemukan")
	}
	if rec.Code != http.StatusOK {
		return nil, fmt.Errorf("%s: HTTP %d %s", path, rec.Code, strings.TrimSpace(rec.Body.String()))
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		return nil, fmt.Errorf("%s: %v", path, err)
	}
	return out, nil
}

// cleanForModel strips HTML from descriptions and drops fields the model has
// no use for, so tool results stay small and readable.
func cleanForModel(v interface{}) interface{} {
	switch x := v.(type) {
	case map[string]interface{}:
		for k, val := range x {
			switch k {
			case "unit_keys", "item_id", "path", "activity_path":
				delete(x, k)
				continue
			case "label", "detail", "activity", "activity_name":
				if s, ok := val.(string); ok {
					x[k] = itemparse.Clean(s)
					continue
				}
			}
			x[k] = cleanForModel(val)
		}
		return x
	case []interface{}:
		for i := range x {
			x[i] = cleanForModel(x[i])
		}
		return x
	}
	return v
}

// availableAITools are the tools the request's user may use.
// allowed reports whether the user may use the tool.
func (t aiTool) allowed(r *http.Request) bool {
	if t.Available != nil {
		return t.Available(r)
	}
	return HasResourcePermission(r, t.Resource, "view")
}

func availableAITools(r *http.Request) []aiTool {
	var out []aiTool
	for _, t := range aiTools() {
		if t.allowed(r) {
			out = append(out, t)
		}
	}
	return out
}

// GetAITools returns the user's tools as Claude tool definitions, with the
// glossary for the system prompt.
func GetAITools(w http.ResponseWriter, r *http.Request) {
	defs := []aiToolDefinition{}
	for _, t := range availableAITools(r) {
		defs = append(defs, t.definition())
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"tools": defs, "glossary": aiGlossary})
}

// RunAITool runs one tool on a JSON input body, as the chat backend will:
// {"result": ...} on success, {"error": ..., "is_error": true} otherwise
// (status 200 for input errors, which the model is meant to read and fix).
func RunAITool(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	w.Header().Set("Content-Type", "application/json")
	var tool *aiTool
	for _, t := range aiTools() {
		if t.Name == name {
			t := t
			tool = &t
			break
		}
	}
	if tool == nil {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "alat tidak dikenal: " + name, "is_error": true})
		return
	}
	if !tool.allowed(r) {
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "Anda tidak punya akses view untuk menu " + tool.Resource, "is_error": true})
		return
	}
	var input json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil && err.Error() != "EOF" {
		json.NewEncoder(w).Encode(map[string]interface{}{"error": "body harus JSON", "is_error": true})
		return
	}
	result, err := tool.Run(r, input)
	if err != nil {
		if _, ok := err.(aiInputError); !ok {
			w.WriteHeader(http.StatusInternalServerError)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error(), "is_error": true})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"result": cleanForModel(result)})
}
