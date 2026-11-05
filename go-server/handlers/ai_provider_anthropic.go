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

func (s *anthropicSession) Next(ctx context.Context, results []aiCallResult, onText func(string)) (aiTurn, error) {
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
	stream := onText != nil
	if stream {
		s.request["stream"] = true
	} else {
		delete(s.request, "stream")
	}
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
	var out anthropicResponse
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		json.Unmarshal(raw, &out)
		msg := strings.TrimSpace(string(raw))
		if out.Error != nil {
			msg = out.Error.Message
		}
		return aiTurn{}, anthropicError(resp.StatusCode, msg)
	}
	if stream && strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		if out, err = readAnthropicStream(resp.Body, onText); err != nil {
			return aiTurn{}, err
		}
	} else {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
		json.Unmarshal(raw, &out)
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
	if !stream && onText != nil && turn.Text != "" {
		onText(turn.Text)
	}
	turn.Refused = out.StopReason == "refusal"
	turn.Done = out.StopReason != "tool_use" || len(turn.Calls) == 0
	return turn, nil
}

func anthropicError(status int, msg string) error {
	if len(msg) > 300 {
		msg = msg[:300]
	}
	err := fmt.Errorf("Anthropic HTTP %d: %s", status, msg)
	if status == http.StatusTooManyRequests || status == 529 {
		return aiRateLimitError{err}
	}
	return err
}

// readAnthropicStream rebuilds a Messages API response from its stream,
// passing text to onText as it arrives. Blocks are rebuilt whole (text,
// thinking with its signature, tool_use with its input) so they can be sent
// back unchanged.
func readAnthropicStream(body io.Reader, onText func(string)) (anthropicResponse, error) {
	var out anthropicResponse
	var blocks []map[string]interface{}
	var inputs []strings.Builder
	block := func(i int) map[string]interface{} {
		for len(blocks) <= i {
			blocks = append(blocks, map[string]interface{}{})
			inputs = append(inputs, strings.Builder{})
		}
		return blocks[i]
	}
	appendStr := func(b map[string]interface{}, key, val string) {
		prev, _ := b[key].(string)
		b[key] = prev + val
	}
	err := readSSE(body, func(event, data string) error {
		var ev struct {
			Type    string                 `json:"type"`
			Index   int                    `json:"index"`
			Message *anthropicResponse     `json:"message"`
			Block   map[string]interface{} `json:"content_block"`
			Delta   struct {
				Type        string `json:"type"`
				Text        string `json:"text"`
				Thinking    string `json:"thinking"`
				Signature   string `json:"signature"`
				PartialJSON string `json:"partial_json"`
				StopReason  string `json:"stop_reason"`
			} `json:"delta"`
			Usage *struct {
				OutputTokens int64 `json:"output_tokens"`
			} `json:"usage"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal([]byte(data), &ev) != nil {
			return nil
		}
		switch ev.Type {
		case "error":
			msg := data
			if ev.Error != nil {
				msg = ev.Error.Message
			}
			status := http.StatusBadGateway
			if strings.Contains(strings.ToLower(msg), "overload") {
				status = 529
			}
			return anthropicError(status, msg)
		case "message_start":
			if ev.Message != nil {
				out.Usage = ev.Message.Usage
			}
		case "content_block_start":
			b := block(ev.Index)
			for k, v := range ev.Block {
				b[k] = v
			}
			if b["type"] == "tool_use" {
				delete(b, "input")
			}
		case "content_block_delta":
			b := block(ev.Index)
			switch ev.Delta.Type {
			case "text_delta":
				appendStr(b, "text", ev.Delta.Text)
				if ev.Delta.Text != "" {
					onText(ev.Delta.Text)
				}
			case "thinking_delta":
				appendStr(b, "thinking", ev.Delta.Thinking)
			case "signature_delta":
				appendStr(b, "signature", ev.Delta.Signature)
			case "input_json_delta":
				inputs[ev.Index].WriteString(ev.Delta.PartialJSON)
			}
		case "message_delta":
			if ev.Delta.StopReason != "" {
				out.StopReason = ev.Delta.StopReason
			}
			if ev.Usage != nil {
				out.Usage.OutputTokens = ev.Usage.OutputTokens
			}
		}
		return nil
	})
	if err != nil {
		return out, err
	}
	for i, b := range blocks {
		if b["type"] == "tool_use" {
			input := strings.TrimSpace(inputs[i].String())
			if input == "" {
				input = "{}"
			}
			b["input"] = json.RawMessage(input)
		}
		raw, _ := json.Marshal(b)
		out.Content = append(out.Content, raw)
	}
	return out, nil
}
