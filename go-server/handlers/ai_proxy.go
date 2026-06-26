package handlers

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"shipyard/db"
)

func formatNum(n float64) string {
	s := fmt.Sprintf("%.0f", n)
	var parts []string
	for i := len(s); i > 0; i -= 3 {
		start := i - 3
		if start < 0 {
			start = 0
		}
		parts = append([]string{s[start:i]}, parts...)
	}
	return strings.Join(parts, ".")
}

// enhancePayloadWithDatabaseRAG scans the user question and injects live aggregate truth
// from the 3 flattened AI PostgreSQL tables into the LLM system prompt.
func enhancePayloadWithDatabaseRAG(bodyBytes []byte) []byte {
	var reqBody struct {
		Model    string `json:"model"`
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
		MaxTokens   int     `json:"max_tokens"`
		Temperature float64 `json:"temperature"`
		Stream      bool    `json:"stream"`
	}

	if err := json.Unmarshal(bodyBytes, &reqBody); err != nil || len(reqBody.Messages) == 0 {
		return bodyBytes
	}

	userQuestion := ""
	for i := len(reqBody.Messages) - 1; i >= 0; i-- {
		if reqBody.Messages[i].Role == "user" {
			userQuestion = reqBody.Messages[i].Content
			break
		}
	}

	var woCount int
	var woTotalCost float64
	_ = db.QueryRow("SELECT COUNT(*), COALESCE(SUM(total_cost_contract), 0) FROM ai_work_orders").Scan(&woCount, &woTotalCost)

	var topShips []string
	rowsS, _ := db.Query("SELECT ship_name, COUNT(*), COALESCE(SUM(total_cost_contract), 0) FROM ai_work_orders GROUP BY ship_name ORDER BY 3 DESC LIMIT 10")
	if rowsS != nil {
		for rowsS.Next() {
			var s string
			var c int
			var sum float64
			if rowsS.Scan(&s, &c, &sum) == nil {
				topShips = append(topShips, fmt.Sprintf("%s (%d SPK, Rp %s)", s, c, formatNum(sum)))
			}
		}
		rowsS.Close()
	}

	var topVendors []string
	rowsV, _ := db.Query("SELECT vendor_name, COUNT(*), COALESCE(SUM(total_cost_contract), 0) FROM ai_work_orders GROUP BY vendor_name ORDER BY 3 DESC LIMIT 10")
	if rowsV != nil {
		for rowsV.Next() {
			var v string
			var c int
			var sum float64
			if rowsV.Scan(&v, &c, &sum) == nil {
				topVendors = append(topVendors, fmt.Sprintf("%s (%d SPK, Rp %s)", v, c, formatNum(sum)))
			}
		}
		rowsV.Close()
	}

	words := strings.Fields(strings.ToLower(userQuestion))
	var searchTerms []string
	stopWords := map[string]bool{"berapa": true, "total": true, "untuk": true, "dalam": true, "pada": true, "dari": true, "adalah": true, "tentang": true, "semua": true, "seluruh": true, "tampilkan": true, "berikan": true, "coba": true, "hitungkan": true, "rincian": true, "daftar": true, "tahun": true, "bulan": true, "yang": true, "sama": true, "dan": true, "atau": true, "dengan": true}
	for _, w := range words {
		clean := strings.Trim(w, ".,?!\"'()[]{}:;")
		if len(clean) > 2 && !stopWords[clean] {
			searchTerms = append(searchTerms, clean)
		}
	}

	var breakdowns []string
	var materials []string
	for _, term := range searchTerms {
		likeTerm := "%" + term + "%"
		rb, _ := db.Query(db.FormatQuery("SELECT ship_name, vendor_name, label, volume, unit, total_price, status_approval, approval_date FROM ai_wo_breakdowns WHERE label ILIKE ? OR ship_name ILIKE ? OR vendor_name ILIKE ? LIMIT 8"), likeTerm, likeTerm, likeTerm)
		if rb != nil {
			for rb.Next() {
				var s, v, l, u, st, ad string
				var vol, tp float64
				if rb.Scan(&s, &v, &l, &vol, &u, &tp, &st, &ad) == nil {
					breakdowns = append(breakdowns, fmt.Sprintf("- [Kapal %s | Vendor %s]: %s (Vol: %.1f %s | Rp %s | Status: %s tgl %s)", s, v, l, vol, u, formatNum(tp), st, ad))
				}
			}
			rb.Close()
		}

		rm, _ := db.Query(db.FormatQuery("SELECT ship_name, vendor_name, component_name, qty_delivered, unit, total_price, delivery_date FROM ai_material_deliveries WHERE component_name ILIKE ? OR ship_name ILIKE ? OR vendor_name ILIKE ? LIMIT 8"), likeTerm, likeTerm, likeTerm)
		if rm != nil {
			for rm.Next() {
				var s, v, c, u, dd string
				var qty, tp float64
				if rm.Scan(&s, &v, &c, &qty, &u, &tp, &dd) == nil {
					materials = append(materials, fmt.Sprintf("- [Kapal %s | Vendor %s]: %s (Qty: %.1f %s | Rp %s | Tgl Tiba: %s)", s, v, c, qty, u, formatNum(tp), dd))
				}
			}
			rm.Close()
		}
	}

	bStr := "Tidak ada item reparasi spesifik yang cocok."
	if len(breakdowns) > 0 {
		bStr = strings.Join(breakdowns, "\n")
	}
	mStr := "Tidak ada pengiriman material spesifik yang cocok."
	if len(materials) > 0 {
		mStr = strings.Join(materials, "\n")
	}

	dbInjection := fmt.Sprintf(`
=== DATA HISTORIS RESMI GALANGAN DARI POSTGRESQL (ONE BIG TABLE ARCHITECTURE) ===
Total Seluruh Kontrak SPK: %d berkas
Akumulasi Biaya Kontrak Keseluruhan: Rp %s

Top 10 Kapal dengan Biaya Terbesar:
- %s

Top 10 Vendor Rekanan Terbesar:
- %s

=== TEMUAN DATA SPESIFIK UNTUK PERTANYAAN USER ("%s") ===
Rincian Pekerjaan Terkait:
%s

Logistik Pengiriman Barang/Material Terkait:
%s

INSTRUKSI KRUSIAL LLM:
1. Data di atas diambil secara real-time langsung dari mesin database PostgreSQL galangan (bukan dari tampilan tabel browser).
2. Gunakan angka pasti di atas sebagai dasar kebenaran mutlak. Jangan berhalusinasi atau mengarang nominal!
`, woCount, formatNum(woTotalCost), strings.Join(topShips, "\n- "), strings.Join(topVendors, "\n- "), userQuestion, bStr, mStr)

	// Inject into the system message
	for i := range reqBody.Messages {
		if reqBody.Messages[i].Role == "system" {
			reqBody.Messages[i].Content = dbInjection + "\n\n" + reqBody.Messages[i].Content
			break
		}
	}

	enhanced, err := json.Marshal(reqBody)
	if err != nil {
		return bodyBytes
	}
	return enhanced
}

