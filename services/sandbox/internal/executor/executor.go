// Package executor implements the main code execution logic.
// It orchestrates container acquisition, file preparation, code execution,
// output collection, and result assembly.
package executor

import (
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/skillforge/sandbox/internal/config"
	"github.com/skillforge/sandbox/internal/pool"
	"github.com/skillforge/sandbox/internal/runtime"
	"github.com/skillforge/sandbox/internal/security"
)

// Executor manages code execution in sandboxed containers.
type Executor struct {
	docker  *DockerClient
	pool    *pool.Pool
	cfg     *config.Config
	logger  *slog.Logger

	// executions tracks in-progress executions for status queries.
	mu         sync.RWMutex
	executions map[string]*ExecutionTracking

	// Runtimes per language.
	pythonRuntime *runtime.PythonRuntime
	jsRuntime     *runtime.JavaScriptRuntime
}

// NewExecutor creates a new Executor instance.
func NewExecutor(docker *DockerClient, pool *pool.Pool, cfg *config.Config, logger *slog.Logger) *Executor {
	if logger == nil {
		logger = slog.Default()
	}

	return &Executor{
		docker:        docker,
		pool:          pool,
		cfg:           cfg,
		logger:        logger,
		executions:    make(map[string]*ExecutionTracking),
		pythonRuntime: runtime.NewPythonRuntime(),
		jsRuntime:     runtime.NewJavaScriptRuntime(),
	}
}

