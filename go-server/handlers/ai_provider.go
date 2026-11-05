package handlers

import (
	"context"
	"encoding/json"
	"fmt"
)

// The AI Asisten is not tied to one AI vendor. The provider is chosen in the
// Pengaturan AI page (ai_settings.go); tools, permissions, glossary, logging
// and quotas are the same for every provider:
//
//	anthropic  Claude Messages API (model default claude-opus-5-5, base URL
//	           optional, e.g. for a gateway).
//	openai     any OpenAI-compatible Chat Completions API: OpenAI, Azure
//	           OpenAI, OpenRouter, Groq, DeepSeek, Gemini's OpenAI endpoint,
//	           Ollama, vLLM... (base URL default https://api.openai.com/v1,
//	           model required, API key optional for local servers).
//
// The assistant is off until it is switched on and the provider is complete:
// nothing is sent anywhere before that.

const (
	aiProviderAnthropic = "anthropic"
	aiProviderOpenAI    = "openai"
)

type aiProviderConfig struct {
	Provider, Model, BaseURL, APIKey string
	MaxTokens                        int
}

// aiPendingCall is a tool call the model asked for.
type aiPendingCall struct {
	ID, Name string
	Input    json.RawMessage
}

// aiCallResult is a tool's answer to one call.
type aiCallResult struct {
	ID, Content string
	IsError     bool
}

// aiTurn is one model response: its text, the tools it wants to call, and
// whether the answer is complete.
type aiTurn struct {
	Text       string
	Calls      []aiPendingCall
	Done       bool // no more tool calls
	Refused    bool // declined by the provider's safety filter
	StopReason string
	Usage      aiUsage
}

// aiSession holds one answer's conversation in the provider's own format.
// Next sends the results of the previous turn's calls (none on the first
// turn) and returns the model's next turn.
type aiSession interface {
	Next(ctx context.Context, results []aiCallResult) (aiTurn, error)
}

// aiRateLimitError: the provider asked us to slow down (HTTP 429).
type aiRateLimitError struct{ err error }

func (e aiRateLimitError) Error() string { return e.err.Error() }

// newAISession starts a session with the configured provider. stable is the
// unchanging system prompt (instructions + glossary, cacheable), volatile
// what changes per request (the date).
func newAISession(cfg aiProviderConfig, stable, volatile string, history []aiChatMessage, tools []aiTool) (aiSession, error) {
	switch cfg.Provider {
	case aiProviderAnthropic:
		return newAnthropicSession(cfg, stable, volatile, history, tools), nil
	case aiProviderOpenAI:
		return newOpenAISession(cfg, stable, volatile, history, tools), nil
	}
	return nil, fmt.Errorf("provider AI %q tidak dikenal (pakai anthropic atau openai)", cfg.Provider)
}
