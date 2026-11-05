package handlers

import (
	"bufio"
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
// (POST {base URL}/chat/completions with function tools). Without streaming
// the assistant messages are kept exactly as the provider returned them;
// when streaming they are rebuilt from the chunks (content and tool calls).
type openAISession struct {
	cfg      aiProviderConfig
	client   *http.Client
	messages []json.RawMessage
	tools    []map[string]interface{}
	// noStreamOptions: the server rejected stream_options; stream without it.
	noStreamOptions bool
}

func newOpenAISession(cfg aiProviderConfig, stable, volatile string, history []aiChatMessage, tools []aiTool) *openAISession {
	s := &openAISession{cfg: cfg, client: &http.Client{Timeout: 180 * time.Second}}
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

type openAIUsage struct {
	PromptTokens        int64 `json:"prompt_tokens"`
	CompletionTokens    int64 `json:"completion_tokens"`
	PromptTokensDetails struct {
		CachedTokens int64 `json:"cached_tokens"`
	} `json:"prompt_tokens_details"`
}

func (u *openAIUsage) toUsage() aiUsage {
	if u == nil {
		return aiUsage{}
	}
	return aiUsage{InputTokens: u.PromptTokens, OutputTokens: u.CompletionTokens, CacheReadTokens: u.PromptTokensDetails.CachedTokens}
}

type openAIResponse struct {
	Choices []struct {
		Message      json.RawMessage `json:"message"`
		FinishReason string          `json:"finish_reason"`
	} `json:"choices"`
	Usage *openAIUsage `json:"usage"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

type openAIToolCall struct {
	Index    int    `json:"index"`
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

func (s *openAISession) post(ctx context.Context, stream bool) (*http.Response, error) {
	body := map[string]interface{}{"model": s.cfg.Model, "messages": s.messages}
	if len(s.tools) > 0 {
		body["tools"] = s.tools
		body["tool_choice"] = "auto"
	}
	if s.cfg.MaxTokens > 0 {
		body["max_tokens"] = s.cfg.MaxTokens
	}
	if stream {
		body["stream"] = true
		if !s.noStreamOptions {
			body["stream_options"] = map[string]bool{"include_usage": true}
		}
	}
	payload, _ := json.Marshal(body)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.BaseURL+"/chat/completions", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if s.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+s.cfg.APIKey)
	}
	return s.client.Do(req)
}

func (s *openAISession) httpError(status int, raw []byte) error {
	var out openAIResponse
	json.Unmarshal(raw, &out)
	msg := strings.TrimSpace(string(raw))
	if out.Error != nil {
		msg = out.Error.Message
	}
	if len(msg) > 300 {
		msg = msg[:300]
	}
	err := fmt.Errorf("%s: HTTP %d %s", s.cfg.BaseURL, status, msg)
	if status == http.StatusTooManyRequests {
		return aiRateLimitError{err}
	}
	return err
}

func (s *openAISession) Next(ctx context.Context, results []aiCallResult, onText func(string)) (aiTurn, error) {
	for _, res := range results {
		content := res.Content
		if res.IsError {
			content = "ERROR: " + content
		}
		s.add(map[string]interface{}{"role": "tool", "tool_call_id": res.ID, "content": content})
	}
	stream := onText != nil
	resp, err := s.post(ctx, stream)
	if err != nil {
		return aiTurn{}, err
	}
	if stream && resp.StatusCode == http.StatusBadRequest && !s.noStreamOptions {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		resp.Body.Close()
		if !strings.Contains(string(raw), "stream_options") {
			return aiTurn{}, s.httpError(resp.StatusCode, raw)
		}
		s.noStreamOptions = true
		if resp, err = s.post(ctx, stream); err != nil {
			return aiTurn{}, err
		}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		return aiTurn{}, s.httpError(resp.StatusCode, raw)
	}
	if stream && strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		return s.readStream(resp.Body, onText)
	}

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 20<<20))
	var out openAIResponse
	json.Unmarshal(raw, &out)
	if len(out.Choices) == 0 {
		return aiTurn{}, s.httpError(resp.StatusCode, raw)
	}
	choice := out.Choices[0]
	s.messages = append(s.messages, choice.Message)
	var message struct {
		Content   *string          `json:"content"`
		ToolCalls []openAIToolCall `json:"tool_calls"`
	}
	if err := json.Unmarshal(choice.Message, &message); err != nil {
		return aiTurn{}, fmt.Errorf("jawaban provider tidak terbaca: %v", err)
	}
	text := ""
	if message.Content != nil {
		text = *message.Content
	}
	if onText != nil && text != "" { // asked to stream, server answered at once
		onText(text)
	}
	return openAITurn(text, message.ToolCalls, choice.FinishReason, out.Usage.toUsage()), nil
}

// readStream reads a streamed Chat Completions answer.
func (s *openAISession) readStream(body io.Reader, onText func(string)) (aiTurn, error) {
	var text strings.Builder
	var calls []openAIToolCall
	var finish string
	var usage aiUsage
	err := readSSE(body, func(_, data string) error {
		if data == "[DONE]" {
			return nil
		}
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content   *string          `json:"content"`
					ToolCalls []openAIToolCall `json:"tool_calls"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
			Usage *openAIUsage `json:"usage"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if json.Unmarshal([]byte(data), &chunk) != nil {
			return nil
		}
		if chunk.Error != nil {
			return fmt.Errorf("%s: %s", s.cfg.BaseURL, chunk.Error.Message)
		}
		if chunk.Usage != nil {
			usage = chunk.Usage.toUsage()
		}
		for _, c := range chunk.Choices {
			if c.Delta.Content != nil && *c.Delta.Content != "" {
				text.WriteString(*c.Delta.Content)
				onText(*c.Delta.Content)
			}
			for _, tc := range c.Delta.ToolCalls {
				for len(calls) <= tc.Index {
					calls = append(calls, openAIToolCall{Index: len(calls), Type: "function"})
				}
				call := &calls[tc.Index]
				if tc.ID != "" {
					call.ID = tc.ID
				}
				if tc.Function.Name != "" {
					call.Function.Name += tc.Function.Name
				}
				call.Function.Arguments += tc.Function.Arguments
			}
			if c.FinishReason != nil && *c.FinishReason != "" {
				finish = *c.FinishReason
			}
		}
		return nil
	})
	if err != nil {
		return aiTurn{}, err
	}
	message := map[string]interface{}{"role": "assistant", "content": nil}
	if text.Len() > 0 {
		message["content"] = text.String()
	}
	if len(calls) > 0 {
		list := make([]map[string]interface{}, 0, len(calls))
		for i, c := range calls {
			if c.ID == "" {
				calls[i].ID = fmt.Sprintf("call_%d", i)
			}
			list = append(list, map[string]interface{}{"id": calls[i].ID, "type": "function",
				"function": map[string]string{"name": c.Function.Name, "arguments": c.Function.Arguments}})
		}
		message["tool_calls"] = list
	}
	s.add(message)
	return openAITurn(text.String(), calls, finish, usage), nil
}

func openAITurn(text string, calls []openAIToolCall, finish string, usage aiUsage) aiTurn {
	turn := aiTurn{Text: strings.TrimSpace(text), StopReason: finish, Usage: usage}
	for _, call := range calls {
		args := strings.TrimSpace(call.Function.Arguments)
		if args == "" {
			args = "{}"
		}
		turn.Calls = append(turn.Calls, aiPendingCall{ID: call.ID, Name: call.Function.Name, Input: json.RawMessage(args)})
	}
	turn.Refused = finish == "content_filter"
	turn.Done = len(turn.Calls) == 0
	return turn
}

// readSSE calls fn for each server-sent event (event name, data).
func readSSE(body io.Reader, fn func(event, data string) error) error {
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 64*1024), 8<<20)
	var event string
	var data []string
	dispatch := func() error {
		if len(data) == 0 {
			event = ""
			return nil
		}
		err := fn(event, strings.Join(data, "\n"))
		event, data = "", nil
		return err
	}
	for scanner.Scan() {
		line := strings.TrimRight(scanner.Text(), "\r")
		switch {
		case line == "":
			if err := dispatch(); err != nil {
				return err
			}
		case strings.HasPrefix(line, "event:"):
			event = strings.TrimSpace(line[len("event:"):])
		case strings.HasPrefix(line, "data:"):
			data = append(data, strings.TrimPrefix(line[len("data:"):], " "))
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return dispatch()
}
