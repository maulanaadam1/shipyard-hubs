package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
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

const aiInstructions = `Anda adalah AI Asisten ShipHub untuk tim galangan kapal. Jawab pertanyaan tentang data ShipHub (Work Order, item pekerjaan, tagihan, harga acuan, data perlu dicek, Job Order, Ship Docking, Request Material, peralatan dan master data) hanya berdasarkan hasil alat yang tersedia. Gunakan alat untuk setiap angka; jangan menebak atau mengarang data. Bila data yang diminta tidak bisa didapat dari alat, katakan itu dengan jelas. Jawab ringkas dalam Bahasa Indonesia, sebutkan periode, filter dan jumlah data yang dipakai. Anda hanya membaca data: perbaikan data dilakukan di SIAGA. Format jawaban dengan Markdown sederhana: tabel Markdown untuk daftar atau perbandingan angka, **tebal** untuk angka utama, daftar berpoin bila perlu; tanpa HTML. Tulis kode WO lengkap seperti di data (mis. WO25060066) agar bisa diklik. Grafik: bila pengguna meminta grafik, chart atau visualisasi, atau jawabannya adalah tren waktu atau perbandingan 3-30 nilai, tambahkan satu blok kode berbahasa chart (tiga backtick lalu kata chart) berisi JSON {"type": "bar" | "horizontal_bar" | "stacked_bar" | "line", "title": "...", "unit": "rupiah" | "jam" | "angka" | "persen", "x_label": "...", "x": ["label", ...], "series": [{"name": "...", "values": [angka, ...]}]}. Aplikasi yang menggambarnya; jangan membuat gambar, SVG atau HTML. Angka harus persis dari hasil alat (bukan dibulatkan atau dikarang), satu values per label x, maksimal 6 seri dan 60 label, satu satuan per grafik (dua besaran berbeda = dua grafik). Pakai line untuk tren waktu (x urut waktu), horizontal_bar untuk membandingkan banyak kategori seperti vendor (urut dari terbesar), bar untuk sedikit kategori, stacked_bar untuk komposisi (mis. approved vs pending). Pakai semua baris dari alat, termasuk periode sebagian (partial) dan yang bernilai 0, dengan label dari alat; jangan membuang data agar jumlahnya tetap sama dengan total. Tetap tulis angka utama di teks. Jangan menuliskan rencana atau langkah kerja Anda (mis. "Saya akan membuat grafik..."); langsung berikan jawabannya. Akhiri setiap jawaban dengan satu baris terpisah: ` + "`LANJUT: <pertanyaan 1> | <pertanyaan 2> | <pertanyaan 3>`" + ` berisi 2-3 pertanyaan lanjutan singkat (maks 8 kata) yang bisa dijawab dengan alat yang ada; baris ini tidak ditampilkan sebagai teks.`

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
		Scope          string          `json:"scope"`  // see aiScopes; empty = all data
		Period         string          `json:"period"` // see aiPeriod; empty = none
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
	res := runAIChat(r, cfg, claims, convID, last.Content, history, emit, aiChatFocus{Scope: findAIScope(body.Scope), Period: body.Period})
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
	ToolCalls      []aiToolCall `json:"tool_calls"`
	Usage          aiUsage      `json:"usage"`
	Failure        string       `json:"-"`
}

// runAIChat runs the tool loop for one question and logs it.
// aiChatFocus: the scope and period chosen above the question box.
type aiChatFocus struct {
	Scope  *aiScope
	Period string
}

