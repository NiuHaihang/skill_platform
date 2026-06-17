/**
 * SkillForge Sandbox Execution Wrapper - Node.js
 * ================================================
 * Safely wraps user code execution inside the sandbox container.
 *
 * Responsibilities:
 * 1. Set up the execution environment
 * 2. Redirect stdout/stderr for capture
 * 3. Execute user code with error handling
 * 4. Collect output files from /workspace/output/
 * 5. Write structured result to _result.json
 *
 * This file is IMMUTABLE inside the container (chmod 444).
 */

const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const vm = require('vm');

// === Constants ===
const WORKSPACE = '/workspace';
const CODE_DIR = path.join(WORKSPACE, 'code');
const INPUT_DIR = path.join(WORKSPACE, 'input');
const OUTPUT_DIR = path.join(WORKSPACE, 'output');
const RESULT_FILE = path.join(OUTPUT_DIR, '_result.json');

const MAX_STDOUT_BYTES = 1_000_000;    // 1 MB
const MAX_STDERR_BYTES = 100_000;      // 100 KB
const MAX_OUTPUT_FILE_SIZE = 10_000_000; // 10 MB
const MAX_OUTPUT_FILES = 20;

/**
 * Collect output files from the output directory.
 */
function collectOutputFiles() {
  const files = [];
  if (!fs.existsSync(OUTPUT_DIR)) return files;

  const entries = fs.readdirSync(OUTPUT_DIR).sort();
  for (const filename of entries) {
    if (filename.startsWith('_')) continue;

    const filepath = path.join(OUTPUT_DIR, filename);
    const stat = fs.statSync(filepath);

    if (!stat.isFile()) continue;

    if (stat.size > MAX_OUTPUT_FILE_SIZE) {
      files.push({
        name: filename,
        size: stat.size,
        path: filepath,
        error: `File too large (${stat.size} bytes, max ${MAX_OUTPUT_FILE_SIZE})`,
      });
      continue;
    }

    if (files.length >= MAX_OUTPUT_FILES) break;

    files.push({
      name: filename,
      size: stat.size,
      path: filepath,
    });
  }

  return files;
}

/**
 * Main execution function.
 */
async function execute() {
  const startTime = performance.now();

  const result = {
    status: 'success',
    stdout: '',
    stderr: '',
    error: null,
    error_type: null,
    error_traceback: null,
    output_files: [],
    duration_ms: 0,
    memory_peak_kb: 0,
  };

  // Ensure output directory exists
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Capture stdout/stderr
  let stdoutBuffer = '';
  let stderrBuffer = '';

  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  process.stdout.write = (chunk) => {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    if (stdoutBuffer.length < MAX_STDOUT_BYTES) {
      stdoutBuffer += str;
    }
    return true;
  };

  process.stderr.write = (chunk) => {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    if (stderrBuffer.length < MAX_STDERR_BYTES) {
      stderrBuffer += str;
    }
    return true;
  };

  try {
    const codePath = path.join(CODE_DIR, 'run.js');
    if (!fs.existsSync(codePath)) {
      throw new Error(
        `User code not found at ${codePath}. Ensure the code file is named 'run.js'.`
      );
    }

    // Change working directory to input
    if (fs.existsSync(INPUT_DIR)) {
      process.chdir(INPUT_DIR);
    }

    // Load and execute user code
    const userCode = fs.readFileSync(codePath, 'utf-8');

    // Create a module-like context for execution
    const userModule = { exports: {} };
    const wrappedCode = `(async function(module, exports, require, __filename, __dirname) {\n${userCode}\n})`;

    const compiledFn = vm.compileFunction(userCode, ['module', 'exports', 'require', '__filename', '__dirname'], {
      filename: codePath,
    });

    // Execute with a custom require that limits access
    const safeRequire = (moduleName) => {
      // Allow built-in modules and pre-installed packages
      const blocked = ['child_process', 'cluster', 'dgram', 'dns', 'net', 'tls', 'http2'];
      if (blocked.includes(moduleName)) {
        throw new Error(`Module '${moduleName}' is not allowed in sandbox`);
      }
      return require(moduleName);
    };

    await compiledFn(userModule, userModule.exports, safeRequire, codePath, CODE_DIR);

    // If module exports a main function, call it
    if (typeof userModule.exports === 'function') {
      const mainResult = await userModule.exports();
      if (mainResult !== undefined) {
        console.log(typeof mainResult === 'string' ? mainResult : JSON.stringify(mainResult));
      }
    } else if (typeof userModule.exports.main === 'function') {
      const mainResult = await userModule.exports.main();
      if (mainResult !== undefined) {
        console.log(typeof mainResult === 'string' ? mainResult : JSON.stringify(mainResult));
      }
    }

  } catch (err) {
    result.status = 'error';
    result.error = `${err.name || 'Error'}: ${err.message}`;
    result.error_type = err.name || 'Error';
    result.error_traceback = err.stack || '';
    stderrBuffer += (err.stack || err.message) + '\n';

  } finally {
    // Restore stdout/stderr
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  // Collect results
  result.stdout = stdoutBuffer.slice(0, MAX_STDOUT_BYTES);
  if (stdoutBuffer.length > MAX_STDOUT_BYTES) {
    result.stdout += `\n... [truncated, ${stdoutBuffer.length} total bytes]`;
  }

  result.stderr = stderrBuffer.slice(0, MAX_STDERR_BYTES);
  if (stderrBuffer.length > MAX_STDERR_BYTES) {
    result.stderr += `\n... [truncated, ${stderrBuffer.length} total bytes]`;
  }

  result.duration_ms = Math.round(performance.now() - startTime);

  // Memory usage
  const memUsage = process.memoryUsage();
  result.memory_peak_kb = Math.round(memUsage.rss / 1024);

  // Collect output files
  result.output_files = collectOutputFiles();

  // Write result file
  try {
    fs.writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2), 'utf-8');
  } catch (writeErr) {
    process.stderr.write(`WARNING: Could not write result file: ${writeErr.message}\n`);
  }

  // Output to stdout for docker exec capture
  originalStdoutWrite(JSON.stringify(result) + '\n');
}

// Run
execute().catch((err) => {
  const errorResult = {
    status: 'error',
    error: `Wrapper error: ${err.message}`,
    error_type: 'WrapperError',
  };
  process.stdout.write(JSON.stringify(errorResult) + '\n');
  process.exit(1);
});
