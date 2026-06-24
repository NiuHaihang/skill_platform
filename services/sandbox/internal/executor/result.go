// Package executor defines the types used for sandbox code execution requests and results.
package executor

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

// MaxCodeSize is the maximum allowed size of submitted code in bytes (1MB).
const MaxCodeSize = 1 * 1024 * 1024

// ExecutionStatus represents the lifecycle state of a code execution.
type ExecutionStatus string

const (
	StatusPending   ExecutionStatus = "pending"
	StatusRunning   ExecutionStatus = "running"
	StatusCompleted ExecutionStatus = "completed"
	StatusFailed    ExecutionStatus = "failed"
	StatusTimeout   ExecutionStatus = "timeout"
	StatusCancelled ExecutionStatus = "cancelled"
)

// ExecutionRequest represents a request to execute code in a sandbox.
type ExecutionRequest struct {
	// ExecutionID is a unique identifier for this execution, typically a UUID.
	ExecutionID string `json:"execution_id"`

	// Language specifies the runtime to use: "python" or "javascript".
	Language string `json:"language"`

	// Code is the source code to execute.
	Code string `json:"code"`

	// Files is an optional map of filename -> base64-encoded content
	// that will be placed in the container's /workspace/input/ directory.
	Files map[string]string `json:"files,omitempty"`

	// Environment is an optional map of environment variables to set during execution.
	Environment map[string]string `json:"environment,omitempty"`

	// Stdin is optional data that will be written to /workspace/input/_stdin.json
	// and piped to the process's stdin. Skills receive their arguments through
	// this channel (typically a JSON object with query/input fields).
	Stdin string `json:"stdin,omitempty"`

	// Args are additional command-line arguments appended after the code file path.
	// For example, Args=["sqrt(144)"] results in: python code.py "sqrt(144)"
	Args []string `json:"args,omitempty"`

	// Tier is the security tier (1-3) controlling resource limits and permissions.
	Tier int `json:"tier"`

	// TimeoutSeconds overrides the tier's default timeout. If zero, the tier default is used.
	TimeoutSeconds int `json:"timeout_seconds,omitempty"`

	// CallbackURL is an optional webhook URL to POST the result to upon completion.
	CallbackURL string `json:"callback_url,omitempty"`
}

// Validate checks the execution request for common issues and returns an error if invalid.
func (r *ExecutionRequest) Validate() error {
	if r.ExecutionID == "" {
		return fmt.Errorf("execution_id is required")
	}

	// Validate language.
	lang := strings.ToLower(r.Language)
	if lang != "python" && lang != "javascript" {
		return fmt.Errorf("unsupported language %q; must be 'python' or 'javascript'", r.Language)
	}
	r.Language = lang

	// Validate code presence and size.
	if strings.TrimSpace(r.Code) == "" {
		return fmt.Errorf("code must not be empty")
	}
	if len(r.Code) > MaxCodeSize {
		return fmt.Errorf("code size %d bytes exceeds maximum %d bytes", len(r.Code), MaxCodeSize)
	}

	// Validate UTF-8 encoding — prevents binary injection via code field.
	if !utf8.ValidString(r.Code) {
		return fmt.Errorf("code must be valid UTF-8")
	}

	// Validate tier.
	if r.Tier < 1 || r.Tier > 3 {
		return fmt.Errorf("tier must be between 1 and 3, got %d", r.Tier)
	}

	// Validate timeout if provided.
	if r.TimeoutSeconds < 0 {
		return fmt.Errorf("timeout_seconds must be non-negative, got %d", r.TimeoutSeconds)
	}

	// Validate file names — prevent directory traversal.
	for name := range r.Files {
		if strings.Contains(name, "..") || strings.HasPrefix(name, "/") {
			return fmt.Errorf("file name %q contains invalid path components", name)
		}
	}

	return nil
}

// ExecutionResult represents the outcome of a sandbox code execution.
type ExecutionResult struct {
	// ExecutionID matches the request's execution ID.
	ExecutionID string `json:"execution_id"`

	// Status is the final execution status.
	Status ExecutionStatus `json:"status"`

	// ExitCode is the process exit code (0 = success).
	ExitCode int `json:"exit_code"`

	// Stdout captures the standard output from the executed code.
	Stdout string `json:"stdout"`

	// Stderr captures the standard error from the executed code.
	Stderr string `json:"stderr"`

	// OutputFiles is a map of filename -> base64-encoded content
	// from the container's /workspace/output/ directory.
	OutputFiles map[string]string `json:"output_files,omitempty"`

	// ResourceUsage contains metrics about the execution's resource consumption.
	ResourceUsage *ResourceUsage `json:"resource_usage,omitempty"`

	// Error contains details if the execution failed.
	Error *ExecutionError `json:"error"`
}

// ResourceUsage tracks resource consumption during execution.
type ResourceUsage struct {
	// CPUTimeMs is the total CPU time used in milliseconds.
	CPUTimeMs int64 `json:"cpu_time_ms"`

	// MemoryPeakBytes is the peak memory usage in bytes.
	MemoryPeakBytes int64 `json:"memory_peak_bytes"`

	// DurationMs is the wall-clock duration of the execution in milliseconds.
	DurationMs int64 `json:"duration_ms"`
}

// ExecutionError provides structured error information.
type ExecutionError struct {
	// Code is a machine-readable error code.
	Code string `json:"code"`

	// Message is a human-readable error description.
	Message string `json:"message"`

	// Details provides additional context for debugging.
	Details string `json:"details,omitempty"`
}

func (e *ExecutionError) Error() string {
	if e.Details != "" {
		return fmt.Sprintf("[%s] %s: %s", e.Code, e.Message, e.Details)
	}
	return fmt.Sprintf("[%s] %s", e.Code, e.Message)
}

// Common execution error codes.
var (
	ErrCodeTimeout       = "EXECUTION_TIMEOUT"
	ErrCodeOOM           = "OUT_OF_MEMORY"
	ErrCodeRuntimeError  = "RUNTIME_ERROR"
	ErrCodeInternalError = "INTERNAL_ERROR"
	ErrCodeValidation    = "VALIDATION_ERROR"
	ErrCodePoolExhausted = "POOL_EXHAUSTED"
)

// ExecutionTracking is used internally to track in-progress executions.
type ExecutionTracking struct {
	Request   *ExecutionRequest
	Status    ExecutionStatus
	StartedAt time.Time
	Result    *ExecutionResult
}
