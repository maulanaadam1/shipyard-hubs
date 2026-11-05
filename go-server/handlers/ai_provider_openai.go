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

// openAISession talks to any OpenAI-compatible Chat Completions API
// (POST {AI_BASE_URL}/chat/completions with function tools). The assistant
// messages are kept exactly as the provider returned them, so provider
// extras (reasoning fields and the like) go back unchanged.
type openAISession struct {
	cfg      aiProviderConfig
	client   *http.Client
	messages []json.RawMessage
	tools    []map[string]interface{}
}

func newOpenAISession(cfg aiProviderConfig, stable, volatile string, history []aiChatMessage, tools []aiTool) *openAISession {
	s := &openAISession{cfg: cfg, client: &http.Client{Timeout: 120 * time.Second}}
	s.add(map[string]interface{}{"role": "system", "content": stable + "\n\n" + volatile})
	for _, m := range history {
		s.add(map[string]interface{}{"role": m.Role, "content": m.Content})
	}
	for _, t := range tools {
		s.tools = append(s.tools, map[string]interface{}{
			"type":     "function",
			"function": map[string]interface{}{"name": t.Name, "description": t.Description, "parameters": t.Schema},
		})
	}
	return s
}

func (s *openAISession) add(message interface{}) {
	b, _ := json.Marshal(message)
	s.messages = append(s.messages, b)
}

type openAIResponse struct {
	Choices []struct {
		Message      json.RawMessage `json:"message"`
		FinishReason string          `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens        int64 `json:"prompt_tokens"`
		CompletionTokens    int64 `json:"completion_tokens"`
		PromptTokensDetails struct {
			CachedTokens int64 `json:"cached_tokens"`
		} `json:"prompt_tokens_details"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (s *openAISession) Next(ctx context.Context, results []aiCallResult) (aiTurn, error) {
	for _, res := range results {
		content := res.Content
		if res.IsError {
			content = "ERROR: " + content
		}
		s.add(map[string]interface{}{"role": "tool", "tool_call_id": res.ID, "content": content})
	}
	body := map[string]interface{}{"model": s.cfg.Model, "messages": s.messages}
	if len(s.tools) > 0 {
		body["tools"] = s.tools
		body["tool_choice"] = "auto"
	}
	if s.cfg.MaxTokens > 0 {
		body["max_tokens"] = s.cfg.MaxTokens
	}
	payload, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.BaseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return aiTurn{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if s.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+s.cfg.APIKey)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return aiTurn{}, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	var out openAIResponse
	json.Unmarshal(raw, &out)
	if resp.StatusCode == http.StatusTooManyRequests {
		return aiTurn{}, aiRateLimitError{fmt.Errorf("HTTP 429: %s", strings.TrimSpace(string(raw)))}
	}
	if resp.StatusCode != http.StatusOK || len(out.Choices) == 0 {
		msg := strings.TrimSpace(string(raw))
		if out.Error != nil {
			msg = out.Error.Message
		}
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return aiTurn{}, fmt.Errorf("%s: HTTP %d %s", s.cfg.BaseURL, resp.StatusCode, msg)
	}

	choice := out.Choices[0]
	s.messages = append(s.messages, choice.Message)
	var message struct {
		Content   *string `json:"content"`
		ToolCalls []struct {
			ID       string `json:"id"`
			Function struct {
				Name      string `json:"name"`
				Arguments string `json:"arguments"`
			} `json:"function"`
		} `json:"tool_calls"`
	}
	if err := json.Unmarshal(choice.Message, &message); err != nil {
		return aiTurn{}, fmt.Errorf("jawaban provider tidak terbaca: %v", err)
	}
	turn := aiTurn{StopReason: choice.FinishReason, Usage: aiUsage{
		InputTokens: out.Usage.PromptTokens, OutputTokens: out.Usage.CompletionTokens, CacheReadTokens: out.Usage.PromptTokensDetails.CachedTokens,
	}}
	if message.Content != nil {
		turn.Text = strings.TrimSpace(*message.Content)
	}
	for _, call := range message.ToolCalls {
		args := strings.TrimSpace(call.Function.Arguments)
		if args == "" {
			args = "{}"
		}
		turn.Calls = append(turn.Calls, aiPendingCall{ID: call.ID, Name: call.Function.Name, Input: json.RawMessage(args)})
	}
	turn.Refused = choice.FinishReason == "content_filter"
	turn.Done = len(turn.Calls) == 0
	return turn, nil
}
