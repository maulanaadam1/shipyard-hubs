package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"

	"shipyard/db"
)

// The login answer carries the user's roles, like the session does: the menu
// is built from them right after signing in.
func TestLoginReturnsRoles(t *testing.T) {
	t.Setenv("NEXTAUTH_SECRET", "test-secret")
	hash, _ := bcrypt.GenerateFromPassword([]byte("rahasia-uji"), bcrypt.MinCost)
	db.Exec("DELETE FROM profiles WHERE email = 'ppc.uji@example.test'")
	if _, err := db.Exec(`INSERT INTO profiles (id, email, username, password, name, role, roles, extra_roles)
		VALUES ('u-ppc-uji', 'ppc.uji@example.test', 'ppcuji', ?, 'PPC Uji', 'Staff', 'PPC', 'Data Perlu Dicek:edit')`, string(hash)); err != nil {
		t.Fatal(err)
	}
	defer db.Exec("DELETE FROM profiles WHERE email = 'ppc.uji@example.test'")

	rec := httptest.NewRecorder()
	Login(rec, httptest.NewRequest("POST", "/api/auth/login", strings.NewReader(`{"email": "ppcuji", "password": "rahasia-uji"}`)))
	if rec.Code != 200 {
		t.Fatalf("login: %d %s", rec.Code, rec.Body.String())
	}
	var res struct {
		Token string         `json:"token"`
		User  map[string]any `json:"user"`
	}
	json.Unmarshal(rec.Body.Bytes(), &res)
	if res.Token == "" || res.User["roles"] != "PPC" || res.User["extra_roles"] != "Data Perlu Dicek:edit" || res.User["email"] != "ppc.uji@example.test" {
		t.Errorf("login user = %v", res.User)
	}
}
