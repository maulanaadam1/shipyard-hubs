package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"

	"shipyard/db"
)

var secretKey = func() string {
	if k := os.Getenv("NEXTAUTH_SECRET"); k != "" {
		return k
	}
	return "vivo1234"
}()

// Login handles POST /api/auth/login
func Login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]string{"error": "Invalid request body"})
		return
	}

	body.Email = strings.TrimSpace(body.Email)

	log.Printf("[DEBUG] Login attempt for: %s", body.Email)
	user := db.GetUserByIdentifier(body.Email)
	if user == nil {
		log.Printf("[DEBUG] Login failed: User %s not found", body.Email)
		writeJSON(w, 401, map[string]string{"error": "User tidak ditemukan"})
		return
	}

	pwHash, _ := user["password"].(string)
	if err := bcrypt.CompareHashAndPassword([]byte(pwHash), []byte(body.Password)); err != nil {
		log.Printf("[DEBUG] Login failed: Incorrect password for %s. Error: %v", body.Email, err)
		writeJSON(w, 401, map[string]string{"error": "Password salah"})
		return
	}
	log.Printf("[DEBUG] Login successful for: %s", body.Email)

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"id":       user["id"],
		"email":    user["email"],
		"username": user["username"],
		"name":     user["name"],
		"role":     user["role"],
		"image":    user["avatar_url"],
		"exp":      time.Now().Add(7 * 24 * time.Hour).Unix(),
	})

	tokenStr, err := token.SignedString([]byte(secretKey))
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "Failed to generate token"})
		return
	}

	writeJSON(w, 200, map[string]any{
		"token": tokenStr,
		"user": map[string]any{
			"id":       user["id"],
			"email":    user["email"],
			"username": user["username"],
			"name":     user["name"],
			"role":     user["role"],
			"image":    user["avatar_url"],
		},
	})
}

// GetSession handles GET /api/auth/session
func GetSession(w http.ResponseWriter, r *http.Request) {
	authHeader := r.Header.Get("Authorization")
	if authHeader == "" {
		writeJSON(w, 200, map[string]any{"session": nil})
		return
	}

	tokenStr := ""
	if len(authHeader) > 7 && authHeader[:7] == "Bearer " {
		tokenStr = authHeader[7:]
	}

	supabaseSecret := os.Getenv("SUPABASE_JWT_SECRET")
	key := []byte(secretKey)
	
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		
		// If it's a Supabase-like token or we have a supabase secret, try it
		if supabaseSecret != "" {
			return []byte(supabaseSecret), nil
		}
		return key, nil
	})

	if err != nil || !token.Valid {
		// Try fallback if first attempt failed and we have two keys
		if supabaseSecret != "" {
			token, err = jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
				return key, nil
			})
		}
		
		if err != nil || !token.Valid {
			writeJSON(w, 200, map[string]any{"session": nil})
			return
		}
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		writeJSON(w, 200, map[string]any{"session": nil})
		return
	}

	// Supabase stores email in claims["email"] or claims["user_metadata"]["email"]
	email, _ := claims["email"].(string)
	if email == "" {
		// Try meta
		if meta, ok := claims["user_metadata"].(map[string]any); ok {
			email, _ = meta["email"].(string)
		}
	}
	user := db.GetUserPublicByEmail(email)
	if user == nil {
		writeJSON(w, 200, map[string]any{"session": nil})
		return
	}

	writeJSON(w, 200, map[string]any{
		"session": map[string]any{
			"user": user,
		},
	})
}
