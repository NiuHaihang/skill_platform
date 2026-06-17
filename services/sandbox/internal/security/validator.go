// Package security provides code pre-validation for the sandbox service.
// Validators scan submitted code for dangerous patterns as an early warning system.
// NOTE: These checks are advisory only — the actual security boundary is the container sandbox.
package security

import (
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"unicode/utf8"
)

// ValidationResult holds the outcome of code pre-validation.
type ValidationResult struct {
	// Valid indicates whether the code passed basic structural validation.
	Valid bool

	// Warnings are advisory messages about potentially dangerous patterns.
	// These do NOT block execution since the sandbox enforces actual security.
	Warnings []string

	// Error is set if the code fails hard validation (too large, not UTF-8, etc.).
	Error string
}

// MaxCodeSizeBytes is the maximum code size allowed (1 MB).
const MaxCodeSizeBytes = 1 * 1024 * 1024

// dangerousPattern pairs a regex with a human-readable description.
type dangerousPattern struct {
	Pattern     *regexp.Regexp
	Description string
}

// pythonDangerousPatterns are patterns that indicate potentially malicious Python code.
// These are logged as warnings but do not block execution.
var pythonDangerousPatterns = []dangerousPattern{
	{regexp.MustCompile(`os\.system\s*\(`), "os.system() call detected — may execute shell commands"},
	{regexp.MustCompile(`subprocess\.\w+\s*\(`), "subprocess usage detected — may spawn child processes"},
	{regexp.MustCompile(`__import__\s*\(\s*['"]os['"]\s*\)`), "__import__('os') detected — dynamic OS module import"},
	{regexp.MustCompile(`(?m)^\s*import\s+ctypes`), "ctypes import detected — may access raw memory"},
	{regexp.MustCompile(`(?m)^\s*from\s+ctypes\s+import`), "ctypes import detected — may access raw memory"},
	{regexp.MustCompile(`(?m)^\s*import\s+socket`), "socket import detected — may open network connections"},
	{regexp.MustCompile(`(?m)^\s*from\s+socket\s+import`), "socket import detected — may open network connections"},
	{regexp.MustCompile(`eval\s*\(\s*(?:input|raw_input|os\.)`), "eval() with dynamic input detected"},
	{regexp.MustCompile(`exec\s*\(\s*(?:open|os\.|subprocess)`), "exec() with file/OS operation detected"},
	{regexp.MustCompile(`(?m)^\s*import\s+shutil`), "shutil import detected — may perform filesystem operations"},
	{regexp.MustCompile(`open\s*\(\s*['"]/(?:etc|proc|sys|dev)/`), "attempting to read sensitive system paths"},
}

// jsDangerousPatterns are patterns that indicate potentially malicious JavaScript code.
var jsDangerousPatterns = []dangerousPattern{
	{regexp.MustCompile(`require\s*\(\s*['"]child_process['"]\s*\)`), "child_process require detected — may spawn child processes"},
	{regexp.MustCompile(`require\s*\(\s*['"]fs['"]\s*\)`), "fs module require detected — may access filesystem"},
	{regexp.MustCompile(`process\.exit\s*\(`), "process.exit() call detected — may terminate the process"},
	{regexp.MustCompile(`eval\s*\(\s*[^)]*\+`), "eval() with string concatenation detected — potential code injection"},
	{regexp.MustCompile(`new\s+Function\s*\(`), "new Function() detected — dynamic code generation"},
	{regexp.MustCompile(`require\s*\(\s*['"]net['"]\s*\)`), "net module require detected — may open network sockets"},
	{regexp.MustCompile(`require\s*\(\s*['"]dgram['"]\s*\)`), "dgram module require detected — may open UDP sockets"},
	{regexp.MustCompile(`require\s*\(\s*['"]cluster['"]\s*\)`), "cluster module require detected — may fork processes"},
	{regexp.MustCompile(`process\.env`), "process.env access detected — may read environment variables"},
}

// ValidateCode performs pre-execution validation of the submitted code.
// It checks for size limits, UTF-8 validity, and dangerous patterns.
// Dangerous patterns generate warnings but do NOT block execution.
func ValidateCode(code string, language string) ValidationResult {
	result := ValidationResult{Valid: true}

	// Hard check: code size limit.
	if len(code) > MaxCodeSizeBytes {
		result.Valid = false
		result.Error = fmt.Sprintf("code size %d bytes exceeds maximum %d bytes", len(code), MaxCodeSizeBytes)
		return result
	}

	// Hard check: UTF-8 validity. Non-UTF-8 code could contain binary payloads.
	if !utf8.ValidString(code) {
		result.Valid = false
		result.Error = "code contains invalid UTF-8 sequences"
		return result
	}

	// Hard check: empty code.
	if strings.TrimSpace(code) == "" {
		result.Valid = false
		result.Error = "code must not be empty"
		return result
	}

	// Soft checks: scan for dangerous patterns (warning-level only).
	patterns := getDangerousPatterns(language)
	for _, dp := range patterns {
		if dp.Pattern.MatchString(code) {
			warning := fmt.Sprintf("[%s] %s", strings.ToUpper(language), dp.Description)
			result.Warnings = append(result.Warnings, warning)
			slog.Warn("dangerous pattern detected in submitted code",
				"language", language,
				"pattern", dp.Description,
			)
		}
	}

	return result
}

// CheckDangerousPatterns scans the given code for dangerous patterns based on the language.
// Returns a slice of warning messages. Empty slice means no patterns detected.
func CheckDangerousPatterns(code string, language string) []string {
	var warnings []string
	patterns := getDangerousPatterns(language)

	for _, dp := range patterns {
		if dp.Pattern.MatchString(code) {
			warnings = append(warnings, dp.Description)
		}
	}

	return warnings
}

// getDangerousPatterns returns the appropriate pattern set for the given language.
func getDangerousPatterns(language string) []dangerousPattern {
	switch strings.ToLower(language) {
	case "python":
		return pythonDangerousPatterns
	case "javascript":
		return jsDangerousPatterns
	default:
		return nil
	}
}
