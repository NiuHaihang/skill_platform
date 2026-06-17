// Package runtime provides runtime-specific configuration for Python execution.
package runtime

import (
	"fmt"
	"strings"
)

// PythonRuntime holds configuration for executing Python code in a sandbox container.
type PythonRuntime struct {
	// Image is the Docker image used for Python execution.
	Image string

	// BasePackages are packages pre-installed in the base image.
	BasePackages []string
}

// NewPythonRuntime creates a new PythonRuntime with default settings.
func NewPythonRuntime() *PythonRuntime {
	return &PythonRuntime{
		Image: "skillforge/sandbox-python:latest",
		BasePackages: []string{
			"pandas", "numpy", "scipy", "matplotlib",
			"requests", "beautifulsoup4", "openpyxl",
			"pillow", "scikit-learn", "seaborn",
		},
	}
}

// PackageWhitelist returns the allowed packages for the given tier.
// Higher tiers permit more packages.
func (r *PythonRuntime) PackageWhitelist(tier int) []string {
	switch tier {
	case 1:
		// Tier 1: Pure computation packages only. No I/O or network libraries.
		return []string{
			"math", "json", "csv", "collections", "itertools",
			"functools", "operator", "string", "re", "datetime",
			"decimal", "fractions", "statistics", "hashlib", "base64",
			"textwrap", "difflib", "unicodedata",
		}
	case 2:
		// Tier 2: Data analysis and file processing packages.
		return []string{
			"pandas", "numpy", "scipy", "matplotlib", "seaborn",
			"openpyxl", "pillow", "scikit-learn", "beautifulsoup4",
			"lxml", "csv", "json", "yaml", "toml",
		}
	case 3:
		// Tier 3: Full access including network libraries.
		return []string{
			"pandas", "numpy", "scipy", "matplotlib", "seaborn",
			"requests", "httpx", "aiohttp", "beautifulsoup4",
			"scrapy", "selenium", "openpyxl", "pillow",
			"scikit-learn", "tensorflow", "torch",
			"lxml", "feedparser",
		}
	default:
		return nil
	}
}

// BuildCommand constructs the command to execute the Python code file.
// The -u flag forces unbuffered stdout/stderr for real-time output capture.
func (r *PythonRuntime) BuildCommand(codeFilePath string) []string {
	return []string{"python3", "-u", codeFilePath}
}

// WrapperScript returns a Python wrapper that captures output, handles errors,
// and enforces execution hygiene. The wrapper:
// 1. Sets up signal handlers for graceful termination.
// 2. Redirects all output through a structured handler.
// 3. Catches unhandled exceptions and formats them cleanly.
// 4. Ensures output files are flushed before exit.
func (r *PythonRuntime) WrapperScript(userCodePath string) string {
	return fmt.Sprintf(`#!/usr/bin/env python3
"""
SkillForge Sandbox Python Wrapper
Executes user code with error handling and output management.
"""
import sys
import os
import signal
import traceback
import json

# Ensure workspace directories exist (they should via tmpfs, but be safe).
os.makedirs('/workspace/output', exist_ok=True)

# Set up a clean termination handler for SIGTERM.
def _sigterm_handler(signum, frame):
    sys.stderr.write('\n[sandbox] Execution terminated by signal\n')
    sys.stderr.flush()
    sys.exit(128 + signum)

signal.signal(signal.SIGTERM, _sigterm_handler)

# Restrict imports based on sandbox policy (advisory, not a security boundary).
# The container's seccomp profile and network namespace are the real barriers.
_original_import = __builtins__.__import__ if hasattr(__builtins__, '__import__') else __import__

def _exit_code(code):
    """Write exit metadata and exit."""
    try:
        meta = {'exit_code': code}
        with open('/workspace/output/.meta.json', 'w') as f:
            json.dump(meta, f)
    except Exception:
        pass
    sys.exit(code)

try:
    # Execute the user's code.
    exec(open(%q).read(), {'__name__': '__main__', '__file__': %q})
    sys.stdout.flush()
    sys.stderr.flush()
    _exit_code(0)
except SystemExit as e:
    code = e.code if isinstance(e.code, int) else 1
    sys.stdout.flush()
    sys.stderr.flush()
    _exit_code(code)
except Exception:
    traceback.print_exc(file=sys.stderr)
    sys.stderr.flush()
    _exit_code(1)
`, userCodePath, userCodePath)
}

// FileExtension returns the file extension for Python source files.
func (r *PythonRuntime) FileExtension() string {
	return ".py"
}

// Language returns the canonical language name.
func (r *PythonRuntime) Language() string {
	return "python"
}

// ValidatePackage checks if a package name is in the whitelist for the given tier.
func (r *PythonRuntime) ValidatePackage(pkg string, tier int) bool {
	whitelist := r.PackageWhitelist(tier)
	for _, allowed := range whitelist {
		if strings.EqualFold(pkg, allowed) {
			return true
		}
	}
	return false
}
