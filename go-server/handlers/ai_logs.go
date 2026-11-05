package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"shipyard/db"
	"shipyard/middleware"
)

// PostAIFeedback stores the asker's thumbs up/down on one of their answers.
func PostAIFeedback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var in struct {
		ID     string `json:"id"`
		Rating string `json:"rating"` // up, down, or empty to undo
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil || in.ID == "" || (in.Rating != "up" && in.Rating != "down" && in.Rating != "") {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": "id dan rating (up/down) wajib diisi"})
		return
	}
	claims, _ := middleware.GetUserClaims(r)
	res, err := db.Exec(`UPDATE ai_chat_log SET feedback = ? WHERE id = ? AND user_id = ?`, in.Rating, in.ID, claims.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": "jawaban tidak ditemukan"})
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

type aiLogEntry struct {
	ID              string          `json:"id"`
	CreatedAt       string          `json:"created_at"`
	UserEmail       string          `json:"user_email"`
	Question        string          `json:"question"`
	Answer          string          `json:"answer"`
	Tools           json.RawMessage `json:"tools"`
	Model           string          `json:"model"`
	Error           string          `json:"error"`
	InputTokens     int64           `json:"input_tokens"`
	OutputTokens    int64           `json:"output_tokens"`
	CacheReadTokens int64           `json:"cache_read_tokens"`
	DurationMs      int64           `json:"duration_ms"`
	Feedback        string          `json:"feedback"`
}

// GetAILogs (Admin) summarises AI Asisten use over the last days: totals,
// per day, per user, per tool, and the questions themselves.
// Query: days (default 30), user (email), filter (all|errors|down|up), q, limit.
func GetAILogs(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	days, _ := strconv.Atoi(q.Get("days"))
	if days <= 0 || days > 366 {
		days = 30
	}
	since := time.Now().AddDate(0, 0, -days+1).Format("2006-01-02")
	where := []string{"created_at >= ?"}
	args := []interface{}{since}
	if u := strings.TrimSpace(q.Get("user")); u != "" {
		where = append(where, "user_email = ?")
		args = append(args, u)
	}
	// The summary covers the period (and user); the list is also filtered.
	baseWhere, baseArgs := strings.Join(where, " AND "), append([]interface{}{}, args...)
	switch q.Get("filter") {
	case "errors":
		where = append(where, "COALESCE(error, '') <> ''")
	case "down":
		where = append(where, "feedback = 'down'")
	case "up":
		where = append(where, "feedback = 'up'")
	}
	if text := strings.TrimSpace(q.Get("q")); text != "" {
		where = append(where, "(LOWER(question) LIKE ? OR LOWER(answer) LIKE ?)")
		like := "%" + strings.ToLower(text) + "%"
		args = append(args, like, like)
	}
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	summary := map[string]interface{}{}
	var questions, users, errorsN, up, down, inTok, outTok, cacheTok, avgMs int64
	db.QueryRow(`SELECT COUNT(*), COUNT(DISTINCT user_id),
			COALESCE(SUM(CASE WHEN COALESCE(error, '') <> '' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN feedback = 'up' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN feedback = 'down' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0), COALESCE(SUM(cache_read_tokens), 0),
			COALESCE(CAST(AVG(CASE WHEN duration_ms > 0 THEN duration_ms END) AS INTEGER), 0)
		FROM ai_chat_log WHERE `+baseWhere, baseArgs...).
		Scan(&questions, &users, &errorsN, &up, &down, &inTok, &outTok, &cacheTok, &avgMs)
	summary["questions"], summary["users"], summary["errors"], summary["up"], summary["down"] = questions, users, errorsN, up, down
	summary["input_tokens"], summary["output_tokens"], summary["cache_read_tokens"], summary["avg_duration_ms"] = inTok, outTok, cacheTok, avgMs

	perDay := []map[string]interface{}{}
	if rows, err := db.Query(`SELECT SUBSTR(created_at, 1, 10) AS day, COUNT(*),
			COALESCE(SUM(CASE WHEN COALESCE(error, '') <> '' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(input_tokens + output_tokens), 0)
		FROM ai_chat_log WHERE `+baseWhere+` GROUP BY SUBSTR(created_at, 1, 10) ORDER BY day`, baseArgs...); err == nil {
		for rows.Next() {
			var day string
			var n, e, t int64
			if rows.Scan(&day, &n, &e, &t) == nil {
				perDay = append(perDay, map[string]interface{}{"date": day, "questions": n, "errors": e, "tokens": t})
			}
		}
		rows.Close()
	}

	perUser := []map[string]interface{}{}
	if rows, err := db.Query(`SELECT COALESCE(user_email, ''), COUNT(*), COALESCE(SUM(input_tokens + output_tokens), 0),
			COALESCE(SUM(CASE WHEN feedback = 'down' THEN 1 ELSE 0 END), 0), MAX(created_at)
		FROM ai_chat_log WHERE `+baseWhere+` GROUP BY COALESCE(user_email, '') ORDER BY COUNT(*) DESC`, baseArgs...); err == nil {
		for rows.Next() {
			var email, last string
			var n, t, d int64
			if rows.Scan(&email, &n, &t, &d, &last) == nil {
				perUser = append(perUser, map[string]interface{}{"email": email, "questions": n, "tokens": t, "down": d, "last": last})
			}
		}
		rows.Close()
	}

	entries := []aiLogEntry{}
	toolUse := map[string]int{}
	if rows, err := db.Query(`SELECT id, COALESCE(created_at, ''), COALESCE(user_email, ''), COALESCE(question, ''), COALESCE(answer, ''),
			COALESCE(tools, '[]'), COALESCE(model, ''), COALESCE(error, ''), COALESCE(input_tokens, 0), COALESCE(output_tokens, 0),
			COALESCE(cache_read_tokens, 0), COALESCE(duration_ms, 0), COALESCE(feedback, '')
		FROM ai_chat_log WHERE `+strings.Join(where, " AND ")+` ORDER BY created_at DESC LIMIT `+strconv.Itoa(limit), args...); err == nil {
		for rows.Next() {
			var e aiLogEntry
			var tools string
			if rows.Scan(&e.ID, &e.CreatedAt, &e.UserEmail, &e.Question, &e.Answer, &tools, &e.Model, &e.Error,
				&e.InputTokens, &e.OutputTokens, &e.CacheReadTokens, &e.DurationMs, &e.Feedback) != nil {
				continue
			}
			if !json.Valid([]byte(tools)) {
				tools = "[]"
			}
			e.Tools = json.RawMessage(tools)
			var calls []aiToolCall
			json.Unmarshal(e.Tools, &calls)
			for _, c := range calls {
				toolUse[c.Name]++
			}
			entries = append(entries, e)
		}
		rows.Close()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"days": days, "since": since, "summary": summary, "per_day": perDay, "per_user": perUser,
		"tool_use": toolUse, "entries": entries,
	})
}
