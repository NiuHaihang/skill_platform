// Package api provides HTTP middleware for the sandbox service.
// Middleware handles cross-cutting concerns: authentication, logging, panic recovery,
// request tracking, and request size limits.
package api

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/google/uuid"
)

// contextKey is an unexported type for context keys to prevent collisions.
type contextKey string

const (
	// RequestIDKey is the context key for the unique request ID.
	RequestIDKey contextKey = "request_id"

	// RequestIDHeader is the HTTP header name for request tracing.
	RequestIDHeader = "X-Request-ID"

	// MaxRequestBodySize is the maximum allowed request body size (10 MB).
	MaxRequestBodySize = 10 * 1024 * 1024
)

// GetRequestID extracts the request ID from the context.
func GetRequestID(ctx context.Context) string {
	if id, ok := ctx.Value(RequestIDKey).(string); ok {
		return id
	}
	return ""
}

// APIKeyAuth returns middleware that validates the API key in the Authorization header.
// If apiKey is empty, authentication is disabled (useful for development).
func APIKeyAuth(apiKey string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip auth if no API key is configured (development mode).
			if apiKey == "" {
				next.ServeHTTP(w, r)
				return
			}

			// Extract the API key from the Authorization header.
			// Expected format: "Bearer <api-key>"
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, `{"error":"missing Authorization header"}`, http.StatusUnauthorized)
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				http.Error(w, `{"error":"invalid Authorization format, expected 'Bearer <key>'"}`, http.StatusUnauthorized)
				return
			}

			// Constant-time comparison would be better for production,
			// but for an internal service API key this is acceptable.
			if parts[1] != apiKey {
				slog.Warn("rejected request with invalid API key",
					"remote_addr", r.RemoteAddr,
					"path", r.URL.Path,
				)
				http.Error(w, `{"error":"invalid API key"}`, http.StatusForbidden)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// RequestID injects a unique request ID into each request's context.
// If the client provides an X-Request-ID header, it is reused for tracing continuity.
func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Prefer client-provided request ID for distributed tracing.
		reqID := r.Header.Get(RequestIDHeader)
		if reqID == "" {
			reqID = uuid.New().String()
		}

		// Set the request ID in the response header for correlation.
		w.Header().Set(RequestIDHeader, reqID)

		// Inject into context.
		ctx := context.WithValue(r.Context(), RequestIDKey, reqID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequestLogger logs every HTTP request with structured fields.
// It captures method, path, status code, duration, and request ID.
func RequestLogger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Wrap the response writer to capture the status code.
			ww := &responseWriter{ResponseWriter: w, statusCode: http.StatusOK}

			next.ServeHTTP(ww, r)

			duration := time.Since(start)

			logger.Info("http request",
				"request_id", GetRequestID(r.Context()),
				"method", r.Method,
				"path", r.URL.Path,
				"status", ww.statusCode,
				"duration_ms", duration.Milliseconds(),
				"bytes", ww.bytesWritten,
				"remote_addr", r.RemoteAddr,
				"user_agent", r.UserAgent(),
			)
		})
	}
}

// PanicRecovery catches panics in HTTP handlers and returns a 500 error.
// This prevents a single bad request from crashing the entire service.
func PanicRecovery(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if rvr := recover(); rvr != nil {
					// Log the panic with stack trace for debugging.
					logger.Error("panic recovered in HTTP handler",
						"request_id", GetRequestID(r.Context()),
						"panic", fmt.Sprintf("%v", rvr),
						"stack", string(debug.Stack()),
						"method", r.Method,
						"path", r.URL.Path,
					)

					// Return a generic 500 error — don't leak internal details.
					http.Error(w,
						`{"error":"internal server error"}`,
						http.StatusInternalServerError,
					)
				}
			}()

			next.ServeHTTP(w, r)
		})
	}
}

// RequestSizeLimit enforces a maximum request body size.
// This prevents memory exhaustion from oversized requests.
func RequestSizeLimit(maxBytes int64) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// http.MaxBytesReader wraps the body and returns an error
			// if the body exceeds the limit.
			r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
			next.ServeHTTP(w, r)
		})
	}
}

// ContentTypeJSON sets the Content-Type header to application/json.
func ContentTypeJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		next.ServeHTTP(w, r)
	})
}

// responseWriter wraps http.ResponseWriter to capture the status code and bytes written.
type responseWriter struct {
	http.ResponseWriter
	statusCode   int
	bytesWritten int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.statusCode = code
	rw.ResponseWriter.WriteHeader(code)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.bytesWritten += n
	return n, err
}
