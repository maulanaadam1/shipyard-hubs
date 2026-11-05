package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/anthropics/anthropic-sdk-go/v2"
	"github.com/anthropics/anthropic-sdk-go/v2/option"
	"github.com/anthropics/anthropic-sdk-go/v2/shared/constant"
	"github.com/google/uuid"

	"shipyard/db"
	"shipyard/middleware"
)

// AI Asisten: a chat that answers questions about ShipHub data with Claude
// and the read-only tools of ai_tools.go. It is off until ANTHROPIC_API_KEY is
// set on the server: nothing is sent to Anthropic before that. Every
// question, the tools used and the answer are logged in ai_chat_log.

// ResourceAIAssistant is the RBAC resource of the AI Asisten menu. Admin
// always has it; other roles get it in Role Management.
const ResourceAIAssistant = "AI Asisten"

const (
	aiDefaultModel     = "claude-opus-5-5"
	aiMaxIterations    = 8     // tool rounds per question
	aiMaxHistory       = 20    // earlier messages kept from the conversation
	aiMaxMessageChars  = 4000  // per user message
	aiMaxToolResultLen = 30000 // characters of one tool result given to the model
)

const aiInstructions = `Anda adalah AI Asisten ShipHub untuk tim galangan kapal. Jawab pertanyaan tentang data ShipHub (Work Order, item pekerjaan, tagihan, harga acuan, data perlu dicek) hanya berdasarkan hasil alat yang tersedia. Gunakan alat untuk setiap angka; jangan menebak atau mengarang data. Bila data yang diminta tidak bisa didapat dari alat, katakan itu dengan jelas. Jawab ringkas dalam Bahasa Indonesia, sebutkan periode, filter dan jumlah data yang dipakai. Anda hanya membaca data: perbaikan data dilakukan di SIAGA.`

func aiModel() string {
	if m := strings.TrimSpace(os.Getenv("AI_MODEL")); m != "" {
		return m
	}
	return aiDefaultModel
}

func aiEnabled() bool { return strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY")) != "" }

func aiDailyLimit() int { return envInt("AI_DAILY_LIMIT", 50) }

func aiUsedToday(userID string) int {
	var n int
	db.QueryRow(`SELECT COUNT(*) FROM ai_chat_log WHERE user_id = ? AND created_at >= ?`, userID, time.Now().Format("2006-01-02")).Scan(&n)
	return n
}

// GetAIStatus tells the page whether the assistant is on and how many
// questions the user has left today.
func GetAIStatus(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetUserClaims(r)
	tools := []string{}
	for _, t := range availableAITools(r) {
		tools = append(tools, t.Name)
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"enabled": aiEnabled(), "model": aiModel(), "daily_limit": aiDailyLimit(), "used_today": aiUsedToday(claims.ID), "tools": tools,
	})
}

type aiChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type aiToolCall struct {
	Name    string          `json:"name"`
	Input   json.RawMessage `json:"input"`
	IsError bool            `json:"is_error"`
}

type aiUsage struct {
	InputTokens     int64 `json:"input_tokens"`
	OutputTokens    int64 `json:"output_tokens"`
	CacheReadTokens int64 `json:"cache_read_tokens"`
}

// betaTools converts the user's tools to Messages API tool definitions.
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

// runAITool runs one tool call of the model for this user and returns the
// tool_result content and whether it is an error.
func runAITool(r *http.Request, tools []aiTool, name string, input json.RawMessage) (string, bool) {
	for _, t := range tools {
		if t.Name != name {
			continue
		}
		result, err := t.Run(r, input)
		if err != nil {
			var inputErr aiInputError
			if errors.As(err, &inputErr) {
				return err.Error(), true
			}
			log.Printf("[AI] tool %s failed: %v", name, err)
			return "Alat gagal dijalankan karena gangguan server; coba lagi nanti atau jawab tanpa data ini.", true
		}
		b, _ := json.Marshal(cleanForModel(result))
		s := string(b)
		if len(s) > aiMaxToolResultLen {
			s = s[:aiMaxToolResultLen] + `... (dipotong; persempit filter atau kurangi limit)`
		}
		return s, false
	}
	return "Alat " + name + " tidak tersedia untuk pengguna ini.", true
}

