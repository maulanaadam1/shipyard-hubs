package middleware

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const UserClaimsKey contextKey = "userClaims"

// JWTSecret returns the HMAC key for session tokens. It is read on every call
// (not at package init) so values loaded from .env by godotenv in main are
// seen; main refuses to start when it is empty.
func JWTSecret() []byte {
	return []byte(os.Getenv("NEXTAUTH_SECRET"))
}

// UserClaims holds the parsed JWT claims for the current request
type UserClaims struct {
	ID    string
	Email string
	Name  string
	Role  string
	// Kind is empty for a signed-in user. KindAIShareGuest marks a visitor of
	// the public AI Assistant share page, who is not a ShipHub user.
	Kind string
}

const KindAIShareGuest = "ai_share"

// ParseBearer validates the request's Bearer JWT and returns its claims.
func ParseBearer(r *http.Request) (UserClaims, bool) {
	authHeader := r.Header.Get("Authorization")
	if len(authHeader) <= 7 || authHeader[:7] != "Bearer " {
		return UserClaims{}, false
	}
	token, err := jwt.Parse(authHeader[7:], func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return JWTSecret(), nil
	})
	if err != nil || !token.Valid {
		return UserClaims{}, false
	}
	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return UserClaims{}, false
	}
	kind, _ := claims["kind"].(string)
	return UserClaims{
		ID:    fmt.Sprintf("%v", claims["id"]),
		Email: fmt.Sprintf("%v", claims["email"]),
		Name:  fmt.Sprintf("%v", claims["name"]),
		Role:  fmt.Sprintf("%v", claims["role"]),
		Kind:  kind,
	}, true
}

// WithClaims stores claims in the request context.
func WithClaims(r *http.Request, c UserClaims) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), UserClaimsKey, c))
}

// RequireAuth is middleware that validates JWT and injects user claims into
// context. Guest tokens of the AI share page are refused: they only open the
// share routes.
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userClaims, ok := ParseBearer(r)
		if !ok || userClaims.Kind != "" {
			http.Error(w, `{"error":"Unauthorized: invalid token"}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, WithClaims(r, userClaims))
	})
}

// RequireRole returns middleware that checks if the user has one of the required roles
func RequireRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := r.Context().Value(UserClaimsKey).(UserClaims)
			if !ok {
				http.Error(w, `{"error":"Forbidden: no user context"}`, http.StatusForbidden)
				return
			}

			for _, role := range roles {
				if claims.Role == role {
					next.ServeHTTP(w, r)
					return
				}
			}

			http.Error(w, `{"error":"Forbidden: insufficient role"}`, http.StatusForbidden)
		})
	}
}

// GetUserClaims extracts the user claims from the request context
func GetUserClaims(r *http.Request) (UserClaims, bool) {
	claims, ok := r.Context().Value(UserClaimsKey).(UserClaims)
	return claims, ok
}

// Logger is middleware that logs each request with method, path, status, duration, and user
func Logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		wrapped := &responseWriter{ResponseWriter: w, status: 200}

		next.ServeHTTP(wrapped, r)

		user := "anonymous"
		if claims, ok := r.Context().Value(UserClaimsKey).(UserClaims); ok && claims.Email != "" {
			user = claims.Email
		}

		log.Printf("[%s] %s %s | %d | %s | user: %s",
			r.Method,
			r.URL.Path,
			r.URL.RawQuery,
			wrapped.status,
			time.Since(start).Round(time.Millisecond),
			user,
		)
	})
}

// AuditLog logs write operations (POST, PUT, DELETE) to stderr for audit trail
func AuditLog(next http.Handler) http.Handler {
	auditLogger := log.New(os.Stderr, "[AUDIT] ", log.LstdFlags)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" || r.Method == "PUT" || r.Method == "DELETE" {
			user := "anonymous"
			if claims, ok := r.Context().Value(UserClaimsKey).(UserClaims); ok {
				user = fmt.Sprintf("%s (%s)", claims.Name, claims.Role)
			}
			auditLogger.Printf("user=%s method=%s path=%s ip=%s", user, r.Method, r.URL.Path, r.RemoteAddr)
		}
		next.ServeHTTP(w, r)
	})
}

// responseWriter wraps http.ResponseWriter to capture status code
type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

// Flush passes streaming flushes (server-sent events) through.
func (rw *responseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
