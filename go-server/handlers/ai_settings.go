package handlers

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"shipyard/db"
	"shipyard/middleware"
)

// AI settings (provider, model, API key, limits) are kept in the database and
// edited in the Pengaturan AI page, not in server environment variables. The
// API key is encrypted at rest (AES-GCM with a key derived from the server's
// NEXTAUTH_SECRET) and never sent back to the browser.

// RequireAdmin lets only Admins through: the AI settings hold a paid API key
// and decide where company data is sent, so they are not a role permission.
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isAdminRequest(r) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			json.NewEncoder(w).Encode(map[string]string{"error": "hanya Admin yang bisa mengubah Pengaturan AI"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

type aiSettings struct {
	Provider   string `json:"provider"`
	BaseURL    string `json:"base_url"`
	Model      string `json:"model"`
	MaxTokens  int    `json:"max_tokens"`
	DailyLimit int    `json:"daily_limit"`
	Enabled    bool   `json:"enabled"`
	APIKey     string `json:"-"`
	KeyBroken  bool   `json:"-"` // stored but not decryptable (server secret changed)
	UpdatedBy  string `json:"updated_by"`
	UpdatedAt  string `json:"updated_at"`
}

func secretKey() ([]byte, error) {
	secret := strings.TrimSpace(string(middleware.JWTSecret()))
	if secret == "" {
		return nil, errors.New("NEXTAUTH_SECRET server kosong; API key tidak bisa disimpan aman")
	}
	sum := sha256.Sum256([]byte("shiphub-ai-settings:" + secret))
	return sum[:], nil
}

func encryptSecret(plain string) (string, error) {
	key, err := secretKey()
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(gcm.Seal(nonce, nonce, []byte(plain), nil)), nil
}

func decryptSecret(enc string) (string, error) {
	key, err := secretKey()
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return "", err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("data terenkripsi rusak")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], nil)
	return string(plain), err
}

// loadAISettings reads the settings; defaults when none are saved yet.
func loadAISettings() aiSettings {
	s := aiSettings{Provider: aiProviderAnthropic, DailyLimit: 50}
	var enc string
	db.QueryRow(`SELECT COALESCE(provider, ''), COALESCE(base_url, ''), COALESCE(model, ''), COALESCE(api_key_enc, ''),
			COALESCE(max_tokens, 0), COALESCE(daily_limit, 50), COALESCE(enabled, false), COALESCE(updated_by, ''), COALESCE(updated_at, '')
		FROM ai_settings WHERE id = 'default'`).
		Scan(&s.Provider, &s.BaseURL, &s.Model, &enc, &s.MaxTokens, &s.DailyLimit, &s.Enabled, &s.UpdatedBy, &s.UpdatedAt)
	if s.Provider == "" {
		s.Provider = aiProviderAnthropic
	}
	if enc != "" {
		if key, err := decryptSecret(enc); err == nil {
			s.APIKey = key
		} else {
			s.KeyBroken = true
		}
	}
	return s
}

func saveAISettings(s aiSettings, keyEnc *string) error {
	var exists int
	db.QueryRow(`SELECT COUNT(*) FROM ai_settings WHERE id = 'default'`).Scan(&exists)
	now := time.Now().Format("2006-01-02 15:04:05")
	if exists == 0 {
		enc := ""
		if keyEnc != nil {
			enc = *keyEnc
		}
		_, err := db.Exec(`INSERT INTO ai_settings (id, provider, base_url, model, api_key_enc, max_tokens, daily_limit, enabled, updated_by, updated_at)
			VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)`, s.Provider, s.BaseURL, s.Model, enc, s.MaxTokens, s.DailyLimit, s.Enabled, s.UpdatedBy, now)
		return err
	}
	if keyEnc != nil {
		if _, err := db.Exec(`UPDATE ai_settings SET api_key_enc = ? WHERE id = 'default'`, *keyEnc); err != nil {
			return err
		}
	}
	_, err := db.Exec(`UPDATE ai_settings SET provider = ?, base_url = ?, model = ?, max_tokens = ?, daily_limit = ?, enabled = ?, updated_by = ?, updated_at = ?
		WHERE id = 'default'`, s.Provider, s.BaseURL, s.Model, s.MaxTokens, s.DailyLimit, s.Enabled, s.UpdatedBy, now)
	return err
}