// PostAIChat answers the last user message of a conversation. The client
// keeps the conversation (text only) and sends it back each turn; tool calls
// stay within one answer.
func PostAIChat(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fail := func(code int, msg string) {
		w.WriteHeader(code)
		json.NewEncoder(w).Encode(map[string]string{"error": msg})
	}
	if !aiEnabled() {
		fail(http.StatusServiceUnavailable, "AI Asisten belum diaktifkan (ANTHROPIC_API_KEY belum dipasang di server).")
		return
	}
	claims, _ := middleware.GetUserClaims(r)
	if used := aiUsedToday(claims.ID); used >= aiDailyLimit() {
		fail(http.StatusTooManyRequests, fmt.Sprintf("Batas %d pertanyaan per hari sudah tercapai. Coba lagi besok.", aiDailyLimit()))
		return
	}
	var body struct {
		Messages []aiChatMessage `json:"messages"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Messages) == 0 {
		fail(http.StatusBadRequest, "messages wajib diisi")
		return
	}
	if len(body.Messages) > aiMaxHistory {
		body.Messages = body.Messages[len(body.Messages)-aiMaxHistory:]
	}
	last := body.Messages[len(body.Messages)-1]
	if last.Role != "user" || strings.TrimSpace(last.Content) == "" {
		fail(http.StatusBadRequest, "pesan terakhir harus pertanyaan pengguna")
		return
	}
	messages := make([]anthropic.BetaMessageParam, 0, len(body.Messages))
	for _, m := range body.Messages {
		text := strings.TrimSpace(m.Content)
		if len([]rune(text)) > aiMaxMessageChars {
			text = string([]rune(text)[:aiMaxMessageChars])
		}
		if text == "" {
			continue
		}
		switch m.Role {
		case "user":
			messages = append(messages, anthropic.NewBetaUserMessage(anthropic.NewBetaTextBlock(text)))
		case "assistant":
			if len(messages) > 0 { // the conversation must start with the user
				messages = append(messages, anthropic.BetaMessageParam{OfAssistant: &anthropic.BetaAssistantMessageParam{
					Content: []anthropic.BetaContentBlockParamUnion{anthropic.NewBetaTextBlock(text)},
				}})
			}
		}
	}

	tools := availableAITools(r)
	params := anthropic.BetaMessageNewParams{
		Model:     anthropic.Model(aiModel()),
		MaxTokens: 16000,
		// Stable instructions and glossary first and cached; the date after the
		// breakpoint so it doesn't invalidate the cache.
		System: []anthropic.BetaTextBlockParam{
			{Text: aiInstructions + "\n\n" + aiGlossary, CacheControl: anthropic.NewBetaCacheControlEphemeralParam()},
			{Text: "Hari ini: " + time.Now().Format("2006-01-02") + " (WIB)."},
		},
		Tools:        betaTools(tools),
		OutputConfig: anthropic.BetaOutputConfigParam{Effort: anthropic.BetaOutputConfigEffortMedium},
		Messages:     messages,
		// A policy decline is re-run on a fallback model chosen by the API.
		Betas:     []anthropic.AnthropicBeta{anthropic.AnthropicBetaServerSideFallback2026_07_01},
		Fallbacks: anthropic.BetaFallbacksParamUnion{OfDefault: constant.ValueOf[constant.Default]()},
	}
	client := anthropic.NewClient(option.WithRequestTimeout(120 * time.Second))
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()

	var calls []aiToolCall
	var usage aiUsage
	var answer, stopReason, failure string
	for round := 0; round < aiMaxIterations; round++ {
		resp, err := client.Beta.Messages.New(ctx, params)
		if err != nil {
			log.Printf("[AI] request failed: %v", err)
			failure = "Layanan AI sedang tidak bisa dihubungi. Coba lagi beberapa saat lagi."
			var apiErr *anthropic.Error
			if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusTooManyRequests {
				failure = "Layanan AI sedang sibuk (batas permintaan). Coba lagi sebentar lagi."
			}
			break
		}
		usage.InputTokens += resp.Usage.InputTokens
		usage.OutputTokens += resp.Usage.OutputTokens
		usage.CacheReadTokens += resp.Usage.CacheReadInputTokens
		stopReason = string(resp.StopReason)
		params.Messages = append(params.Messages, resp.ToParam())

		var text []string
		var results []anthropic.BetaContentBlockParamUnion
		for _, block := range resp.Content {
			switch b := block.AsAny().(type) {
			case anthropic.BetaTextBlock:
				text = append(text, b.Text)
			case anthropic.BetaToolUseBlock:
				input := json.RawMessage(b.JSON.Input.Raw())
				content, isErr := runAITool(r, tools, b.Name, input)
				calls = append(calls, aiToolCall{Name: b.Name, Input: input, IsError: isErr})
				results = append(results, anthropic.NewBetaToolResultBlock(b.ID, content, isErr))
			}
		}
		answer = strings.TrimSpace(strings.Join(text, "\n\n"))
		if resp.StopReason == anthropic.BetaStopReasonRefusal {
			answer = "Maaf, pertanyaan ini tidak bisa saya jawab."
			break
		}
		if resp.StopReason != anthropic.BetaStopReasonToolUse || len(results) == 0 {
			break
		}
		// All tool results of one turn go back in one user message.
		params.Messages = append(params.Messages, anthropic.NewBetaUserMessage(results...))
		if round == aiMaxIterations-1 {
			answer = strings.TrimSpace(answer + "\n\n(Pertanyaan ini butuh terlalu banyak langkah; coba persempit pertanyaannya.)")
		}
	}
	if answer == "" && failure == "" {
		failure = "AI tidak memberi jawaban. Coba ulangi dengan kalimat lain."
	}

	toolsJSON, _ := json.Marshal(calls)
	db.Exec(`INSERT INTO ai_chat_log (id, user_id, user_email, question, answer, tools, model, stop_reason, error,
			input_tokens, output_tokens, cache_read_tokens, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		uuid.New().String(), claims.ID, claims.Email, last.Content, answer, string(toolsJSON), aiModel(), stopReason, failure,
		usage.InputTokens, usage.OutputTokens, usage.CacheReadTokens, time.Now().Format("2006-01-02 15:04:05"))

	if failure != "" {
		fail(http.StatusBadGateway, failure)
		return
	}
	if calls == nil {
		calls = []aiToolCall{}
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"answer": answer, "tool_calls": calls, "usage": usage})
}
