package handlers

import (
	"bytes"
	"crypto/tls"
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

// PostSumopodProxy proxies chat completion requests to the Sumopod API securely
// without exposing the API key to the frontend.
func PostSumopodProxy(w http.ResponseWriter, r *http.Request) {
	apiKey := os.Getenv("SUMOPOD_API_KEY")
	if apiKey == "" {
		http.Error(w, `{"error": {"message": "SUMOPOD_API_KEY is not configured on the server"}}`, http.StatusInternalServerError)
		return
	}

	// Read the request body sent from the frontend
	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, `{"error": {"message": "Failed to read request body"}}`, http.StatusBadRequest)
		return
	}

	// Create a new request to Sumopod API
	req, err := http.NewRequest("POST", "https://ai.sumopod.com/v1/chat/completions", bytes.NewBuffer(bodyBytes))
	if err != nil {
		http.Error(w, `{"error": {"message": "Failed to create request to Sumopod"}}`, http.StatusInternalServerError)
		return
	}

	// Set headers
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	// Execute the request with timeout and relaxed TLS (for local Windows dev)
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

	// Forward the response headers
	for k, v := range resp.Header {
		w.Header()[k] = v
	}
	w.WriteHeader(resp.StatusCode)

	// Forward the response body
	io.Copy(w, resp.Body)
}