// aiConfig turns the saved settings into the provider configuration, and
// whether the assistant is on (switched on and complete).
func aiConfig() (aiProviderConfig, bool) {
	s := loadAISettings()
	cfg := aiProviderConfig{Provider: s.Provider, Model: s.Model, BaseURL: strings.TrimRight(s.BaseURL, "/"), APIKey: s.APIKey, MaxTokens: s.MaxTokens}
	ready := false
	switch cfg.Provider {
	case aiProviderAnthropic:
		if cfg.Model == "" {
			cfg.Model = aiDefaultModel
		}
		ready = cfg.APIKey != ""
	case aiProviderOpenAI:
		explicitURL := cfg.BaseURL != ""
		if !explicitURL {
			cfg.BaseURL = "https://api.openai.com/v1"
		}
		// A key is not needed by a local server (Ollama, vLLM).
		ready = cfg.Model != "" && (cfg.APIKey != "" || explicitURL)
	}
	return cfg, s.Enabled && ready
}

func keyHint(key string) string {
	if len(key) < 8 {
		return ""
	}
	return "…" + key[len(key)-4:]
}

func aiSettingsView(s aiSettings) map[string]interface{} {
	_, ready := aiConfig()
	return map[string]interface{}{
		"provider": s.Provider, "base_url": s.BaseURL, "model": s.Model, "max_tokens": s.MaxTokens, "daily_limit": s.DailyLimit,
		"enabled": s.Enabled, "active": ready, "api_key_set": s.APIKey != "", "api_key_hint": keyHint(s.APIKey), "api_key_broken": s.KeyBroken,
		"updated_by": s.UpdatedBy, "updated_at": s.UpdatedAt, "default_model": aiDefaultModel,
	}
}

// GetAISettings returns the settings without the API key.
func GetAISettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(aiSettingsView(loadAISettings()))
}

// PutAISettings saves the settings. An empty api_key keeps the stored key;
// clear_api_key removes it.
func PutAISettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fail := func(msg string) {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": msg})
	}
	var in struct {
		Provider    string `json:"provider"`
		BaseURL     string `json:"base_url"`
		Model       string `json:"model"`
		MaxTokens   int    `json:"max_tokens"`
		DailyLimit  int    `json:"daily_limit"`
		Enabled     bool   `json:"enabled"`
		APIKey      string `json:"api_key"`
		ClearAPIKey bool   `json:"clear_api_key"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		fail("data pengaturan tidak valid")
		return
	}
	s := aiSettings{
		Provider: strings.ToLower(strings.TrimSpace(in.Provider)), BaseURL: strings.TrimRight(strings.TrimSpace(in.BaseURL), "/"),
		Model: strings.TrimSpace(in.Model), MaxTokens: in.MaxTokens, DailyLimit: in.DailyLimit, Enabled: in.Enabled,
	}
	if s.Provider != aiProviderAnthropic && s.Provider != aiProviderOpenAI {
		fail("provider harus anthropic atau openai")
		return
	}
	if s.BaseURL != "" {
		if u, err := url.Parse(s.BaseURL); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			fail("Base URL harus alamat http:// atau https:// yang lengkap")
			return
		}
	}
	if s.MaxTokens < 0 || s.MaxTokens > 128000 {
		fail("max tokens antara 0 (bawaan) dan 128000")
		return
	}
	if s.DailyLimit < 1 || s.DailyLimit > 10000 {
		fail("batas pertanyaan per hari antara 1 dan 10000")
		return
	}
	if s.Provider == aiProviderOpenAI && s.Enabled && s.Model == "" {
		fail("isi nama model untuk provider OpenAI-compatible")
		return
	}
	if claims, ok := middleware.GetUserClaims(r); ok {
		s.UpdatedBy = claims.Email
	}
	var keyEnc *string
	switch {
	case in.ClearAPIKey:
		empty := ""
		keyEnc = &empty
	case strings.TrimSpace(in.APIKey) != "":
		enc, err := encryptSecret(strings.TrimSpace(in.APIKey))
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		keyEnc = &enc
	}
	if err := saveAISettings(s, keyEnc); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	json.NewEncoder(w).Encode(aiSettingsView(loadAISettings()))
}

// TestAISettings sends one short test message (no ShipHub data, no tools) to
// the saved provider and reports the reply, whether or not the assistant is
// switched on.
func TestAISettings(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	cfg, _ := aiConfig()
	s := loadAISettings()
	if s.KeyBroken {
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": "API key tersimpan tidak bisa dibuka (kunci rahasia server berubah); isi ulang API key."})
		return
	}
	session, err := newAISession(cfg, "Ini tes koneksi.", "Balas hanya dengan kata: OK", []aiChatMessage{{Role: "user", Content: "Tes koneksi. Balas hanya dengan kata: OK"}}, nil)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	start := time.Now()
	turn, err := session.Next(ctx, nil)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]interface{}{"ok": false, "error": err.Error(), "provider": cfg.Provider, "model": cfg.Model})
		return
	}
	json.NewEncoder(w).Encode(map[string]interface{}{"ok": true, "reply": turn.Text, "provider": cfg.Provider, "model": cfg.Model,
		"latency_ms": time.Since(start).Milliseconds(), "usage": turn.Usage})
}
