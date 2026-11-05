package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// anthropicSession talks to the Claude Messages API over plain HTTP (no SDK:
// the SDK made the Docker build too heavy for the server VM). The
// assistant's full content (thinking and tool_use blocks) goes back
// unchanged within an answer.
type anthropicSession struct {
	cfg      aiProviderConfig
	client   *http.Client
	request  map[string]interface{}
	messages []interface{}
}

const (
	anthropicDefaultBaseURL = "https://api.anthropic.com"
	anthropicVersion        = "2026-10-21"
	// A policy decline is re-run on a fallback model chosen by the API.
	anthropicFallbackBeta = "server-side-fallback-2026-07-01"
)

// anthropicTools converts tools to Messages API tool definitions.
func anthropicTools(tools []aiTool) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(tools))
	for _, t := range tools {
		schema := map[string]interface{}{"type": "object", "properties": t.Schema["properties"], "additionalProperties": false}
		if required, ok := t.Schema["required"].([]string); ok && len(required) > 0 {
			schema["required"] = required
		}
		out = append(out, map[string]interface{}{"name": t.Name, "description": t.Description, "input_schema": schema})
	}
	return out
}

func newAnthropicSession(cfg aiProviderConfig, stable, volatile string, history []aiChatMessage, tools []aiTool) *anthropicSession {
	if cfg.BaseURL == "" {
		cfg.BaseURL = anthropicDefaultBaseURL
	}
	cfg.BaseURL = strings.TrimSuffix(strings.TrimRight(cfg.BaseURL, "/"), "/v1")
	s := &anthropicSession{cfg: cfg, client: &http.Client{Timeout: 120 * time.Second}}
	for _, m := range history {
		s.messages = append(s.messages, map[string]interface{}{
			"role": m.Role, "content": []map[string]interface{}{{"type": "text", "text": m.Content}},
		})
	}
	maxTokens := 16000
	if cfg.MaxTokens > 0 {
		maxTokens = cfg.MaxTokens
	}
	s.request = map[string]interface{}{
		"model":      cfg.Model,
		"max_tokens": maxTokens,
		// The stable part is cached; the date comes after the breakpoint.
		"system": []map[string]interface{}{
			{"type": "text", "text": stable, "cache_control": map[string]string{"type": "ephemeral"}},
			{"type": "text", "text": volatile},
		},
		"output_config": map[string]string{"effort": "medium"},
		"fallbacks":     "default",
	}
	if len(tools) > 0 {
		s.request["tools"] = anthropicTools(tools)
	}
	return s
}

type anthropicResponse struct {
	Content    []json.RawMessage `json:"content"`
	StopReason string            `json:"stop_reason"`
	Usage      struct {
		InputTokens          int64 `json:"input_tokens"`
		OutputTokens         int64 `json:"output_tokens"`
		CacheReadInputTokens int64 `json:"cache_read_input_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (s *anthropicSession) Next(ctx context.Context, results []aiCallResult) (aiTurn, error) {
	if len(results) > 0 {
		// All tool results of one turn go back in one user message.
		blocks := make([]map[string]interface{}, 0, len(results))
		for _, res := range results {
			blocks = append(blocks, map[string]interface{}{
				"type": "tool_result", "tool_use_id": res.ID, "content": res.Content, "is_error": res.IsError,
			})
		}
		s.messages = append(s.messages, map[string]interface{}{"role": "user", "content": blocks})
	}
	s.request["messages"] = s.messages
	payload, _ := json.Marshal(s.request)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.BaseURL+"/v1/messages?beta=true", bytes.NewReader(payload))
	if err != nil {
		return aiTurn{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", s.cfg.APIKey)
	req.Header.Set("anthropic-version", anthropicVersion)
	req.Header.Set("anthropic-beta", anthropicFallbackBeta)
	resp, err := s.client.Do(req)
	if err != nil {
		return aiTurn{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	var out anthropicResponse
	json.Unmarshal(raw, &out)
	if resp.StatusCode != http.StatusOK {
		msg := strings.TrimSpace(string(raw))
		if out.Error != nil {
			msg = out.Error.Message
		}
		if len(msg) > 300 {
			msg = msg[:300]
		}
		err := fmt.Errorf("Anthropic HTTP %d: %s", resp.StatusCode, msg)
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == 529 {
			return aiTurn{}, aiRateLimitError{err}
		}
		return aiTurn{}, err
	}

	s.messages = append(s.messages, map[string]interface{}{"role": "assistant", "content": out.Content})
	turn := aiTurn{StopReason: out.StopReason, Usage: aiUsage{
		InputTokens: out.Usage.InputTokens, OutputTokens: out.Usage.OutputTokens, CacheReadTokens: out.Usage.CacheReadInputTokens,
	}}
	var text []string
	for _, block := range out.Content {
		var b struct {
			Type  string          `json:"type"`
			Text  string          `json:"text"`
			ID    string          `json:"id"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
		}
		if json.Unmarshal(block, &b) != nil {
			continue
		}
		switch b.Type {
		case "text":
			text = append(text, b.Text)
		case "tool_use":
			input := b.Input
			if len(input) == 0 {
				input = json.RawMessage(`{}`)
			}
			turn.Calls = append(turn.Calls, aiPendingCall{ID: b.ID, Name: b.Name, Input: input})
		}
	}
	turn.Text = strings.TrimSpace(strings.Join(text, "\n\n"))
	turn.Refused = out.StopReason == "refusal"
	turn.Done = out.StopReason != "tool_use" || len(turn.Calls) == 0
	return turn, nil
}
