package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

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

	// Session tokens are signed with this; never fall back to a built-in value.
	// If it is missing, use a random per-process secret instead of refusing to
	// start: still unforgeable, but every restart signs all users out.
	if os.Getenv("NEXTAUTH_SECRET") == "" {
		buf := make([]byte, 32)
		if _, err := rand.Read(buf); err != nil {
			log.Fatalf("NEXTAUTH_SECRET is not set and no random secret could be generated: %v", err)
		}
		os.Setenv("NEXTAUTH_SECRET", hex.EncodeToString(buf))
		log.Println("WARNING: NEXTAUTH_SECRET is not set; using a random secret for this process. " +
			"Users are signed out on every restart. Set NEXTAUTH_SECRET (e.g. `openssl rand -hex 32`).")
	}

	db.Init()
	db.InitRedis()

	// Each WO list sync (scheduled or manual) upserts the changed summary rows.
	workers.ListProcessors["WorkOrders"] = handlers.ProcessWorkOrderList

	// DISABLE_WORKERS=true runs only the API, e.g. a dev machine pointed at the
	// production database while the production server runs the workers.
	if os.Getenv("DISABLE_WORKERS") == "true" {
		log.Println("Background workers disabled (DISABLE_WORKERS=true)")
	} else {
		workers.StartSyncWorker()
		handlers.StartWorkOrderDetailWorker()

		// Jalankan background AI ETL backfill secara otomatis
		go workers.RunAIEtlBackfill()
	}

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
		r.Get("/api/projects/wo-summary", handlers.GetProjectWorkOrderSummaries)
		r.Get("/api/projects/wo-summary/detail", handlers.GetProjectWorkOrderDetail)
		// Dashboard reads: cached for 60s, dropped on any WO data write.
		woCache := handlers.CacheWorkOrderReads(60 * time.Second)
		r.With(woCache).Get("/api/work-orders", handlers.GetWorkOrders)
		r.Get("/api/work-orders/export", handlers.GetWorkOrdersExport)
		r.With(woCache).Get("/api/work-orders/stats", handlers.GetWorkOrderStats)
		r.With(woCache).Get("/api/work-orders/timeline", handlers.GetWorkOrderTimeline)
		r.With(woCache).Get("/api/work-orders/facets", handlers.GetWorkOrderFacets)
		r.Get("/api/work-orders/sync-status", handlers.GetWorkOrderSyncStatus)
		r.Get("/api/work-orders/{id}/detail", handlers.GetWorkOrderDetail)
		r.Post("/api/work-orders/{id}/sync", handlers.SyncWorkOrderDetail)
		r.Get("/api/local-wo-history/{id}", handlers.GetLocalWorkOrderHistory)
		r.Get("/api/work-orders/pending-approvals", handlers.GetPendingApprovals)
		r.Post("/api/work-orders/bulk-pending-approvals", handlers.PostBulkPendingApprovals)

		// System endpoints
		// Heavy full-table jobs: Admin only.
		r.With(appMiddleware.RequireRole("Admin")).Get("/api/system/run-ai-etl", handlers.RunAIEtl)
		r.With(appMiddleware.RequireRole("Admin")).Post("/api/system/work-orders/backfill-summary", handlers.BackfillWorkOrderSummariesHandler)
		r.With(appMiddleware.RequireRole("Admin")).Post("/api/system/work-orders/rebuild-derived", handlers.RebuildWorkOrderDerivedHandler)
		r.With(appMiddleware.RequireRole("Admin")).Post("/api/system/work-orders/reprocess-list", handlers.ReprocessStoredWorkOrderListHandler)

		// Export (all authenticated roles)
		r.Get("/api/export/{table}/csv", handlers.ExportCSV)
		r.Get("/api/export/{table}/json", handlers.ExportJSON)

		// Manual Sync Trigger
		r.Post("/api/sync/trigger", func(w http.ResponseWriter, req *http.Request) {
			var body struct {
				ID string `json:"id"`
			}
			json.NewDecoder(req.Body).Decode(&body)

			// The WorkOrders list processor upserts changed summary rows as part of
			// RunSyncJob; the full rebuild stays available at /api/system/work-orders/backfill-summary.
			syncErr := workers.RunSyncJob(true, body.ID)
			w.Header().Set("Content-Type", "application/json")
			if syncErr != nil {
				msg := "Sinkronisasi gagal: " + syncErr.Error()
				if workers.IsAuthError(syncErr) {
					msg = "Sinkronisasi gagal: token/cookie SIAGA di menu API Sync Config sudah kedaluwarsa."
				}
				w.WriteHeader(http.StatusBadGateway)
				json.NewEncoder(w).Encode(map[string]interface{}{"success": false, "error": msg})
				return
			}
			w.Write([]byte(`{"success": true, "message": "Sync triggered successfully"}`))
		})

		// Write operations — permissions handled inside handlers based on role_permissions table
		r.Group(func(r chi.Router) {
			r.Use(appMiddleware.RequireRole("Admin", "Manager", "Staff"))
			r.Post("/api/data/{table}", handlers.PostData)
			r.Put("/api/data/{table}", handlers.PutData)
			r.Delete("/api/data/{table}", handlers.DeleteData)

			// Bulk import — requires the table's "import" permission (checked in the handler)
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
