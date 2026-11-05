package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"
	"github.com/anthropics/anthropic-sdk-go/v2/shared/constant"
)

// anthropicSession talks to the Claude Messages API (beta namespace, for the
// server-side refusal fallback). The assistant's full content (thinking and
// tool_use blocks) goes back unchanged within an answer.
type anthropicSession struct {
	client anthropic.Client
	params anthropic.BetaMessageNewParams
}

// betaTools converts tools to Messages API tool definitions.
func betaTools(tools []aiTool) []anthropic.BetaToolUnionParam {
	out := make([]anthropic.BetaToolUnionParam, 0, len(tools))
	for _, t := range tools {
		required, _ := t.Schema["required"].([]string)
		tool := anthropic.BetaToolParam{
			Name:        t.Name,
			Description: anthropic.String(t.Description),
			InputSchema: anthropic.BetaToolInputSchemaParam{
				Properties:  t.Schema["properties"],
				Required:    required,
				ExtraFields: map[string]any{"additionalProperties": false},
			},
		}
		out = append(out, anthropic.BetaToolUnionParam{OfTool: &tool})
	}
	return out
}

func newAnthropicSession(cfg aiProviderConfig, stable, volatile string, history []aiChatMessage, tools []aiTool) *anthropicSession {
	opts := []option.RequestOption{option.WithAPIKey(cfg.APIKey), option.WithRequestTimeout(120 * time.Second)}
	if cfg.BaseURL != "" {
		opts = append(opts, option.WithBaseURL(cfg.BaseURL))
	}
	messages := make([]anthropic.BetaMessageParam, 0, len(history))
	for _, m := range history {
		block := anthropic.NewBetaTextBlock(m.Content)
		if m.Role == "user" {
			messages = append(messages, anthropic.NewBetaUserMessage(block))
		} else {
			messages = append(messages, anthropic.BetaMessageParam{OfAssistant: &anthropic.BetaAssistantMessageParam{
				Content: []anthropic.BetaContentBlockParamUnion{block},
			}})
		}
	}
	maxTokens := int64(16000)
	if cfg.MaxTokens > 0 {
		maxTokens = int64(cfg.MaxTokens)
	}
	return &anthropicSession{
		client: anthropic.NewClient(opts...),
		params: anthropic.BetaMessageNewParams{
			Model:     anthropic.Model(cfg.Model),
			MaxTokens: maxTokens,
			// The stable part is cached; the date comes after the breakpoint.
			System: []anthropic.BetaTextBlockParam{
				{Text: stable, CacheControl: anthropic.NewBetaCacheControlEphemeralParam()},
				{Text: volatile},
			},
			Tools:        betaTools(tools),
			OutputConfig: anthropic.BetaOutputConfigParam{Effort: anthropic.BetaOutputConfigEffortMedium},
			Messages:     messages,
			// A policy decline is re-run on a fallback model chosen by the API.
			Betas:     []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01},
			Fallbacks: anthropic.BetaFallbacksParamUnion{OfDefault: constant.ValueOf[constant.Default]()},
		},
	}
}

func (s *anthropicSession) Next(ctx context.Context, results []aiCallResult) (aiTurn, error) {
	if len(results) > 0 {
		// All tool results of one turn go back in one user message.
		blocks := make([]anthropic.BetaContentBlockParamUnion, 0, len(results))
		for _, res := range results {
			blocks = append(blocks, anthropic.NewBetaToolResultBlock(res.ID, res.Content, res.IsError))
		}
		s.params.Messages = append(s.params.Messages, anthropic.NewBetaUserMessage(blocks...))
	}
	resp, err := s.client.Beta.Messages.New(ctx, s.params)
	if err != nil {
		var apiErr *anthropic.Error
		if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusTooManyRequests {
			return aiTurn{}, aiRateLimitError{err}
		}
		return aiTurn{}, err
	}
	s.params.Messages = append(s.params.Messages, resp.ToParam())
	turn := aiTurn{StopReason: string(resp.StopReason), Usage: aiUsage{
		InputTokens: resp.Usage.InputTokens, OutputTokens: resp.Usage.OutputTokens, CacheReadTokens: resp.Usage.CacheReadInputTokens,
	}}
	var text []string
	for _, block := range resp.Content {
		switch b := block.AsAny().(type) {
		case anthropic.BetaTextBlock:
			text = append(text, b.Text)
		case anthropic.BetaToolUseBlock:
			turn.Calls = append(turn.Calls, aiPendingCall{ID: b.ID, Name: b.Name, Input: json.RawMessage(b.JSON.Input.Raw())})
		}
	}
	turn.Text = strings.TrimSpace(strings.Join(text, "\n\n"))
	turn.Refused = resp.StopReason == anthropic.BetaStopReasonRefusal
	turn.Done = resp.StopReason != anthropic.BetaStopReasonToolUse || len(turn.Calls) == 0
	return turn, nil
}
