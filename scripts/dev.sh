#!/usr/bin/env bash
# ============================================================
# SkillForge — Full Dev Launcher
# Usage: pnpm dev:all
#
# Starts in order:
#   1. Docker infra (postgres, redis, minio, docker-socket-proxy)
#   2. Sandbox Go service (on port 8194)
#   3. Turbo dev (Next.js frontend + NestJS backend)
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$ROOT_DIR/.bin"
SANDBOX_BIN="$BIN_DIR/sandbox"

# ── Color helpers ──────────────────────────────────────────
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()    { echo -e "${CYAN}[infra]${NC}   $*"; }
sandbox() { echo -e "${MAGENTA}[sandbox]${NC} $*"; }
turbo()   { echo -e "${GREEN}[turbo]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}    $*"; }
err()     { echo -e "${RED}[error]${NC}   $*" >&2; }

# ── Cleanup on exit ────────────────────────────────────────
SANDBOX_PID=""
TURBO_PID=""

cleanup() {
  echo ""
  warn "Shutting down..."
  [ -n "$TURBO_PID" ]   && kill "$TURBO_PID"   2>/dev/null || true
  [ -n "$SANDBOX_PID" ] && kill "$SANDBOX_PID" 2>/dev/null || true
  wait "$TURBO_PID"   2>/dev/null || true
  wait "$SANDBOX_PID" 2>/dev/null || true
  warn "All processes stopped. Run 'pnpm infra:down' to stop Docker containers."
}
trap cleanup EXIT INT TERM

# ────────────────────────────────────────────────────────────
# Step 1: Docker infra
# ────────────────────────────────────────────────────────────
info "Starting Docker infrastructure (postgres, redis, minio, docker-socket-proxy)..."
cd "$ROOT_DIR"
docker compose up -d postgres redis minio docker-socket-proxy

info "Waiting for postgres to be healthy..."
until docker compose exec -T postgres pg_isready -U "${POSTGRES_USER:-skillforge}" -q 2>/dev/null; do
  sleep 1
done
info "Postgres ready ✓"

info "Waiting for redis to be healthy..."
until docker compose exec -T redis redis-cli --pass "${REDIS_PASSWORD:-skillforge_redis_dev}" ping 2>/dev/null | grep -q PONG; do
  sleep 1
done
info "Redis ready ✓"

# ────────────────────────────────────────────────────────────
# Step 2: Build & start Sandbox service
# ────────────────────────────────────────────────────────────
mkdir -p "$BIN_DIR"

# Rebuild if binary missing or source changed
if [ ! -f "$SANDBOX_BIN" ]; then
  sandbox "Building sandbox binary (first run)..."
  cd "$ROOT_DIR/services/sandbox"
  go build -o "$SANDBOX_BIN" ./cmd/sandbox/
  cd "$ROOT_DIR"
  sandbox "Sandbox binary built ✓"
fi

sandbox "Starting sandbox service on :8194..."
SANDBOX_SERVER_PORT=8194 \
SANDBOX_SERVER_API_KEY="${SANDBOX_API_KEY:-sk-sandbox-dev-key}" \
"$SANDBOX_BIN" &
SANDBOX_PID=$!

# Wait for sandbox to be healthy
sandbox "Waiting for sandbox to be ready..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:8194/v1/sandbox/health > /dev/null 2>&1; then
    sandbox "Sandbox ready ✓  (pid=$SANDBOX_PID)"
    break
  fi
  if [ "$i" -eq 20 ]; then
    err "Sandbox failed to start after 20s. Check logs above."
    exit 1
  fi
  sleep 1
done

# ────────────────────────────────────────────────────────────
# Step 3: Turbo dev (frontend + backend)
# ────────────────────────────────────────────────────────────
turbo "Starting frontend + backend (turbo dev)..."
cd "$ROOT_DIR"
pnpm dev &
TURBO_PID=$!

turbo "All services running. Press Ctrl+C to stop."
echo ""
echo -e "  ${CYAN}Postgres${NC}  → localhost:5433"
echo -e "  ${CYAN}Redis${NC}     → localhost:6379"
echo -e "  ${CYAN}MinIO${NC}     → localhost:9000 (console: 9001)"
echo -e "  ${MAGENTA}Sandbox${NC}   → http://localhost:8194"
echo -e "  ${GREEN}Backend${NC}   → http://localhost:3001"
echo -e "  ${GREEN}Frontend${NC}  → http://localhost:3000"
echo ""

# Wait for turbo (main process)
wait "$TURBO_PID"
