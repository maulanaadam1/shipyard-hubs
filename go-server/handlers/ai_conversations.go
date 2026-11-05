package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"shipyard/db"
	"shipyard/middleware"
)

// AI Asisten conversation history: each user sees their own conversations;
// the messages are the ai_chat_log rows of the conversation.

const aiSuggestionPrefix = "LANJUT:"

// splitSuggestions takes the follow-up line ("LANJUT: a | b | c") off the
// end of an answer and returns the answer and the suggestions.
func splitSuggestions(answer string) (string, []string) {
	suggestions := []string{}
	lines := strings.Split(strings.TrimRight(answer, " \n"), "\n")
	for i := len(lines) - 1; i >= 0 && i >= len(lines)-3; i-- {
		line := strings.TrimSpace(strings.Trim(strings.TrimSpace(lines[i]), "*_`"))
		if !strings.HasPrefix(strings.ToUpper(line), aiSuggestionPrefix) {
			continue
		}
		for _, q := range strings.Split(line[len(aiSuggestionPrefix):], "|") {
			q = strings.Trim(q, " \t\"'<>*_`")
			if q != "" && len([]rune(q)) <= 120 && len(suggestions) < 3 {
				suggestions = append(suggestions, q)
			}
		}
		lines = append(lines[:i], lines[i+1:]...)
		break
	}
	return strings.TrimSpace(strings.Join(lines, "\n")), suggestions
}

var errAIConversationNotFound = errors.New("percakapan tidak ditemukan")

// aiConversationFor returns the conversation a question belongs to: the
// given one when it is the user's, or a new one titled after the question.
func aiConversationFor(claims middleware.UserClaims, id, question string) (string, error) {
	if id != "" {
		var owner string
		db.QueryRow(`SELECT COALESCE(user_id, '') FROM ai_conversations WHERE id = ? AND COALESCE(deleted, false) = false`, id).Scan(&owner)
		if owner == "" || owner != claims.ID {
			return "", errAIConversationNotFound
		}
		return id, nil
	}
	title := strings.Join(strings.Fields(question), " ")
	if r := []rune(title); len(r) > 70 {
		title = string(r[:70]) + "…"
	}
	id = uuid.New().String()
	now := time.Now().Format("2006-01-02 15:04:05")
	if _, err := db.Exec(`INSERT INTO ai_conversations (id, user_id, title, deleted, created_at, updated_at) VALUES (?, ?, ?, false, ?, ?)`,
		id, claims.ID, title, now, now); err != nil {
		return "", err
	}
	return id, nil
}

// GetAIConversations lists the user's conversations, newest first.
func GetAIConversations(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetUserClaims(r)
	list := []map[string]interface{}{}
	rows, err := db.Query(`SELECT c.id, COALESCE(c.title, ''), COALESCE(c.updated_at, ''),
			(SELECT COUNT(*) FROM ai_chat_log l WHERE l.conversation_id = c.id)
		FROM ai_conversations c WHERE c.user_id = ? AND COALESCE(c.deleted, false) = false
		ORDER BY c.updated_at DESC LIMIT 100`, claims.ID)
	if err == nil {
		for rows.Next() {
			var id, title, updated string
			var n int
			if rows.Scan(&id, &title, &updated, &n) == nil && n > 0 {
				list = append(list, map[string]interface{}{"id": id, "title": title, "updated_at": updated, "questions": n})
			}
		}
		rows.Close()
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"conversations": list})
}

// GetAIConversation returns one of the user's conversations with its
// questions and answers.
func GetAIConversation(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetUserClaims(r)
	id := chi.URLParam(r, "id")
	w.Header().Set("Content-Type", "application/json")
	var title, owner string
	db.QueryRow(`SELECT COALESCE(title, ''), COALESCE(user_id, '') FROM ai_conversations WHERE id = ? AND COALESCE(deleted, false) = false`, id).Scan(&title, &owner)
	if owner == "" || owner != claims.ID {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": errAIConversationNotFound.Error()})
		return
	}
	turns := []map[string]interface{}{}
	rows, err := db.Query(`SELECT id, COALESCE(question, ''), COALESCE(answer, ''), COALESCE(tools, '[]'), COALESCE(error, ''),
			COALESCE(feedback, ''), COALESCE(duration_ms, 0), COALESCE(created_at, '')
		FROM ai_chat_log WHERE conversation_id = ? AND user_id = ? ORDER BY created_at, id`, id, claims.ID)
	if err == nil {
		for rows.Next() {
			var logID, question, answer, tools, failure, feedback, created string
			var duration int64
			if rows.Scan(&logID, &question, &answer, &tools, &failure, &feedback, &duration, &created) != nil {
				continue
			}
			if !json.Valid([]byte(tools)) {
				tools = "[]"
			}
			turns = append(turns, map[string]interface{}{
				"id": logID, "question": question, "answer": answer, "tool_calls": json.RawMessage(tools), "error": failure,
				"feedback": feedback, "duration_ms": duration, "created_at": created,
			})
		}
		rows.Close()
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"id": id, "title": title, "turns": turns})
}

// DeleteAIConversation hides one of the user's conversations from their
// history (the Admin log keeps the questions).
func DeleteAIConversation(w http.ResponseWriter, r *http.Request) {
	claims, _ := middleware.GetUserClaims(r)
	w.Header().Set("Content-Type", "application/json")
	res, err := db.Exec(`UPDATE ai_conversations SET deleted = true WHERE id = ? AND user_id = ?`, chi.URLParam(r, "id"), claims.ID)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]string{"error": errAIConversationNotFound.Error()})
		return
	}
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
