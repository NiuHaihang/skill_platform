# =========================================
# SkillForge Core Service (NestJS)
# Multi-stage Docker build
# =========================================

# ─── Development Stage ────────────────────
FROM node:20-alpine AS development

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace files
COPY package.json pnpm-workspace.yaml turbo.json ./
COPY packages/types/package.json ./packages/types/
COPY services/core/package.json ./services/core/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/types/ ./packages/types/
COPY services/core/ ./services/core/

WORKDIR /app/services/core

EXPOSE 3001

CMD ["pnpm", "dev"]

# ─── Build Stage ──────────────────────────
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-workspace.yaml turbo.json ./
COPY packages/types/package.json ./packages/types/
COPY services/core/package.json ./services/core/

RUN pnpm install --frozen-lockfile

COPY packages/types/ ./packages/types/
COPY services/core/ ./services/core/

# Build types package first
WORKDIR /app/packages/types
RUN pnpm build

# Build core service
WORKDIR /app/services/core
RUN pnpm build

# ─── Production Stage ─────────────────────
FROM node:20-alpine AS production

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy only production essentials
COPY package.json pnpm-workspace.yaml ./
COPY packages/types/package.json ./packages/types/
COPY services/core/package.json ./services/core/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/services/core/dist ./services/core/dist
COPY --from=builder /app/packages/types/dist ./packages/types/dist

WORKDIR /app/services/core

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "dist/main"]
