package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/rs/cors"

	"shipyard/db"
	"shipyard/handlers"
	appMiddleware "shipyard/middleware"
	"shipyard/workers"

	"github.com/joho/godotenv"
)

func main() {
	// Attempt to load .env file, ignore if not found
	_ = godotenv.Load()

	db.Init()
	db.InitRedis()
	workers.StartSyncWorker()

	// Jalankan background AI ETL backfill secara otomatis
	go workers.RunAIEtlBackfill()

	r := chi.NewRouter()
	r.Use(chiMiddleware.Recoverer)
	r.Use(appMiddleware.Logger) // custom logger with user info

	c := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type", "Authorization"},
	})
	r.Use(c.Handler)

	// Public routes (no auth required)
	r.Post("/api/auth/login", handlers.Login)
	r.Get("/api/auth/session", handlers.GetSession)
	
	// AI Proxy Routes (with live PostgreSQL Database RAG)
	r.Post("/api/chat/sumopod", handlers.PostSumopodProxy)
	r.Post("/api/chat/ollama", handlers.PostOllamaProxy)

	// TEMPORARY DEBUG ROUTE
	r.Get("/api/debug/users", func(w http.ResponseWriter, r *http.Request) {
		query := "SELECT id, email, username, password, name, role, jabatan, city, branch, department, whatsapp, avatar_url, roles, extra_roles FROM profiles WHERE email = 'admin@shipyard.local'"
		var id, emailVal, password, name, role string
		var username, jabatan, city, branch, department, whatsapp, avatarURL, roles, extraRoles *string
		
		err := db.QueryRow(query).Scan(&id, &emailVal, &username, &password, &name, &role, &jabatan, &city, &branch, &department, &whatsapp, &avatarURL, &roles, &extraRoles)
		
		if err != nil {
			w.Write([]byte(`{"scan_error_full": "` + err.Error() + `"}`))
			return
		}
		
		w.Write([]byte(`{"success": "Query worked perfectly. User exists and scan succeeded."}`))
	})

	// Protected routes (require valid JWT)
	r.Group(func(r chi.Router) {
		r.Use(appMiddleware.RequireAuth)
		r.Use(appMiddleware.AuditLog)

		// Generic CRUD — Staff: read only, Admin/Manager: write
		r.Get("/api/data/{table}", handlers.GetData)
		r.Get("/api/stats", handlers.GetStats)
		r.Get("/api/projects/years", handlers.GetProjectYearsStats)

		// Cache Read (Redis/Fallback)
		r.Get("/api/cache/{id}", handlers.GetCacheData)

		// Proxy for single Work Order Detail
		r.Get("/api/work-orders/{id}/detail", handlers.GetWorkOrderDetail)
		r.Post("/api/work-orders/{id}/sync", handlers.SyncWorkOrderDetail)
		r.Get("/api/work-orders/pending-approvals", handlers.GetPendingApprovals)
		r.Post("/api/work-orders/bulk-pending-approvals", handlers.PostBulkPendingApprovals)

		// System endpoints
		r.Get("/api/system/run-ai-etl", handlers.RunAIEtl)

		// Export (all authenticated roles)
		r.Get("/api/export/{table}/csv", handlers.ExportCSV)
		r.Get("/api/export/{table}/json", handlers.ExportJSON)

		// Manual Sync Trigger
		r.Post("/api/sync/trigger", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				ID string `json:"id"`
			}
			json.NewDecoder(req.Body).Decode(&body)
			
			workers.RunSyncJob(true, body.ID)
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"success": true, "message": "Sync triggered successfully"}`))
		})

		// Write operations — permissions handled inside handlers based on role_permissions table
		r.Group(func(r chi.Router) {
			r.Use(appMiddleware.RequireRole("Admin", "Manager", "Staff"))
			r.Post("/api/data/{table}", handlers.PostData)
			r.Put("/api/data/{table}", handlers.PutData)
			r.Delete("/api/data/{table}", handlers.DeleteData)

			// Bulk import — Admin/Manager only
			r.Post("/api/import/{table}/csv", handlers.ImportCSV)
		})
	})

	// Serve static frontend
	distDir := "./dist"
	if _, err := os.Stat(distDir); os.IsNotExist(err) {
		distDir = "../dist" // Try parent if running from go-server/
	}

	if _, err := os.Stat(distDir); err == nil {
		fs := http.FileServer(http.Dir(distDir))
		r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
			path := req.URL.Path
			
			// If file exists, serve it
			if _, err := os.Stat(distDir + path); err == nil {
				// Assets (JS, CSS, images) can be cached for a long time since they have hashes
				if strings.Contains(path, "/assets/") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				} else if strings.HasSuffix(path, "sw.js") || strings.HasSuffix(path, "manifest.json") {
					// Service worker and manifest should never be cached long-term
					w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
				}
				fs.ServeHTTP(w, req)
				return
			}
			
			// For SPA routing: if path doesn't have an extension (like .js, .css), 
			// it's likely a frontend route, serve index.html.
			if !strings.Contains(path, ".") {
				// CRITICAL: Prevent caching of index.html so browser always gets latest asset hashes
				w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
				w.Header().Set("Pragma", "no-cache")
				w.Header().Set("Expires", "0")
				http.ServeFile(w, req, distDir+"/index.html")
				return
			}
			
			http.NotFound(w, req)
		})
		log.Printf("Serving static files from: %s", distDir)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	log.Printf("🚢 Shipyard Hub server started on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

