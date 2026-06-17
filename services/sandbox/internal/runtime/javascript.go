// Package runtime provides runtime-specific configuration for JavaScript/Node.js execution.
package runtime

import (
	"fmt"
	"strings"
)

// JavaScriptRuntime holds configuration for executing JavaScript code in a sandbox container.
type JavaScriptRuntime struct {
	// Image is the Docker image used for Node.js execution.
	Image string

	// BasePackages are npm packages pre-installed in the base image.
	BasePackages []string
}

// NewJavaScriptRuntime creates a new JavaScriptRuntime with default settings.
func NewJavaScriptRuntime() *JavaScriptRuntime {
	return &JavaScriptRuntime{
		Image: "skillforge/sandbox-node:latest",
		BasePackages: []string{
			"axios", "lodash", "cheerio", "date-fns",
			"csv-parser", "uuid", "sharp",
		},
	}
}

// PackageWhitelist returns the allowed npm packages for the given tier.
func (r *JavaScriptRuntime) PackageWhitelist(tier int) []string {
	switch tier {
	case 1:
		// Tier 1: Pure computation, no I/O or network access.
		return []string{
			"lodash", "date-fns", "uuid", "decimal.js",
			"mathjs", "big.js", "crypto-js",
		}
	case 2:
		// Tier 2: Data processing, file parsing.
		return []string{
			"lodash", "date-fns", "uuid", "csv-parser",
			"xlsx", "sharp", "cheerio", "json5",
			"yaml", "papaparse", "marked",
		}
	case 3:
		// Tier 3: Full access including network libraries.
		return []string{
			"lodash", "date-fns", "uuid", "axios",
			"node-fetch", "cheerio", "puppeteer-core",
			"csv-parser", "xlsx", "sharp",
			"json5", "yaml", "form-data",
		}
	default:
		return nil
	}
}

// BuildCommand constructs the command to execute the JavaScript code file.
func (r *JavaScriptRuntime) BuildCommand(codeFilePath string) []string {
	return []string{"node", codeFilePath}
}

// WrapperScript returns a Node.js wrapper that captures output, handles errors,
// and enforces execution hygiene. The wrapper:
// 1. Sets up signal handlers for graceful termination.
// 2. Catches unhandled exceptions and promise rejections.
// 3. Ensures output files are flushed before exit.
// 4. Writes execution metadata for the host to collect.
func (r *JavaScriptRuntime) WrapperScript(userCodePath string) string {
	return fmt.Sprintf(`#!/usr/bin/env node
/**
 * SkillForge Sandbox Node.js Wrapper
 * Executes user code with error handling and output management.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Ensure workspace directories exist.
try {
    fs.mkdirSync('/workspace/output', { recursive: true });
} catch (e) {
    // May fail on read-only rootfs; tmpfs should handle this.
}

// Write exit metadata.
function writeMeta(exitCode) {
    try {
        const meta = JSON.stringify({ exit_code: exitCode });
        fs.writeFileSync('/workspace/output/.meta.json', meta);
    } catch (e) {
        // Best-effort metadata write.
    }
}

// Handle SIGTERM for graceful shutdown.
process.on('SIGTERM', () => {
    process.stderr.write('\n[sandbox] Execution terminated by signal\n');
    writeMeta(143);
    process.exit(143);
});

// Catch unhandled promise rejections — common source of silent failures.
process.on('unhandledRejection', (reason, promise) => {
    process.stderr.write('[sandbox] Unhandled Promise Rejection: ' + String(reason) + '\n');
    writeMeta(1);
    process.exit(1);
});

// Catch uncaught exceptions.
process.on('uncaughtException', (err) => {
    process.stderr.write('[sandbox] Uncaught Exception: ' + err.stack + '\n');
    writeMeta(1);
    process.exit(1);
});

// Execute the user's code.
try {
    require(%q);
    writeMeta(0);
} catch (err) {
    process.stderr.write(err.stack + '\n');
    writeMeta(1);
    process.exit(1);
}
`, userCodePath)
}

// FileExtension returns the file extension for JavaScript source files.
func (r *JavaScriptRuntime) FileExtension() string {
	return ".js"
}

// Language returns the canonical language name.
func (r *JavaScriptRuntime) Language() string {
	return "javascript"
}

// ValidatePackage checks if an npm package name is in the whitelist for the given tier.
func (r *JavaScriptRuntime) ValidatePackage(pkg string, tier int) bool {
	whitelist := r.PackageWhitelist(tier)
	for _, allowed := range whitelist {
		if strings.EqualFold(pkg, allowed) {
			return true
		}
	}
	return false
}
