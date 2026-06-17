# SkillForge — AI Agent Platform with Skill Marketplace

<p align="center">
  <strong>🚀 Create, Share, and Monetize AI Skills</strong>
</p>

<p align="center">
  An open-source AI Agent platform where anyone can create, share, and monetize
  reusable AI Skills through a marketplace — like an App Store for AI capabilities.
</p>

---

## ✨ Core Highlights

- **🎯 Skill Store**: Browse, search, and install reusable AI capabilities
- **📦 SKILL.md Format**: Standardized packaging for AI knowledge + workflows + tools
- **⚡ Smart Loading**: 3-tier lazy loading system saves 40-60% tokens
- **🛡️ Secure Sandbox**: gVisor/Firecracker isolated code execution
- **🔄 Visual Workflows**: DAG-based workflow editor (React Flow)
- **🤖 Multi-Model**: OpenAI, Anthropic, Groq, DeepSeek, Qwen, and more
- **📚 RAG Knowledge**: Vector-based knowledge retrieval
- **💰 Creator Economy**: Publish skills and earn revenue

## 🏗️ Architecture

```
apps/web          → Next.js 15 frontend
services/core     → NestJS backend (API + business logic)
services/sandbox  → Code execution sandbox (Go)
services/llm-gw   → LLM routing gateway
packages/ui       → Shared UI components (shadcn/ui)
packages/types    → Shared TypeScript types
packages/sdk      → Skill development SDK
```

## 🚦 Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm 9+, Docker

# Clone and install
git clone https://github.com/your-org/skillforge.git
cd skillforge
pnpm install

# Start infrastructure (PostgreSQL, Redis, MinIO)
docker compose up -d

# Run database migrations
pnpm db:migrate

# Start development
pnpm dev
```

## 📖 Documentation

- [Architecture Overview](./docs/architecture/OVERVIEW.md)
- [SKILL.md Format Specification](./docs/SKILL_FORMAT_SPEC.md)
- [API Documentation](./docs/api/)
- [Contributing Guide](./CONTRIBUTING.md)

## 🗺️ Roadmap

| Phase | Status | Features |
|-------|--------|----------|
| **MVP v0.1** | 🔨 Building | Skill CRUD, 3-tier loading, basic chat, sandbox |
| **v0.5** | 📋 Planned | Agent builder, workflows, RAG, marketplace |
| **v1.0** | 📋 Planned | Payments, multi-agent, advanced security |

## 📄 License

MIT License — see [LICENSE](./LICENSE) for details.