// PostSumopodProxy proxies chat completion requests to Sumopod API with live Database RAG.
func PostSumopodProxy(w http.ResponseWriter, r *http.Request) {
	apiKey := os.Getenv("SUMOPOD_API_KEY")
	if apiKey == "" {
		http.Error(w, `{"error": {"message": "SUMOPOD_API_KEY is not configured on the server"}}`, http.StatusInternalServerError)
		return
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, `{"error": {"message": "Failed to read request body"}}`, http.StatusBadRequest)
		return
	}

	enhancedBody := enhancePayloadWithDatabaseRAG(bodyBytes)

	req, err := http.NewRequest("POST", "https://ai.sumopod.com/v1/chat/completions", bytes.NewBuffer(enhancedBody))
	if err != nil {
		http.Error(w, `{"error": {"message": "Failed to create request to Sumopod"}}`, http.StatusInternalServerError)
		return
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	tr := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}
	client := &http.Client{
		Transport: tr,
		Timeout:   60 * time.Second,
	}

	resp, err := client.Do(req)
	if err != nil {
		log.Printf("Sumopod API Error: %v", err)
		http.Error(w, `{"error": {"message": "Failed to connect to Sumopod API: `+err.Error()+`"}}`, http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for k, v := range resp.Header {
		w.Header()[k] = v
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

// PostOllamaProxy proxies chat requests to local Ollama with live Database RAG.
func PostOllamaProxy(w http.ResponseWriter, r *http.Request) {
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, `{"error": {"message": "Failed to read request body"}}`, http.StatusBadRequest)
		return
	}

	enhancedBody := enhancePayloadWithDatabaseRAG(bodyBytes)

	req, err := http.NewRequest("POST", "http://localhost:11434/api/chat", bytes.NewBuffer(enhancedBody))
	if err != nil {
		http.Error(w, `{"error": {"message": "Failed to create request to Ollama"}}`, http.StatusInternalServerError)
		return
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, `{"error": {"message": "Gagal terhubung ke Ollama lokal: `+err.Error()+`"}}`, http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for k, v := range resp.Header {
		w.Header()[k] = v
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
