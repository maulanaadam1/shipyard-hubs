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
		// Reference costs and Data Perlu Dicek findings, a few minutes after
		// start and then every 6 hours.
		handlers.StartItemFindingsWorker()
		// Full repair lists of the Job Orders (customer prices), every 6 hours.
		handlers.StartRepairListWorker()
	}
	// Per process (it fills this instance's response cache), so it runs either way.
	handlers.StartWorkOrderItemPrewarm()

	r := chi.NewRouter()
	r.Use(chiMiddleware.Recoverer)
	r.Use(appMiddleware.Logger) // custom logger with user info

	c := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"Content-Type", "Authorization"},
	})
	r.Use(c.Handler)
	r.Use(handlers.Maintenance) // MAINTENANCE_MODE: API answers 503, the app shows its maintenance screen

	// Public routes (no auth required)
	r.Get("/api/health", handlers.GetHealth)
	r.Post("/api/auth/login", handlers.Login)
	r.Get("/api/auth/session", handlers.GetSession)
	// External sources push rows here; each checks its own Bearer token
	// (managed in Sumber Data Eksternal), no user session.
	r.Post("/api/ingest/{source}", handlers.PostIngest)

	// Public AI Asisten share page: a guest types a name and gets a guest
	// token, which opens only these routes, while an Admin keeps sharing on.
	r.Post("/api/ai/share/session", handlers.PostAIShareSession)
	r.Group(func(r chi.Router) {
		r.Use(handlers.RequireAIShareGuest)
		r.Get("/api/ai/share/status", handlers.GetAIStatus)
		r.With(handlers.AIShareQuota).Post("/api/ai/share/chat", handlers.PostAIChat)
		r.Post("/api/ai/share/feedback", handlers.PostAIFeedback)
		r.Get("/api/ai/share/scopes", handlers.GetAIScopes)
		r.Get("/api/ai/share/conversations", handlers.GetAIConversations)
		r.Get("/api/ai/share/conversations/{id}", handlers.GetAIConversation)
		r.Delete("/api/ai/share/conversations/{id}", handlers.DeleteAIConversation)
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
		r.Get("/api/projects/wo-summary", handlers.GetProjectWorkOrderSummaries)
		r.Get("/api/projects/wo-summary/detail", handlers.GetProjectWorkOrderDetail)
		// Dashboard reads: cached for 60s, dropped on any WO data write.
		woCache := handlers.CacheWorkOrderReads(60 * time.Second)
		r.With(woCache).Get("/api/work-orders", handlers.GetWorkOrders)
		r.Get("/api/work-orders/export", handlers.GetWorkOrdersExport)
		r.With(woCache).Get("/api/work-orders/stats", handlers.GetWorkOrderStats)
		r.With(woCache).Get("/api/work-orders/timeline", handlers.GetWorkOrderTimeline)
		r.With(woCache).Get("/api/work-orders/facets", handlers.GetWorkOrderFacets)
		// Flattened WO work items: search, per-group summaries, filter options and
		// Excel export. The permission check runs before the shared cache.
		itemsView := handlers.RequirePermission(handlers.ResourceWorkOrderItems, "view")
		itemsCache := handlers.CacheWorkOrderReads(handlers.WorkOrderItemsCacheTTL)
		r.With(itemsView, itemsCache).Get("/api/wo-items", handlers.GetWorkOrderItems)
		r.With(itemsView, itemsCache).Get("/api/wo-items/summary", handlers.GetWorkOrderItemSummary)
		r.With(itemsView, itemsCache).Get("/api/wo-items/facets", handlers.GetWorkOrderItemFacets)
		r.With(handlers.RequirePermission(handlers.ResourceWorkOrderItems, "export")).Get("/api/wo-items/export", handlers.ExportWorkOrderItems)
		// Data Perlu Dicek: work items flagged against reference costs. Ignoring a
		// finding needs edit, the Excel file export.
		findingsView := handlers.RequirePermission(handlers.ResourceItemFindings, "view")
		r.With(findingsView).Get("/api/wo-findings", handlers.GetItemFindings)
		r.With(findingsView).Get("/api/wo-findings/summary", handlers.GetItemFindingsSummary)
		r.With(findingsView).Get("/api/wo-reference", handlers.GetItemReferences)
		r.With(findingsView).Get("/api/wo-findings/unrecognized", handlers.GetUnrecognizedActivities)
		r.With(findingsView).Get("/api/wo-findings/unrecognized/items", handlers.GetUnrecognizedActivityItems)
		r.With(handlers.RequirePermission(handlers.ResourceItemFindings, "edit")).Post("/api/wo-findings/status", handlers.UpdateItemFindingStatus)
		r.With(handlers.RequirePermission(handlers.ResourceItemFindings, "export")).Get("/api/wo-findings/export", handlers.ExportItemFindings)
		// AI tool layer: the user's read-only tools (Claude tool definitions) and
		// a way to run one; each tool checks view rights on its page's resource.
		r.Get("/api/ai/tools", handlers.GetAITools)
		// AI Asisten chat: off until an Admin configures and switches on a
		// provider in Pengaturan AI.
		aiView := handlers.RequirePermission(handlers.ResourceAIAssistant, "view")
		r.With(aiView).Get("/api/ai/status", handlers.GetAIStatus)
		r.With(aiView).Post("/api/ai/chat", handlers.PostAIChat)
		r.With(aiView).Post("/api/ai/feedback", handlers.PostAIFeedback)
		r.With(aiView).Get("/api/ai/insights", handlers.GetAIInsights)
		r.With(aiView).Get("/api/ai/scopes", handlers.GetAIScopes)
		r.With(aiView).Get("/api/ai/conversations", handlers.GetAIConversations)
		r.With(aiView).Get("/api/ai/conversations/{id}", handlers.GetAIConversation)
		r.With(aiView).Delete("/api/ai/conversations/{id}", handlers.DeleteAIConversation)
		r.With(handlers.RequirePermission(handlers.ResourceAILogs, "view")).Get("/api/ai/logs", handlers.GetAILogs)
		// HSE menus: Absensi (Data Absensi), Work Permit (Data HSE) and the
		// HSE dashboard (its own menu permission; each part checks its data).
		r.With(handlers.RequirePermission(handlers.ResourceDataAttendance, "view")).Get("/api/attendance/daily", handlers.GetAttendanceDaily)
		hseView := handlers.RequirePermission(handlers.ResourceDataHSE, "view")
		r.With(hseView).Get("/api/hse/work-permits", handlers.GetWorkPermits)
		r.With(hseView).Get("/api/hse/work-permits/facets", handlers.GetWorkPermitFacets)
		r.With(handlers.RequirePermission(handlers.ResourceHSEDashboard, "view")).Get("/api/hse/dashboard", handlers.GetHSEDashboard)
		// Sumber Data Eksternal: sources and their tokens, Admin only.
		// Sumber Data Eksternal, Pengaturan AI and Log AI: role permissions
		// (Role Management); Admin always has them.
		ingestPerm := func(action string) func(http.Handler) http.Handler {
			return handlers.RequirePermission(handlers.ResourceIngestSources, action)
		}
		r.With(ingestPerm("view")).Get("/api/ingest-sources", handlers.GetIngestSources)
		r.With(ingestPerm("add")).Post("/api/ingest-sources", handlers.CreateIngestSource)
		r.With(ingestPerm("edit")).Put("/api/ingest-sources/{id}", handlers.UpdateIngestSource)
		r.With(ingestPerm("edit")).Post("/api/ingest-sources/{id}/rotate-token", handlers.RotateIngestSourceToken)
		r.Post("/api/ai/tools/{name}", handlers.RunAITool)
		r.With(handlers.RequirePermission(handlers.ResourceAISettings, "view")).Get("/api/ai/settings", handlers.GetAISettings)
		r.With(handlers.RequirePermission(handlers.ResourceAISettings, "edit")).Put("/api/ai/settings", handlers.PutAISettings)
		r.With(handlers.RequirePermission(handlers.ResourceAISettings, "edit")).Post("/api/ai/settings/test", handlers.TestAISettings)
		r.With(handlers.RequirePermission(handlers.ResourceAISettings, "view")).Get("/api/ai/share-settings", handlers.GetAIShareSettings)
		r.With(handlers.RequirePermission(handlers.ResourceAISettings, "edit")).Put("/api/ai/share-settings", handlers.PutAIShareSettings)
		r.With(handlers.RequirePermission(handlers.ResourceAISettings, "view")).Get("/api/ai/share-guests", handlers.GetAIShareGuests)
		// Harga Acuan: reference unit costs per work type, size and unit.
		// Harga penawaran (repair list) vs vendor cost per Job Order.
		marginView := handlers.RequirePermission(handlers.ResourceRepairPrices, "view")
		r.With(marginView).Get("/api/job-margins", handlers.GetJobMargins)
		r.With(marginView).Get("/api/job-margins/detail", handlers.GetJobMarginDetail)
		// Repair List menu: each Job Order's full repair list from SIAGA.
		rlView := handlers.RequirePermission(handlers.ResourceRepairList, "view")
		r.With(rlView).Get("/api/repair-lists", handlers.GetRepairLists)
		r.With(rlView).Get("/api/repair-lists/{id}", handlers.GetRepairList)
		riView := handlers.RequirePermission(handlers.ResourceRepairItems, "view")
		r.With(riView).Get("/api/repair-items", handlers.GetRepairItems)
		r.With(riView).Get("/api/repair-items/summary", handlers.GetRepairItemSummary)
		r.With(riView).Get("/api/repair-items/facets", handlers.GetRepairItemFacets)
		mprView := handlers.RequirePermission(handlers.ResourceMarketingPriceReference, "view")
		r.With(mprView).Get("/api/marketing-price-reference", handlers.GetMarketingPriceReference)
		r.With(mprView).Get("/api/marketing-price-reference/detail", handlers.GetMarketingPriceReferenceDetail)
		r.With(mprView).Get("/api/marketing-price-reference/facets", handlers.GetRepairItemFacets)
		r.With(handlers.RequirePermission(handlers.ResourceRepairList, "edit")).Post("/api/repair-lists/{id}/sync", handlers.PostRepairListSync)
		priceView := handlers.RequirePermission(handlers.ResourcePriceReference, "view")
		r.With(priceView).Get("/api/price-reference", handlers.GetPriceReferences)
		r.With(priceView).Get("/api/price-reference/detail", handlers.GetPriceReferenceDetail)
		r.With(handlers.RequirePermission(handlers.ResourcePriceReference, "export")).Get("/api/price-reference/export", handlers.ExportPriceReferences)
		// Persediaan Material: snapshots of the Master Inventory workbook, sent by its macro.
		inventoryView := handlers.RequirePermission(handlers.ResourceInventory, "view")
		r.With(inventoryView).Get("/api/inventory/summary", handlers.GetInventorySummary)
		r.With(inventoryView).Get("/api/inventory/data/{dataset}", handlers.GetInventory)
		r.With(handlers.RequirePermission(handlers.ResourceInventory, "import")).Post("/api/inventory/sync/{dataset}", handlers.SyncInventory)
		// Financial Dashboard: billing transactions from the daily approval ledger.
		financeView := handlers.RequirePermission(handlers.ResourceFinancialDashboard, "view")
		r.With(financeView, woCache).Get("/api/finance/summary", handlers.GetFinanceSummary)
		r.Get("/api/work-orders/sync-status", handlers.GetWorkOrderSyncStatus)
		r.Get("/api/work-orders/{id}/detail", handlers.GetWorkOrderDetail)
		r.Post("/api/work-orders/{id}/sync", handlers.SyncWorkOrderDetail)
		r.Get("/api/local-wo-history/{id}", handlers.GetLocalWorkOrderHistory)
		r.Get("/api/work-orders/pending-approvals", handlers.GetPendingApprovals)
		r.Post("/api/work-orders/bulk-pending-approvals", handlers.PostBulkPendingApprovals)

		// System endpoints
		// Heavy full-table jobs: Admin only.
		r.With(appMiddleware.RequireRole("Admin")).Post("/api/system/work-orders/backfill-summary", handlers.BackfillWorkOrderSummariesHandler)
		r.With(appMiddleware.RequireRole("Admin")).Post("/api/system/work-orders/rebuild-derived", handlers.RebuildWorkOrderDerivedHandler)
		r.With(appMiddleware.RequireRole("Admin")).Post("/api/system/wo-findings/run", handlers.RunItemFindingsHandler)
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
