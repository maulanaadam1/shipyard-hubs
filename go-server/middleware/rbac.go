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

var secretKey = func() string {
	if k := os.Getenv("NEXTAUTH_SECRET"); k != "" {
		return k
	}
	return "vivo1234"
}()

// UserClaims holds the parsed JWT claims for the current request
type UserClaims struct {
	ID    string
	Email string
	Name  string
	Role  string
}

// RequireAuth is middleware that validates JWT and injects user claims into context
func RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" || len(authHeader) <= 7 || authHeader[:7] != "Bearer " {
			http.Error(w, `{"error":"Unauthorized: missing token"}`, http.StatusUnauthorized)
			return
		}

		tokenStr := authHeader[7:]
		token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			return []byte(secretKey), nil
		})

		if err != nil || !token.Valid {
			http.Error(w, `{"error":"Unauthorized: invalid token"}`, http.StatusUnauthorized)
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			http.Error(w, `{"error":"Unauthorized: invalid claims"}`, http.StatusUnauthorized)
			return
		}

		userClaims := UserClaims{
			ID:    fmt.Sprintf("%v", claims["id"]),
			Email: fmt.Sprintf("%v", claims["email"]),
			Name:  fmt.Sprintf("%v", claims["name"]),
			Role:  fmt.Sprintf("%v", claims["role"]),
		}

		ctx := context.WithValue(r.Context(), UserClaimsKey, userClaims)
		next.ServeHTTP(w, r.WithContext(ctx))
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
