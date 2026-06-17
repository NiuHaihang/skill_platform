# =========================================
# SkillForge Sandbox Service
# =========================================
# Go-based sandbox orchestration service.
# Manages container pools and executes user code safely.
# =========================================

FROM golang:1.22-alpine AS builder

WORKDIR /build

# Install build dependencies
RUN apk add --no-cache git ca-certificates

# Copy go.mod and go.sum first for layer caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux go build \
    -ldflags="-s -w -X main.version=$(git describe --tags --always 2>/dev/null || echo 'dev')" \
    -o /sandbox \
    ./cmd/sandbox/

# =========================================
# Production image (minimal)
# =========================================
FROM alpine:3.20

LABEL maintainer="SkillForge Team"
LABEL org.opencontainers.image.title="SkillForge Sandbox Service"
LABEL org.opencontainers.image.description="Container orchestration service for secure code execution"

# Install CA certificates and Docker CLI (needed for health checks)
RUN apk add --no-cache ca-certificates docker-cli

# Create non-root user for the service
RUN addgroup -S sandbox && adduser -S sandbox -G sandbox

# Copy binary
COPY --from=builder /sandbox /usr/local/bin/sandbox

# Copy default configuration
COPY configs/ /app/configs/

# Copy seccomp profiles
COPY configs/seccomp/ /app/configs/seccomp/

WORKDIR /app

# Note: The service needs access to Docker socket,
# so it runs as root. Internal security is enforced by
# the service itself (API key auth, request validation).
# In production, use Docker Socket Proxy to limit API access.

EXPOSE 8194

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost:8194/v1/sandbox/health || exit 1

ENTRYPOINT ["sandbox"]
CMD ["--config", "/app/configs/config.yaml"]
