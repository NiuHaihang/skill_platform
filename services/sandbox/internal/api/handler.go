// Package api provides HTTP handlers for the sandbox service.
package api

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/skillforge/sandbox/internal/executor"
	"github.com/skillforge/sandbox/internal/pool"
)

// Handler holds the dependencies needed by HTTP handlers.
type Handler struct {
	executor *executor.Executor
	pool     *pool.Pool
	logger   *slog.Logger
}

// NewHandler creates a new Handler with the given dependencies.
func NewHandler(exec *executor.Executor, p *pool.Pool, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{
		executor: exec,
		pool:     p,
		logger:   logger,
	}
}

// RunHandler handles POST /v1/sandbox/run — the main code execution endpoint.
// It accepts an ExecutionRequest, validates it, kicks off execution, and returns the result.
func (h *Handler) RunHandler(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	reqID := GetRequestID(ctx)

	// Parse the request body.
	var req executor.ExecutionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.logger.Warn("failed to parse execution request",
			"request_id", reqID,
			"error", err,
		)
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "invalid request body: " + err.Error(),
		})
		return
	}

	// Generate execution ID if not provided.
	if req.ExecutionID == "" {
		req.ExecutionID = uuid.New().String()
	}

	// Validate the request.
	if err := req.Validate(); err != nil {
		h.logger.Warn("execution request validation failed",
			"request_id", reqID,
			"execution_id", req.ExecutionID,
			"error", err,
		)
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"error":        err.Error(),
			"execution_id": req.ExecutionID,
		})
		return
	}

	h.logger.Info("received execution request",
		"request_id", reqID,
		"execution_id", req.ExecutionID,
		"language", req.Language,
		"tier", req.Tier,
		"code_size", len(req.Code),
		"file_count", len(req.Files),
	)

	// Execute the code. This blocks until completion or timeout.
	result := h.executor.Execute(ctx, &req)

	// Determine HTTP status code based on execution result.
	statusCode := http.StatusOK
	switch result.Status {
	case executor.StatusCompleted:
		statusCode = http.StatusOK
	case executor.StatusFailed:
		// Runtime errors (non-zero exit code) are still 200 — the API succeeded,
		// but the user's code failed. This is by design: execution errors are
		// reported in the response body, not via HTTP status codes.
		statusCode = http.StatusOK
	case executor.StatusTimeout:
		statusCode = http.StatusGatewayTimeout
	default:
		if result.Error != nil {
			switch result.Error.Code {
			case executor.ErrCodeValidation:
				statusCode = http.StatusBadRequest
			case executor.ErrCodePoolExhausted:
				statusCode = http.StatusServiceUnavailable
			default:
				statusCode = http.StatusInternalServerError
			}
		}
	}

	writeJSON(w, statusCode, result)
}

// HealthHandler handles GET /v1/sandbox/health — service health check.
// Returns 200 if the pool is healthy, 503 otherwise.
func (h *Handler) HealthHandler(w http.ResponseWriter, r *http.Request) {
	healthy := h.pool.Healthy()

	status := http.StatusOK
	healthStatus := "healthy"

	if !healthy {
		status = http.StatusServiceUnavailable
		healthStatus = "unhealthy"
	}

	writeJSON(w, status, map[string]interface{}{
		"status":  healthStatus,
		"service": "sandbox",
	})
}

// MetricsHandler handles GET /v1/sandbox/metrics — pool statistics.
// Returns current pool metrics including idle, busy, and total container counts.
func (h *Handler) MetricsHandler(w http.ResponseWriter, r *http.Request) {
	metrics := h.pool.Metrics()
	writeJSON(w, http.StatusOK, metrics)
}

// StatusHandler handles GET /v1/sandbox/status/{id} — execution status lookup.
// Returns the current status and result (if complete) for a given execution ID.
func (h *Handler) StatusHandler(w http.ResponseWriter, r *http.Request) {
	executionID := chi.URLParam(r, "id")
	if executionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": "execution ID is required",
		})
		return
	}

	tracking, found := h.executor.GetStatus(executionID)
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]string{
			"error":        "execution not found",
			"execution_id": executionID,
		})
		return
	}

	response := map[string]interface{}{
		"execution_id": executionID,
		"status":       tracking.Status,
		"started_at":   tracking.StartedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}

	// Include the result if the execution is complete.
	if tracking.Result != nil {
		response["result"] = tracking.Result
	}

	writeJSON(w, http.StatusOK, response)
}

// writeJSON encodes the given value as JSON and writes it to the response.
func writeJSON(w http.ResponseWriter, statusCode int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)

	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("failed to write JSON response",
			"error", err,
		)
	}
}
