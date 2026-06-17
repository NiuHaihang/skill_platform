// Package api provides the HTTP router for the sandbox service.
package api

import (
	"log/slog"

	"github.com/go-chi/chi/v5"

	"github.com/skillforge/sandbox/internal/executor"
	"github.com/skillforge/sandbox/internal/pool"
)

// NewRouter creates and configures the chi router with all sandbox API routes.
// It applies middleware in order: panic recovery → request ID → request logging → size limit → auth.
func NewRouter(exec *executor.Executor, p *pool.Pool, apiKey string, logger *slog.Logger) *chi.Mux {
	r := chi.NewRouter()

	// Global middleware chain — applied to ALL routes.
	// Order matters: outermost middleware runs first.

	// 1. Panic recovery: catch panics in any handler to prevent crashes.
	r.Use(PanicRecovery(logger))

	// 2. Request ID: inject a unique ID for request tracing and correlation.
	r.Use(RequestID)

	// 3. Request logging: log every request with method, path, status, duration.
	r.Use(RequestLogger(logger))

	// 4. Content-Type: set JSON content type for all API responses.
	r.Use(ContentTypeJSON)

	// 5. Request size limit: prevent memory exhaustion from oversized payloads (10 MB).
	r.Use(RequestSizeLimit(MaxRequestBodySize))

	// Create the handler with injected dependencies.
	handler := NewHandler(exec, p, logger)

	// API v1 routes.
	r.Route("/v1/sandbox", func(r chi.Router) {
		// Health check — no authentication required.
		// Load balancers and orchestrators need to call this freely.
		r.Get("/health", handler.HealthHandler)

		// Routes that require API key authentication.
		r.Group(func(r chi.Router) {
			r.Use(APIKeyAuth(apiKey))

			// POST /v1/sandbox/run — Execute code in a sandbox.
			r.Post("/run", handler.RunHandler)

			// GET /v1/sandbox/metrics — Pool statistics.
			r.Get("/metrics", handler.MetricsHandler)

			// GET /v1/sandbox/status/{id} — Check execution status.
			r.Get("/status/{id}", handler.StatusHandler)
		})
	})

	return r
}
