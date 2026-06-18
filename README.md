# SkillForge — AI Agent Platform with Skill Marketplace

<p align="center">
  <strong>🚀 Create, Share, and Monetize AI Skills</strong>
</p>

<p align="center">
  An open-source AI Agent platform where anyone can create, share, and monetize
  reusable AI Skills through a marketplace — like an App Store for AI capabilities.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-0.1.0--alpha-blue" alt="version" />
  <img src="https://img.shields.io/badge/status-MVP%20Building-orange" alt="status" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license" />
  <img src="https://img.shields.io/badge/Node.js-20%2B-brightgreen" alt="node" />
  <img src="https://img.shields.io/badge/Go-1.22%2B-00ADD8" alt="go" />
</p>

---

## ✨ Core Highlights

- **🎯 Skill Store**: Browse, search, and install reusable AI capabilities
- **📦 SKILL.md Format**: Standardized packaging for AI knowledge + workflows + tools
- **⚡ Smart Loading**: 3-tier lazy loading system saves 40–60% tokens
- **🛡️ Secure Sandbox**: Docker + Seccomp-BPF isolated code execution (gVisor roadmap)
- **🤖 Multi-Model**: OpenAI, Anthropic, Groq, DeepSeek, Qwen, and more
- **📚 RAG Knowledge**: Vector-based knowledge retrieval (pgvector)
- **🔐 JWT Auth**: Access + Refresh Token mechanism via Passport.js
- **💰 Creator Economy**: Publish skills and earn revenue _(v0.5)_

---

## 🏗️ Architecture

```
apps/web              → Next.js 15 frontend (App Router + shadcn/ui)
services/core         → NestJS 10 backend (API + business logic)
services/sandbox      → Code execution sandbox (Go 1.22)
packages/ui           → Shared UI components
packages/types        → Shared TypeScript types
packages/sdk          → Skill development SDK
```

### Service Ports

| Service       | Port  | Description               |
|---------------|-------|---------------------------|
| Web (Next.js) | 3000  | Frontend                  |
| Core (NestJS) | 3001  | REST API + SSE            |
| Sandbox (Go)  | 8194  | Code execution service    |
| PostgreSQL    | 5432  | Primary database          |
| Redis         | 6379  | Cache + session store     |
| MinIO S3 API  | 9000  | Object storage            |
| MinIO Console | 9001  | MinIO web UI              |

---

## 🛠️ Tech Stack

| Layer           | Technology                                              |
|-----------------|---------------------------------------------------------|
| **Monorepo**    | pnpm workspace + Turborepo 2                            |
| **Frontend**    | Next.js 15 (App Router) · TypeScript · Tailwind CSS · shadcn/ui |
| **State**       | Zustand (client) · TanStack Query (server)              |
| **Backend**     | NestJS 10 · TypeScript                                  |
| **ORM**         | TypeORM + PostgreSQL 16 (pgvector)                      |
| **Cache**       | Redis 7 (ioredis)                                       |
| **Object Store**| MinIO (S3-compatible)                                   |
| **Sandbox**     | Go 1.22 · Docker · Tecnativa Docker Socket Proxy        |
| **Auth**        | Passport.js · JWT · RefreshToken                        |
| **LLM**         | OpenAI · Anthropic · Groq · DeepSeek _(via LLM Gateway)_ |
| **Logging**     | Pino (NestJS) · slog (Go)                               |
| **API Docs**    | Swagger / OpenAPI (`/api/docs`)                         |
| **Deploy**      | Docker Compose · Linux server                           |

---

## 📦 Current Module Status

