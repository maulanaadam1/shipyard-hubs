package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"shipyard/db"
	"shipyard/middleware"
)

// AI Asisten: a chat that answers questions about ShipHub data with the
// provider chosen in Pengaturan AI (ai_settings.go, ai_provider.go) and the
// read-only tools of ai_tools.go. It is off until an Admin switches it on:
// nothing is sent anywhere before that. Every question, the tools used and
// the answer are logged in ai_chat_log.

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
	cfg, enabled := aiConfig()
	settings := loadAISettings()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"enabled": enabled, "provider": cfg.Provider, "model": cfg.Model, "daily_limit": settings.DailyLimit,
		"used_today": aiUsedToday(claims.ID), "tools": tools, "is_admin": isAdminRequest(r),
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
	cfg, enabled := aiConfig()
	if !enabled {
		fail(http.StatusServiceUnavailable, "AI Asisten belum diaktifkan. Admin bisa mengaturnya di menu Pengaturan AI.")
		return
	}
	claims, _ := middleware.GetUserClaims(r)
	limit := loadAISettings().DailyLimit
	if used := aiUsedToday(claims.ID); used >= limit {
		fail(http.StatusTooManyRequests, fmt.Sprintf("Batas %d pertanyaan per hari sudah tercapai. Coba lagi besok.", limit))
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
	history := make([]aiChatMessage, 0, len(body.Messages))
	for _, m := range body.Messages {
		text := strings.TrimSpace(m.Content)
		if len([]rune(text)) > aiMaxMessageChars {
			text = string([]rune(text)[:aiMaxMessageChars])
		}
		if text == "" || (m.Role != "user" && m.Role != "assistant") {
			continue
		}
		if m.Role == "assistant" && len(history) == 0 {
			continue // the conversation must start with the user
		}
		history = append(history, aiChatMessage{Role: m.Role, Content: text})
	}

	tools := availableAITools(r)
	// Stable instructions and glossary first (cacheable); the date apart so it
	// doesn't invalidate the cache.
	session, err := newAISession(cfg, aiInstructions+"\n\n"+aiGlossary, "Hari ini: "+time.Now().Format("2006-01-02")+" (WIB).", history, tools)
	if err != nil {
		fail(http.StatusServiceUnavailable, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()

	var calls []aiToolCall
	var usage aiUsage
	var answer, stopReason, failure string
	var results []aiCallResult
	for round := 0; round < aiMaxIterations; round++ {
		turn, err := session.Next(ctx, results)
		if err != nil {
			log.Printf("[AI] %s request failed: %v", cfg.Provider, err)
			failure = "Layanan AI sedang tidak bisa dihubungi. Coba lagi beberapa saat lagi."
			var rateErr aiRateLimitError
			if errors.As(err, &rateErr) {
				failure = "Layanan AI sedang sibuk (batas permintaan). Coba lagi sebentar lagi."
			}
			break
		}
		usage.InputTokens += turn.Usage.InputTokens
		usage.OutputTokens += turn.Usage.OutputTokens
		usage.CacheReadTokens += turn.Usage.CacheReadTokens
		stopReason = turn.StopReason
		answer = turn.Text
		if turn.Refused {
			answer = "Maaf, pertanyaan ini tidak bisa saya jawab."
			break
		}
		if turn.Done {
			break
		}
		results = results[:0:0]
		for _, call := range turn.Calls {
			content, isErr := runAITool(r, tools, call.Name, call.Input)
			calls = append(calls, aiToolCall{Name: call.Name, Input: call.Input, IsError: isErr})
			results = append(results, aiCallResult{ID: call.ID, Content: content, IsError: isErr})
		}
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
		uuid.New().String(), claims.ID, claims.Email, last.Content, answer, string(toolsJSON), cfg.Provider+"/"+cfg.Model, stopReason, failure,
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
