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
	UserName        string          `json:"user_name"` // profile name, or the name a demo guest typed
	Guest           bool            `json:"guest"`     // asked from the public demo page
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
// Query: days (default 30), user (email), who (all|staff|guest: demo page
// visitors), filter (all|errors|down|up), q, page, limit (default 50).
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
	switch q.Get("who") {
	case "guest":
		where = append(where, "user_id LIKE ?")
		args = append(args, aiShareGuestPrefix+"%")
	case "staff":
		where = append(where, "user_id NOT LIKE ?")
		args = append(args, aiShareGuestPrefix+"%")
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
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	names := aiLogNames()

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
	if rows, err := db.Query(`SELECT COALESCE(user_email, ''), COALESCE(MAX(user_id), ''), COUNT(*), COALESCE(SUM(input_tokens + output_tokens), 0),
			COALESCE(SUM(CASE WHEN feedback = 'down' THEN 1 ELSE 0 END), 0), MAX(created_at)
		FROM ai_chat_log WHERE `+baseWhere+` GROUP BY COALESCE(user_email, '') ORDER BY COUNT(*) DESC`, baseArgs...); err == nil {
		for rows.Next() {
			var email, userID, last string
			var n, t, d int64
			if rows.Scan(&email, &userID, &n, &t, &d, &last) == nil {
				perUser = append(perUser, map[string]interface{}{"email": email, "name": names[userID], "guest": strings.HasPrefix(userID, aiShareGuestPrefix),
					"questions": n, "tokens": t, "down": d, "last": last})
			}
		}
		rows.Close()
	}

	// Data the AI used over the period (and user), not only on this page.
	toolUse := map[string]int{}
	if rows, err := db.Query(`SELECT COALESCE(tools, '[]') FROM ai_chat_log WHERE `+baseWhere, baseArgs...); err == nil {
		for rows.Next() {
			var tools string
			var calls []aiToolCall
			if rows.Scan(&tools) == nil && json.Unmarshal([]byte(tools), &calls) == nil {
				for _, c := range calls {
					toolUse[c.Name]++
				}
			}
		}
		rows.Close()
	}

	var total int
	db.QueryRow(`SELECT COUNT(*) FROM ai_chat_log WHERE `+strings.Join(where, " AND "), args...).Scan(&total)

	entries := []aiLogEntry{}
	if rows, err := db.Query(`SELECT id, COALESCE(created_at, ''), COALESCE(user_id, ''), COALESCE(user_email, ''), COALESCE(question, ''), COALESCE(answer, ''),
			COALESCE(tools, '[]'), COALESCE(model, ''), COALESCE(error, ''), COALESCE(input_tokens, 0), COALESCE(output_tokens, 0),
			COALESCE(cache_read_tokens, 0), COALESCE(duration_ms, 0), COALESCE(feedback, '')
		FROM ai_chat_log WHERE `+strings.Join(where, " AND ")+` ORDER BY created_at DESC LIMIT `+strconv.Itoa(limit)+
		` OFFSET `+strconv.Itoa((page-1)*limit), args...); err == nil {
		for rows.Next() {
			var e aiLogEntry
			var tools, userID string
			if rows.Scan(&e.ID, &e.CreatedAt, &userID, &e.UserEmail, &e.Question, &e.Answer, &tools, &e.Model, &e.Error,
				&e.InputTokens, &e.OutputTokens, &e.CacheReadTokens, &e.DurationMs, &e.Feedback) != nil {
				continue
			}
			if !json.Valid([]byte(tools)) {
				tools = "[]"
			}
			e.Tools = json.RawMessage(tools)
			e.UserName, e.Guest = names[userID], strings.HasPrefix(userID, aiShareGuestPrefix)
			entries = append(entries, e)
		}
		rows.Close()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"days": days, "since": since, "summary": summary, "per_day": perDay, "per_user": perUser,
		"tool_use": toolUse, "entries": entries, "total": total, "page": page, "limit": limit,
	})
}

// aiLogNames maps who asked to a name: ShipHub users from their profile,
// demo page guests from the name they typed.
func aiLogNames() map[string]string {
	names := map[string]string{}
	for _, q := range []string{`SELECT id, COALESCE(name, '') FROM profiles`, `SELECT id, COALESCE(name, '') FROM ai_share_guests`} {
		rows, err := db.Query(q)
		if err != nil {
			continue
		}
		for rows.Next() {
			var id, name string
			if rows.Scan(&id, &name) == nil && strings.TrimSpace(name) != "" {
				names[id] = strings.TrimSpace(name)
			}
		}
		rows.Close()
	}
	return names
}