func runAIChat(r *http.Request, cfg aiProviderConfig, claims middleware.UserClaims, convID, question string, history []aiChatMessage, emit aiEmitter, focus aiChatFocus) aiChatResult {
	start := time.Now()
	res := aiChatResult{ID: uuid.New().String(), ConversationID: convID, ToolCalls: []aiToolCall{}, Suggestions: []string{}}
	tools := scopeTools(availableAITools(r), focus.Scope)
	var onText func(string)
	if emit != nil {
		onText = func(delta string) { emit("text", map[string]string{"delta": delta}) }
	}
	var stopReason string
	// Stable instructions and glossary first (cacheable); the date apart so it
	// doesn't invalidate the cache.
	// Light models ignore a date at the end of a long system prompt and
	// answer from their training data, so the date also goes next to the
	// question itself (the stored question is unchanged).
	dateContext := aiDateContext(time.Now())
	if n := len(history); n > 0 && history[n-1].Role == "user" {
		// The same goes for charts: when the question asks for one, the
		// format sits right next to it.
		suffix := ""
		if aiWantsChart(history[n-1].Content) {
			suffix = "\n\n" + aiChartReminder
		}
		context := dateContext
		if note := aiFocusNote(focus.Scope, focus.Period, time.Now()); note != "" {
			context += ". " + note
		}
		history = append(history[:n-1:n-1], aiChatMessage{Role: "user", Content: "[" + context + "]\n" + history[n-1].Content + suffix})
	}
	session, err := newAISession(cfg, aiInstructions+"\n\n"+aiGlossary, dateContext, history, tools)
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

var aiMonthNames = []string{"", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"}

// aiDateContext tells the model the current WIB date and the exact dates of
// the periods people name ("hari ini", "minggu lalu", "bulan lalu", "tahun
// ini"...), so every tool gets the same precise date_from / date_to and the
// model never falls back on dates it remembers.
func aiDateContext(now time.Time) string {
	if loc, err := time.LoadLocation("Asia/Jakarta"); err == nil {
		now = now.In(loc)
	}
	day := func(t time.Time) string { return t.Format("2006-01-02") }
	span := func(a, b time.Time) string { return day(a) + " s.d. " + day(b) }
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	monday := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7))
	// Billing weeks (Financial Dashboard) run Saturday to Friday.
	saturday := today.AddDate(0, 0, -((int(today.Weekday()) + 1) % 7))
	month := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, today.Location())
	year := time.Date(today.Year(), 1, 1, 0, 0, 0, 0, today.Location())

	var b strings.Builder
	fmt.Fprintf(&b, "Waktu sekarang: %s, %d %s %d pukul %s WIB (hari ini = %s).\n",
		attendanceDayNames[today.Weekday()], today.Day(), aiMonthNames[today.Month()], today.Year(), now.Format("15.04"), day(today))
	b.WriteString("Periode (pakai persis tanggal ini sebagai date_from / date_to di semua alat, lalu sebut periodenya di jawaban):\n")
	for _, p := range [][2]string{
		{"hari ini", span(today, today)},
		{"kemarin", span(today.AddDate(0, 0, -1), today.AddDate(0, 0, -1))},
		{"minggu ini (Senin-Minggu)", span(monday, monday.AddDate(0, 0, 6))},
		{"minggu lalu (Senin-Minggu)", span(monday.AddDate(0, 0, -7), monday.AddDate(0, 0, -1))},
		{"minggu tagihan ini (Sabtu-Jumat)", span(saturday, saturday.AddDate(0, 0, 6))},
		{"minggu tagihan lalu (Sabtu-Jumat)", span(saturday.AddDate(0, 0, -7), saturday.AddDate(0, 0, -1))},
		{"7 hari terakhir", span(today.AddDate(0, 0, -6), today)},
		{"30 hari terakhir", span(today.AddDate(0, 0, -29), today)},
		{"bulan ini", span(month, month.AddDate(0, 1, -1))},
		{"bulan lalu", span(month.AddDate(0, -1, 0), month.AddDate(0, 0, -1))},
		{"tahun ini", span(year, year.AddDate(1, 0, -1))},
		{"tahun lalu", span(year.AddDate(-1, 0, 0), year.AddDate(0, 0, -1))},
	} {
		fmt.Fprintf(&b, "- %s: %s\n", p[0], p[1])
	}
	b.WriteString("Untuk tagihan / approval per minggu pakai minggu tagihan (Sabtu-Jumat); untuk hal lain (absensi, item, WO) minggu Senin-Minggu. " +
		"Jangan memakai pilihan periode relatif alat (mis. period 1week) untuk pertanyaan kalender seperti ini, karena itu dihitung dari data terbaru, bukan dari hari ini. " +
		"Jangan memakai tanggal lain dari ingatan Anda.")
	return b.String()
}

var aiChartWords = regexp.MustCompile(`(?i)\b(grafik|chart|diagram|visualisasi|visualisasikan|plot|kurva)\b`)

// aiWantsChart: the question asks for a chart.
func aiWantsChart(question string) bool { return aiChartWords.MatchString(question) }

// aiChartReminder is added after a question that asks for a chart, with the
// exact block the app draws (lib/ai-chart.ts).
const aiChartReminder = "[Pengguna meminta grafik. Setelah mengambil data dengan alat, WAJIB sertakan satu blok seperti ini " +
	"(aplikasi yang menggambarnya; jangan diganti tabel saja, jangan gambar/SVG/HTML):\n" +
	"```chart\n" +
	`{"type": "line", "title": "Judul singkat", "unit": "rupiah", "x_label": "Minggu", "x": ["label 1", "label 2"], "series": [{"name": "Approved", "values": [123, 456]}]}` + "\n" +
	"```\n" +
	"type: line untuk tren waktu, horizontal_bar untuk banyak kategori, bar untuk sedikit kategori, stacked_bar untuk komposisi. " +
	"unit: rupiah, jam, angka atau persen. Angka persis dari hasil alat, satu nilai per label x, maksimal 6 seri dan 60 label. " +
	"Masukkan SEMUA baris tren dari alat, termasuk yang partial (sebagian) dan bernilai 0, dengan label dari alat, " +
	"supaya jumlah grafik sama dengan total. Jangan tulis rencana Anda; langsung jawab.]"