// Execute runs the given code in a sandboxed container and returns the result.
// This is the main entry point for code execution.
//
// Execution flow:
// 1. Validate the request and resolve the security tier.
// 2. Pre-validate the code for dangerous patterns (advisory only).
// 3. Acquire a container from the warm pool.
// 4. Copy input files to the container's /workspace/input/.
// 5. Write the code file (optionally wrapped) to /workspace/code/.
// 6. Execute the code with a timeout context.
// 7. Capture stdout/stderr.
// 8. Extract output files from /workspace/output/.
// 9. Collect resource usage statistics.
// 10. Release the container back to the pool (or destroy if tainted).
// 11. Return the assembled ExecutionResult.
func (e *Executor) Execute(ctx context.Context, req *ExecutionRequest) *ExecutionResult {
	startTime := time.Now()
	execID := req.ExecutionID

	e.logger.Info("starting execution",
		"execution_id", execID,
		"language", req.Language,
		"tier", req.Tier,
		"code_size", len(req.Code),
	)

	// Track this execution.
	tracking := &ExecutionTracking{
		Request:   req,
		Status:    StatusRunning,
		StartedAt: startTime,
	}
	e.mu.Lock()
	e.executions[execID] = tracking
	e.mu.Unlock()

	// Build the result — we'll fill it in as we go.
	result := &ExecutionResult{
		ExecutionID: execID,
		Status:      StatusFailed,
	}

	// Defer updating the tracking record.
	defer func() {
		e.mu.Lock()
		if t, ok := e.executions[execID]; ok {
			t.Status = ExecutionStatus(result.Status)
			t.Result = result
		}
		e.mu.Unlock()
	}()

	// Step 1: Validate request.
	if err := req.Validate(); err != nil {
		result.Error = &ExecutionError{
			Code:    ErrCodeValidation,
			Message: "request validation failed",
			Details: err.Error(),
		}
		return result
	}

	// Step 2: Pre-validate code (advisory — log warnings but don't block).
	validation := security.ValidateCode(req.Code, req.Language)
	if !validation.Valid {
		result.Error = &ExecutionError{
			Code:    ErrCodeValidation,
			Message: "code validation failed",
			Details: validation.Error,
		}
		return result
	}
	for _, warning := range validation.Warnings {
		e.logger.Warn("code validation warning",
			"execution_id", execID,
			"warning", warning,
		)
	}

	// Step 3: Resolve execution timeout.
	tierCfg, err := e.cfg.GetTierConfig(req.Tier)
	if err != nil {
		result.Error = &ExecutionError{
			Code:    ErrCodeValidation,
			Message: "invalid tier configuration",
			Details: err.Error(),
		}
		return result
	}

	timeout := time.Duration(tierCfg.TimeoutSeconds) * time.Second
	if req.TimeoutSeconds > 0 {
		requestedTimeout := time.Duration(req.TimeoutSeconds) * time.Second
		// Don't allow exceeding the tier's maximum timeout.
		if requestedTimeout <= timeout {
			timeout = requestedTimeout
		} else {
			e.logger.Warn("requested timeout exceeds tier maximum, using tier default",
				"execution_id", execID,
				"requested", req.TimeoutSeconds,
				"tier_max", tierCfg.TimeoutSeconds,
			)
		}
	}

	// Create a timeout context for the entire execution.
	execCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	// Step 4: Acquire a container from the pool.
	container, err := e.pool.Acquire(execCtx, req.Language, req.Tier)
	if err != nil {
		result.Error = &ExecutionError{
			Code:    ErrCodePoolExhausted,
			Message: "failed to acquire container",
			Details: err.Error(),
		}
		return result
	}

	// Track whether the container is tainted (needs to be destroyed rather than reused).
	tainted := false
	defer func() {
		e.pool.Release(context.Background(), container, tainted)
	}()

	e.logger.Debug("acquired container",
		"execution_id", execID,
		"container_id", container.ID[:12],
	)

	// Step 5: Decode and copy input files to /workspace/input/.
	if len(req.Files) > 0 {
		decodedFiles, err := DecodeBase64Files(req.Files)
		if err != nil {
			result.Error = &ExecutionError{
				Code:    ErrCodeValidation,
				Message: "failed to decode input files",
				Details: err.Error(),
			}
			return result
		}

		if err := e.docker.CopyToContainer(execCtx, container.ID, "/workspace/input/", decodedFiles); err != nil {
			tainted = true
			result.Error = &ExecutionError{
				Code:    ErrCodeInternalError,
				Message: "failed to copy input files to container",
				Details: err.Error(),
			}
			return result
		}
	}

	// Step 6: Write the code file to /workspace/code/ via exec+base64.
	// CopyToContainer silently fails on tmpfs mounts in macOS Docker Desktop,
	// so we encode the code as base64 and decode it inside the container.
	codeFileName, wrapperCode := e.prepareCode(req)
	codeB64 := base64.StdEncoding.EncodeToString([]byte(wrapperCode))
	codeDestPath := "/workspace/code/" + codeFileName
	writeCmd := []string{"sh", "-c",
		fmt.Sprintf("echo %s | base64 -d > %s", codeB64, codeDestPath),
	}
	writeResult, err := e.docker.ExecAsRoot(execCtx, container.ID, writeCmd)
	if err != nil || (writeResult != nil && writeResult.ExitCode != 0) {
		stderr := ""
		if writeResult != nil {
			stderr = writeResult.Stderr
		}
		tainted = true
		result.Error = &ExecutionError{
			Code:    ErrCodeInternalError,
			Message: "failed to write code file in container",
			Details: fmt.Sprintf("err=%v stderr=%s", err, stderr),
		}
		return result
	}

	// Step 7: Write stdin data to /workspace/input/_stdin.json if provided.
	if req.Stdin != "" {
		stdinB64 := base64.StdEncoding.EncodeToString([]byte(req.Stdin))
		writeStdinCmd := []string{"sh", "-c",
			fmt.Sprintf("echo %s | base64 -d > /workspace/input/_stdin.json", stdinB64),
		}
		stdinResult, stdinErr := e.docker.ExecAsRoot(execCtx, container.ID, writeStdinCmd)
		if stdinErr != nil || (stdinResult != nil && stdinResult.ExitCode != 0) {
			e.logger.Warn("failed to write stdin file",
				"execution_id", execID,
				"error", stdinErr,
			)
			// Non-fatal: skill may not need stdin.
		}
	}

	// Step 8: Build the execution command.
	baseCmd := e.buildCommand(req.Language, "/workspace/code/"+codeFileName)

	// Append user-provided arguments.
	if len(req.Args) > 0 {
		baseCmd = append(baseCmd, req.Args...)
	}

	// If stdin data is provided, wrap the command to pipe it.
	var cmd []string
	if req.Stdin != "" {
		// Wrap: cat /workspace/input/_stdin.json | <original command>
		cmdStr := strings.Join(baseCmd, " ")
		for i, arg := range req.Args {
			// Re-quote args that contain spaces for the shell wrapper.
			if strings.ContainsAny(arg, " \t\n") {
				baseCmd[len(baseCmd)-len(req.Args)+i] = fmt.Sprintf("%q", arg)
			}
		}
		cmdStr = strings.Join(baseCmd, " ")
		cmd = []string{"sh", "-c", fmt.Sprintf("cat /workspace/input/_stdin.json | %s", cmdStr)}
	} else {
		cmd = baseCmd
	}

	// Build environment variables.
	var env []string
	for k, v := range req.Environment {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}
	// Always set SKILL_INPUT_FILE so skills can find the stdin data file.
	if req.Stdin != "" {
		env = append(env, "SKILL_INPUT_FILE=/workspace/input/_stdin.json")
	}

	// Step 9: Execute the code inside the container.
	execResult, err := e.docker.ExecInContainer(execCtx, container.ID, cmd, env)
	if err != nil {
		// Check if it was a timeout.
		if execCtx.Err() == context.DeadlineExceeded {
			tainted = true // Container state is unknown after timeout.
			result.Status = StatusTimeout
			result.Error = &ExecutionError{
				Code:    ErrCodeTimeout,
				Message: fmt.Sprintf("execution timed out after %s", timeout),
			}
			return result
		}

		tainted = true
		result.Error = &ExecutionError{
			Code:    ErrCodeInternalError,
			Message: "execution failed",
			Details: err.Error(),
		}
		return result
	}

	// Step 10: Populate stdout/stderr and exit code.
	result.ExitCode = execResult.ExitCode
	result.Stdout = execResult.Stdout
	result.Stderr = execResult.Stderr

	// Step 11: Extract output files from /workspace/output/.
	outputFiles, err := e.docker.CopyFromContainer(execCtx, container.ID, "/workspace/output/")
	if err != nil {
		e.logger.Warn("failed to extract output files",
			"execution_id", execID,
			"error", err,
		)
		// Non-fatal — we still have stdout/stderr.
	} else if len(outputFiles) > 0 {
		result.OutputFiles = EncodeFilesToBase64(outputFiles)
	}

	// Step 12: Collect resource usage.
	duration := time.Since(startTime)
	result.ResourceUsage = &ResourceUsage{
		DurationMs: duration.Milliseconds(),
	}

	// Try to get container stats (best-effort).
	stats, err := e.docker.GetContainerStats(execCtx, container.ID)
	if err == nil && stats != nil {
		result.ResourceUsage.CPUTimeMs = stats.CPUTimeMs
		result.ResourceUsage.MemoryPeakBytes = stats.MemoryPeakBytes
	}

	// Determine final status.
	if execResult.ExitCode == 0 {
		result.Status = StatusCompleted
		result.Error = nil
	} else {
		// Non-zero exit code means the code itself failed (runtime error).
		// The container is still healthy and can be reused.
		result.Status = StatusFailed
		result.Error = &ExecutionError{
			Code:    ErrCodeRuntimeError,
			Message: fmt.Sprintf("process exited with code %d", execResult.ExitCode),
		}
	}

	e.logger.Info("execution completed",
		"execution_id", execID,
		"status", result.Status,
		"exit_code", execResult.ExitCode,
		"duration_ms", duration.Milliseconds(),
	)

	return result
}

