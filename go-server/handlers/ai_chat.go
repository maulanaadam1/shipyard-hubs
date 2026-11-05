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

const aiInstructions = `Anda adalah AI Asisten ShipHub untuk tim galangan kapal. Jawab pertanyaan tentang data ShipHub (Work Order, item pekerjaan, tagihan, harga acuan, data perlu dicek, Job Order, Ship Docking, Request Material, peralatan dan master data) hanya berdasarkan hasil alat yang tersedia. Gunakan alat untuk setiap angka; jangan menebak atau mengarang data. Bila data yang diminta tidak bisa didapat dari alat, katakan itu dengan jelas. Jawab ringkas dalam Bahasa Indonesia, sebutkan periode, filter dan jumlah data yang dipakai. Anda hanya membaca data: perbaikan data dilakukan di SIAGA. Format jawaban dengan Markdown sederhana: tabel Markdown untuk daftar atau perbandingan angka, **tebal** untuk angka utama, daftar berpoin bila perlu; tanpa HTML. Tulis kode WO lengkap seperti di data (mis. WO25060066) agar bisa diklik. Akhiri setiap jawaban dengan satu baris terpisah: `+"`LANJUT: <pertanyaan 1> | <pertanyaan 2> | <pertanyaan 3>`"+` berisi 2-3 pertanyaan lanjutan singkat (maks 8 kata) yang bisa dijawab dengan alat yang ada; baris ini tidak ditampilkan sebagai teks.`

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

// aiEmitter receives the progress of one answer: "round" (a new model turn
// starts; drop the draft text), "tool" (a tool is being run), "text" (a piece
// of the answer). nil when the client doesn't stream.
type aiEmitter func(event string, data interface{})