| Module                        | Status              | Location                                       |
|-------------------------------|---------------------|------------------------------------------------|
| `SKILL_FORMAT_SPEC.md`        | ✅ 设计完成          | `docs/SKILL_FORMAT_SPEC.md`                    |
| `SANDBOX_DESIGN.md`           | ✅ 设计完成          | `docs/architecture/SANDBOX_DESIGN.md`          |
| Auth (JWT + Refresh)          | ✅ 完成              | `services/core/src/auth/`                      |
| Users module                  | ✅ 完成              | `services/core/src/users/`                     |
| Skills CRUD                   | ✅ 完成              | `services/core/src/skills/`                    |
| Agents module                 | ✅ 完成              | `services/core/src/agents/`                    |
| Conversations module          | ✅ 完成              | `services/core/src/conversations/`             |
| Marketplace module            | ✅ 完成              | `services/core/src/marketplace/`               |
| LLM Gateway                   | ✅ 骨架完成          | `services/core/src/llm-gateway/`               |
| Skill Generator               | 🔨 骨架完成（待接 LLM）| `services/core/src/skill-generator/`          |
| Sandbox executor.go           | 🔨 骨架完成（待修复竞态）| `services/sandbox/internal/executor/`        |
| Sandbox pool.go               | 🔨 骨架完成（待修复竞态）| `services/sandbox/internal/pool/`            |
| Sandbox API handler           | 🔨 骨架完成          | `services/sandbox/internal/api/`               |
| Frontend (Next.js)            | 🔨 进行中            | `apps/web/`                                    |

---

## 🚦 Quick Start

### Prerequisites

| Tool       | Version  | Install                                      |
|------------|----------|----------------------------------------------|
| Node.js    | ≥ 20     | [nodejs.org](https://nodejs.org)             |
| pnpm       | ≥ 9      | `npm install -g pnpm`                        |
| Go         | ≥ 1.22   | [go.dev](https://go.dev/dl/)                 |
| Docker     | latest   | [docker.com](https://www.docker.com)         |

### 1. Clone & Install

```bash
git clone https://github.com/your-org/skillforge.git
cd skillforge
pnpm install
```

### 2. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` and fill in the required values:

```bash
# Generate secure JWT secrets
openssl rand -hex 64   # paste into JWT_SECRET
openssl rand -hex 64   # paste into JWT_REFRESH_SECRET

# Fill in at least one LLM API key
OPENAI_API_KEY=sk-...
# or
ANTHROPIC_API_KEY=sk-ant-...
```

### 3. Start Infrastructure

```bash
# Start PostgreSQL 16, Redis 7, MinIO, Docker Socket Proxy
docker compose up -d postgres redis minio docker-socket-proxy

# Wait for services to be healthy, then run DB migrations
pnpm db:migrate
```

### 4. Start Services

```bash
# Option A — Start all services via Turborepo (recommended)
pnpm dev

# Option B — Start services individually
pnpm --filter @skillforge/core dev       # NestJS on :3001
pnpm --filter @skillforge/web dev        # Next.js on :3000
cd services/sandbox && go run ./cmd/...  # Go sandbox on :8194
```

### 5. Verify

| URL                              | Description            |
|----------------------------------|------------------------|
| http://localhost:3000            | Frontend               |
| http://localhost:3001/api/docs   | Swagger API docs       |
| http://localhost:3001/health     | Core service health    |
| http://localhost:8194/v1/sandbox/health | Sandbox health  |
| http://localhost:9001            | MinIO web console      |

---

## 📖 Documentation

- [Architecture Overview](./docs/architecture/OVERVIEW.md)
- [SKILL.md Format Specification](./docs/SKILL_FORMAT_SPEC.md)
- [Sandbox Security Design](./docs/architecture/SANDBOX_DESIGN.md)
- [API Documentation](http://localhost:3001/api/docs) _(local)_
- [Contributing Guide](./CONTRIBUTING.md)

---

## 🗺️ Roadmap

| Phase        | Status        | Features                                                    |
|--------------|---------------|-------------------------------------------------------------|
| **MVP v0.1** | 🔨 Building   | Auth · Skill CRUD · 3-tier loading · Chat (SSE) · Sandbox  |
| **v0.5**     | 📋 Planned    | Agent builder · DAG workflows · RAG · Marketplace · Skill 审核 |
| **v1.0**     | 📋 Planned    | Payments · Creator economy · Multi-agent · gVisor sandbox   |

---

## 📄 License

MIT License — see [LICENSE](./LICENSE) for details.
