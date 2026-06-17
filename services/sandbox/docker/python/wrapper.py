#!/usr/bin/env python3
"""
SkillForge Sandbox Execution Wrapper v1.0
=========================================
Safely wraps user code execution inside the sandbox container.

Responsibilities:
1. Set up the execution environment (paths, working directory)
2. Redirect stdout/stderr for capture
3. Execute user code with error handling
4. Collect output files from /workspace/output/
5. Write structured result to _result.json
6. Enforce output size limits

This file is IMMUTABLE inside the container (chmod 444).
"""
import sys
import json
import time
import traceback
import os
import resource
import signal

# === Constants ===
WORKSPACE = "/workspace"
CODE_DIR = os.path.join(WORKSPACE, "code")
INPUT_DIR = os.path.join(WORKSPACE, "input")
OUTPUT_DIR = os.path.join(WORKSPACE, "output")
RESULT_FILE = os.path.join(OUTPUT_DIR, "_result.json")

MAX_STDOUT_BYTES = 1_000_000    # 1 MB
MAX_STDERR_BYTES = 100_000      # 100 KB
MAX_OUTPUT_FILE_SIZE = 10_000_000  # 10 MB per file
MAX_OUTPUT_FILES = 20


def _timeout_handler(signum, frame):
    """Handle execution timeout signal."""
    raise TimeoutError("Execution time limit exceeded")


def setup():
    """Initialize the execution environment."""
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Add code and input directories to Python path
    sys.path.insert(0, CODE_DIR)
    sys.path.insert(0, INPUT_DIR)

    # Set working directory to input (convenient for user code to read files)
    if os.path.exists(INPUT_DIR):
        os.chdir(INPUT_DIR)
    else:
        os.chdir(WORKSPACE)

    # Set up signal handler for graceful timeout
    signal.signal(signal.SIGALRM, _timeout_handler)


def collect_output_files():
    """Collect output files from the output directory."""
    files = []
    if not os.path.exists(OUTPUT_DIR):
        return files

    for filename in sorted(os.listdir(OUTPUT_DIR)):
        # Skip internal result file
        if filename.startswith("_"):
            continue

        filepath = os.path.join(OUTPUT_DIR, filename)
        if not os.path.isfile(filepath):
            continue

        file_size = os.path.getsize(filepath)
        if file_size > MAX_OUTPUT_FILE_SIZE:
            files.append({
                "name": filename,
                "size": file_size,
                "path": filepath,
                "error": f"File too large ({file_size} bytes, max {MAX_OUTPUT_FILE_SIZE})"
            })
            continue

        if len(files) >= MAX_OUTPUT_FILES:
            break

        files.append({
            "name": filename,
            "size": file_size,
            "path": filepath,
        })

    return files


def execute():
    """Execute user code and collect results."""
    start_time = time.monotonic()

    result = {
        "status": "success",
        "stdout": "",
        "stderr": "",
        "error": None,
        "error_type": None,
        "error_traceback": None,
        "output_files": [],
        "duration_ms": 0,
        "memory_peak_kb": 0,
    }

    # Capture stdout/stderr
    from io import StringIO
    captured_stdout = StringIO()
    captured_stderr = StringIO()
    old_stdout, old_stderr = sys.stdout, sys.stderr
    sys.stdout = captured_stdout
    sys.stderr = captured_stderr

    try:
        # Dynamically import and execute user code
        # The user's code should be at /workspace/code/run.py
        import importlib.util

        code_path = os.path.join(CODE_DIR, "run.py")
        if not os.path.exists(code_path):
            raise FileNotFoundError(
                f"User code not found at {code_path}. "
                "Ensure the code file is named 'run.py'."
            )

        spec = importlib.util.spec_from_file_location("user_code", code_path)
        if spec is None or spec.loader is None:
            raise ImportError(f"Cannot load module from {code_path}")

        user_module = importlib.util.module_from_spec(spec)

        # Execute the module (this runs top-level code)
        spec.loader.exec_module(user_module)

        # If user module has a main() function, call it
        if hasattr(user_module, "main") and callable(user_module.main):
            main_result = user_module.main()
            # If main returns something, print it
            if main_result is not None:
                print(main_result)

    except TimeoutError as e:
        result["status"] = "timeout"
        result["error"] = str(e)
        result["error_type"] = "TimeoutError"

    except MemoryError as e:
        result["status"] = "oom"
        result["error"] = "Out of memory"
        result["error_type"] = "MemoryError"

    except SystemExit as e:
        # Allow SystemExit(0) as success
        if e.code == 0:
            pass
        else:
            result["status"] = "error"
            result["error"] = f"Process exited with code {e.code}"
            result["error_type"] = "SystemExit"

    except KeyboardInterrupt:
        result["status"] = "cancelled"
        result["error"] = "Execution was interrupted"
        result["error_type"] = "KeyboardInterrupt"

    except Exception as e:
        result["status"] = "error"
        result["error"] = f"{type(e).__name__}: {str(e)}"
        result["error_type"] = type(e).__name__
        result["error_traceback"] = traceback.format_exc()
        # Also write traceback to stderr
        captured_stderr.write(traceback.format_exc())

    finally:
        # Restore stdout/stderr
        sys.stdout = old_stdout
        sys.stderr = old_stderr

    # Collect captured output (with size limits)
    stdout_content = captured_stdout.getvalue()
    stderr_content = captured_stderr.getvalue()

    result["stdout"] = stdout_content[:MAX_STDOUT_BYTES]
    if len(stdout_content) > MAX_STDOUT_BYTES:
        result["stdout"] += f"\n... [truncated, {len(stdout_content)} total bytes]"

    result["stderr"] = stderr_content[:MAX_STDERR_BYTES]
    if len(stderr_content) > MAX_STDERR_BYTES:
        result["stderr"] += f"\n... [truncated, {len(stderr_content)} total bytes]"

    # Timing
    result["duration_ms"] = int((time.monotonic() - start_time) * 1000)

    # Resource usage
    try:
        usage = resource.getrusage(resource.RUSAGE_CHILDREN)
        result["memory_peak_kb"] = usage.ru_maxrss
    except Exception:
        pass

    # Collect output files
    result["output_files"] = collect_output_files()

    # Write structured result to file
    try:
        with open(RESULT_FILE, "w", encoding="utf-8") as fp:
            json.dump(result, fp, ensure_ascii=False, default=str)
    except Exception as write_err:
        # If we can't write the result file, at least print to stdout
        print(f"WARNING: Could not write result file: {write_err}",
              file=sys.stderr)

    # Also output the result as JSON to stdout for docker exec capture
    # Use the original stdout (not captured)
    try:
        print(json.dumps(result, ensure_ascii=False, default=str))
    except Exception:
        print(json.dumps({
            "status": "error",
            "error": "Failed to serialize result"
        }))


if __name__ == "__main__":
    setup()
    execute()