// PostAIChat answers the last user message of a conversation. The client
// keeps the conversation (text only) and sends it back each turn; tool calls
// stay within one answer. With "Accept: text/event-stream" the answer is
// streamed as server-sent events (round, tool, text, then done or error);
// otherwise one JSON response is returned.
func PostAIChat(w http.ResponseWriter, r *http.Request) {
	fail := func(code int, msg string) {
		w.Header().Set("Content-Type", "application/json")
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
		Messages       []aiChatMessage `json:"messages"`
		ConversationID string          `json:"conversation_id"`
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

	var emit aiEmitter
	if strings.Contains(r.Header.Get("Accept"), "text/event-stream") {
		flusher, ok := w.(http.Flusher)
		if ok {
			w.Header().Set("Content-Type", "text/event-stream")
			w.Header().Set("Cache-Control", "no-cache")
			w.Header().Set("X-Accel-Buffering", "no") // no proxy buffering
			w.WriteHeader(http.StatusOK)
			emit = func(event string, data interface{}) {
				b, _ := json.Marshal(data)
				fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, b)
				flusher.Flush()
			}
		}
	}

	convID, err := aiConversationFor(claims, body.ConversationID, last.Content)
	if err != nil {
		if emit != nil {
			emit("error", map[string]string{"error": err.Error()})
			return
		}
		fail(http.StatusNotFound, err.Error())
		return
	}
	res := runAIChat(r, cfg, claims, convID, last.Content, history, emit)
	if emit != nil {
		if res.Failure != "" {
			emit("error", map[string]string{"error": res.Failure})
		} else {
			emit("done", res)
		}
		return
	}
	if res.Failure != "" {
		fail(http.StatusBadGateway, res.Failure)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

type aiChatResult struct {
	ID             string       `json:"id"`
	ConversationID string       `json:"conversation_id"`
	Suggestions    []string     `json:"suggestions"`
	DurationMs     int64        `json:"duration_ms"`
	Answer         string       `json:"answer"`
	ToolCalls []aiToolCall `json:"tool_calls"`
	Usage     aiUsage      `json:"usage"`
	Failure   string       `json:"-"`
}

// runAIChat runs the tool loop for one question and logs it.
func runAIChat(r *http.Request, cfg aiProviderConfig, claims middleware.UserClaims, convID, question string, history []aiChatMessage, emit aiEmitter) aiChatResult {
	start := time.Now()
	res := aiChatResult{ID: uuid.New().String(), ConversationID: convID, ToolCalls: []aiToolCall{}, Suggestions: []string{}}
	tools := availableAITools(r)
	var onText func(string)
	if emit != nil {
		onText = func(delta string) { emit("text", map[string]string{"delta": delta}) }
	}
	var stopReason string
	// Stable instructions and glossary first (cacheable); the date apart so it
	// doesn't invalidate the cache.
	session, err := newAISession(cfg, aiInstructions+"\n\n"+aiGlossary, "Hari ini: "+time.Now().Format("2006-01-02")+" (WIB).", history, tools)
	if err != nil {
		res.Failure = err.Error()
	} else {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
		defer cancel()
		var results []aiCallResult
		for round := 0; round < aiMaxIterations; round++ {
			if emit != nil {
				emit("round", map[string]int{"round": round + 1})
			}
			turn, err := session.Next(ctx, results, onText)
			if err != nil {
				log.Printf("[AI] %s request failed: %v", cfg.Provider, err)
				res.Failure = "Layanan AI sedang tidak bisa dihubungi. Coba lagi beberapa saat lagi."
				var rateErr aiRateLimitError
				if errors.As(err, &rateErr) {
					res.Failure = "Layanan AI sedang sibuk (batas permintaan). Coba lagi sebentar lagi."
				}
				break
			}
			res.Usage.InputTokens += turn.Usage.InputTokens
			res.Usage.OutputTokens += turn.Usage.OutputTokens
			res.Usage.CacheReadTokens += turn.Usage.CacheReadTokens
			stopReason = turn.StopReason
			res.Answer = turn.Text
			if turn.Refused {
				res.Answer = "Maaf, pertanyaan ini tidak bisa saya jawab."
				break
			}
			if turn.Done {
				break
			}
			results = results[:0:0]
			for _, call := range turn.Calls {
				if emit != nil {
					emit("tool", map[string]interface{}{"name": call.Name, "input": call.Input})
				}
				content, isErr := runAITool(r, tools, call.Name, call.Input)
				res.ToolCalls = append(res.ToolCalls, aiToolCall{Name: call.Name, Input: call.Input, IsError: isErr})
				results = append(results, aiCallResult{ID: call.ID, Content: content, IsError: isErr})
			}
			if round == aiMaxIterations-1 {
				res.Answer = strings.TrimSpace(res.Answer + "\n\n(Pertanyaan ini butuh terlalu banyak langkah; coba persempit pertanyaannya.)")
			}
		}
	}
	if res.Answer == "" && res.Failure == "" {
		res.Failure = "AI tidak memberi jawaban. Coba ulangi dengan kalimat lain."
	}

	res.Answer, res.Suggestions = splitSuggestions(res.Answer)
	res.DurationMs = time.Since(start).Milliseconds()
	toolsJSON, _ := json.Marshal(res.ToolCalls)
	db.Exec(`INSERT INTO ai_chat_log (id, conversation_id, user_id, user_email, question, answer, tools, model, stop_reason, error,
			input_tokens, output_tokens, cache_read_tokens, duration_ms, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		res.ID, convID, claims.ID, claims.Email, question, res.Answer, string(toolsJSON), cfg.Provider+"/"+cfg.Model, stopReason, res.Failure,
		res.Usage.InputTokens, res.Usage.OutputTokens, res.Usage.CacheReadTokens, res.DurationMs, start.Format("2006-01-02 15:04:05.000")) // ms: keeps a conversation in order
	db.Exec(`UPDATE ai_conversations SET updated_at = ? WHERE id = ?`, time.Now().Format("2006-01-02 15:04:05"), convID)
	return res
}