// prepareCode wraps the user's code in a runtime-specific wrapper script
// that handles error capture and output management.
func (e *Executor) prepareCode(req *ExecutionRequest) (fileName string, code string) {
	userCodeFile := "user_code"

	switch req.Language {
	case "python":
		userCodeFile += e.pythonRuntime.FileExtension()
		// For Python, we use the wrapper script which exec's the user code.
		// Write the user code as-is — the wrapper handles execution.
		return userCodeFile, req.Code
	case "javascript":
		userCodeFile += e.jsRuntime.FileExtension()
		return userCodeFile, req.Code
	default:
		return "code.txt", req.Code
	}
}

// buildCommand constructs the execution command for the given language.
func (e *Executor) buildCommand(language, codeFilePath string) []string {
	switch language {
	case "python":
		return e.pythonRuntime.BuildCommand(codeFilePath)
	case "javascript":
		return e.jsRuntime.BuildCommand(codeFilePath)
	default:
		return []string{"cat", codeFilePath}
	}
}

// GetStatus returns the current status of an execution by ID.
func (e *Executor) GetStatus(executionID string) (*ExecutionTracking, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	tracking, ok := e.executions[executionID]
	return tracking, ok
}

// CleanupTracking removes old execution tracking records.
// Called periodically to prevent memory leaks.
func (e *Executor) CleanupTracking(maxAge time.Duration) {
	e.mu.Lock()
	defer e.mu.Unlock()

	cutoff := time.Now().Add(-maxAge)
	for id, tracking := range e.executions {
		if tracking.StartedAt.Before(cutoff) {
			delete(e.executions, id)
		}
	}
}
