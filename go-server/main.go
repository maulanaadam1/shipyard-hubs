package main

import (
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"
	chiMiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/rs/cors"

	"shipyard/db"
	"shipyard/handlers"
	appMiddleware "shipyard/middleware"
)

func main() {
	db.Init()

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

	// TEMPORARY DEBUG ROUTE
	r.Get("/api/debug/users", func(w http.ResponseWriter, r *http.Request) {
		query := "SELECT id, email, username, password, name, role, jabatan, city, branch, department, whatsapp, avatar_url, roles, extra_roles FROM profiles WHERE email = 'admin@shipyard.local'"
		var id, emailVal, password, name, role string
		var username, jabatan, city, branch, department, whatsapp, avatarURL, roles, extraRoles *string
		
		err := db.DB.QueryRow(query).Scan(&id, &emailVal, &username, &password, &name, &role, &jabatan, &city, &branch, &department, &whatsapp, &avatarURL, &roles, &extraRoles)
		
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

		// Export (all authenticated roles)
		r.Get("/api/export/{table}/csv", handlers.ExportCSV)
		r.Get("/api/export/{table}/json", handlers.ExportJSON)

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

	// Serve static frontend in production
	if os.Getenv("NODE_ENV") == "production" {
		// Use "./dist" because Docker sets WORKDIR to /app where dist is copied
		distDir := "./dist"
		fs := http.FileServer(http.Dir(distDir))
		
		r.Get("/*", func(w http.ResponseWriter, req *http.Request) {
			// Check if the requested file exists
			path := req.URL.Path
			if _, err := os.Stat(distDir + path); os.IsNotExist(err) {
				// File does not exist, serve index.html for SPA routing
				http.ServeFile(w, req, distDir+"/index.html")
				return
			}
			// File exists, serve it
			fs.ServeHTTP(w, req)
		})
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}

	log.Printf("🚢 Shipyard Hub server started on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, r))
}

