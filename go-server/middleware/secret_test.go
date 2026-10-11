package middleware

import "testing"

func TestJWTSecretReadsEnvAtCallTime(t *testing.T) {
	t.Setenv("NEXTAUTH_SECRET", "")
	if len(JWTSecret()) != 0 {
		t.Fatal("no built-in fallback secret expected")
	}
	// Simulates godotenv loading .env after package init.
	t.Setenv("NEXTAUTH_SECRET", "loaded-later")
	if string(JWTSecret()) != "loaded-later" {
		t.Fatalf("JWTSecret() = %q", JWTSecret())
	}
}
