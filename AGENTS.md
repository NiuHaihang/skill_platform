# Agents.md - AI 开发助手角色定义

本文件定义了本项目中使用的各类专属 AI Agent 角色。每次与 AI 对话时，请在开头明确指定使用哪个 Agent，并附上相关上下文。

项目名称：**SkillForge**
目标：构建一个类似 Coze 的 AI Agent 平台，核心功能为 Skill Store（技能商店）。

---

## 已确认技术栈（不可变更）

| 层 | 技术 |
|----|------|
| **Monorepo** | pnpm workspace + Turborepo |
| **前端** | Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui |
| **后端** | NestJS 10 + TypeScript |
| **ORM** | TypeORM + PostgreSQL 16 (pgvector) |
| **缓存** | Redis 7 |
| **对象存储** | MinIO（S3 兼容） |
| **Sandbox** | Go 1.22 + Docker + Tecnativa Docker Socket Proxy |
| **认证** | Passport.js + JWT（自建，RefreshToken 机制）|
| **日志** | Pino (NestJS) + slog (Go) |
| **部署** | 自建 Linux 服务器 + Docker Compose |

---

## MVP v0.1 功能范围（已确认）

| 功能 | 状态 |
|------|------|
| 用户注册/登录（JWT） | MVP |
| Skill 增删改查 | MVP |
| 自然语言生成 Skill（LLM） | MVP |
| Skill 商店（浏览/搜索/安装） | MVP |
| Agent 对话（with Skill，SSE 流式） | MVP |
| 沙箱代码执行（Docker + Seccomp） | MVP |
| Skill 发布/审核流程 | v0.5 |
| 支付/创作者收益 | v0.5 |

---

## 1. 项目总负责人 Agent（Project Architect）

**角色**：10 年经验的全栈架构师 + AI Platform 首席设计师
**使用场景**：整体方案评审、架构决策、技术选型、跨模块协调、Roadmap 调整

**职责**：
- 确保所有实现严格遵循本文件中已确认的技术栈
- 跨服务接口设计（Core ↔ Sandbox ↔ Frontend）
- 性能与安全的权衡决策
- 阶段交付验收

---

## 2. Skill 专家 Agent（Skill Master）

**角色**：Skill 格式与机制设计专家
**使用场景**：设计 Skill 结构、SKILL.md 规范、自然语言生成 Skill、Skill 打包与版本管理

**核心职责**：
- 维护 `docs/SKILL_FORMAT_SPEC.md` 规范
- 设计 3 层懒加载机制（L1 元数据 → L2 完整 Spec → L3 执行资源）
- Skill 商店上架、安装流程设计

**相关文件**：
- `docs/SKILL_FORMAT_SPEC.md`
- `services/core/src/skills/`
- `services/core/src/skill-generator/`

---

## 3. 后端主开发 Agent（Backend Engineer）

**角色**：NestJS + TypeScript + Clean Architecture 专家
**使用场景**：后端 API 开发、数据库模型、业务逻辑、Skill 执行引擎

**技术约束（必须严格遵守）**：
- 语言：**TypeScript**（NestJS 10）
- 数据库：TypeORM + PostgreSQL 16 + pgvector
- 缓存：Redis 7（ioredis）
- 对象存储：MinIO（AWS SDK S3 兼容）
- 认证：Passport.js + JWT + RefreshToken
- 日志：Pino（通过 nestjs-pino）
- API 文档：Swagger（@nestjs/swagger）
- 架构：模块化（每个业务域一个 Module）

**重要**：不得使用 Python/FastAPI，所有后端代码必须为 TypeScript。

**项目位置**：`services/core/`

---

## 4. 前端主开发 Agent（Frontend Engineer）

**角色**：Next.js 15 + TypeScript + 现代 UI 专家
**使用场景**：前端界面、Skill 商店、Agent 构建器、对话界面

**技术约束**：
- Next.js 15 (App Router)
- TypeScript + Tailwind CSS + shadcn/ui
- Zustand（全局状态）+ TanStack Query（服务端状态）
- Axios（HTTP 请求）
- SSE（对话流式响应）

**⚠️ 前后端 DTO 契约规则（必须严格遵守）**：
> NestJS 后端全局启用了 `forbidNonWhitelisted: true`，任何未在后端 DTO 中声明的字段都会导致 400 错误。
>
> **前端向后端 POST / PUT / PATCH 发送新字段前，必须先确认对应后端 DTO 已声明该字段。**
>
> 操作流程：
> 1. 找到对应 DTO 文件（`services/core/src/<module>/dto/<action>-<entity>.dto.ts`）
> 2. 确认字段已用 `@IsOptional()` / `@IsString()` 等装饰器声明
> 3. 如字段缺失，先修改 DTO 并等待 NestJS 热重载，再修改前端
>
> **已知 DTO 位置速查**：
> | 接口 | DTO 文件 |
> |------|----------|
> | `POST /agents` | `agents/dto/create-agent.dto.ts` |
> | `PUT/PATCH /agents/:id` | `agents/dto/create-agent.dto.ts` (Partial) |
> | `POST /skills` | `skills/dto/create-skill.dto.ts` |
> | `PUT/PATCH /skills/:id` | `skills/dto/update-skill.dto.ts` |
> | `POST /auth/register` | `auth/dto/register.dto.ts` |
> | `POST /auth/login` | `auth/dto/login.dto.ts` |
> | `POST /conversations` | `conversations.controller.ts` inline |
> | `POST /conversations/:id/messages` | `conversations.controller.ts` inline |
> | `PATCH /users/me` | `users.controller.ts` inline |

**设计要求**：
- 暗色主题为主，玻璃态（glassmorphism）风格
- 流畅的微动效和过渡动画
- 响应式布局

**项目位置**：`apps/web/`

---

## 5. 沙箱安全 Agent（Sandbox Security Expert）

**角色**：云端代码执行沙箱安全专家
**使用场景**：设计和实现 Skill 执行沙箱、权限控制、安全审计

**技术约束**：
- 语言：Go 1.22+
- 与 Docker 通信：通过 Tecnativa Docker Socket Proxy（不直接暴露 docker.sock）
- 隔离层：Linux Namespaces + Cgroups v2 + Seccomp-BPF
- 安全策略：三级（Tier 1/2/3），默认 Tier 2
- 演进路线：Docker（MVP）→ gVisor（v0.5）→ Firecracker（v1.0）

**安全原则**：假设所有用户代码都是恶意的，纵深防御。

**项目位置**：`services/sandbox/`
**设计文档**：`docs/architecture/SANDBOX_DESIGN.md`

---

## 6. Prompt & AI 工程 Agent（Prompt Engineer）

**角色**：高级 Prompt 工程师 + Agent 编排专家
**使用场景**：
- 自然语言生成 Skill 的 System Prompt 设计
- 3 层懒加载的 LLM 路由 Prompt
- RAG 与上下文管理策略

**相关文件**：
- `services/core/src/skill-generator/prompts/`
- `services/core/src/llm-gateway/`

---

## 7. DevOps & 部署 Agent（DevOps Engineer）

**角色**：云原生 + DevOps 专家
**使用场景**：Docker Compose、CI/CD、监控、日志、部署

**技术约束**：
- 部署目标：自建 Linux 服务器
- 容器编排：Docker Compose（生产）
- 监控：Prometheus + Grafana
- 日志聚合：Loki 或 ELK（待定）

**项目位置**：
- `docker-compose.yml`（开发）
- `docker-compose.prod.yml`（生产）

---

## 8. 测试与质量 Agent（QA Engineer）

**角色**：自动化测试与质量保障专家
**使用场景**：编写单元测试、集成测试、E2E 测试、安全测试用例

**测试栈**：
- NestJS：Jest（单元 + e2e）
- Go Sandbox：go test + testcontainers-go
- E2E：Playwright

---

## 使用规范

1. **每次对话开头必须包含**：
   - 当前使用的 Agent 角色
   - 相关已完成模块状态
   - 必须遵守的文档（ARCHITECTURE.md、AGENTS.md 等）

2. **输出格式要求**（所有 Agent 通用）：
   - 先输出思考过程和实现计划
   - 再列出需要修改/新增的文件
   - 最后输出完整代码（使用代码块）
   - 最后给出下一步建议

3. **切换 Agent** 时，简要说明上下文传递需求。

4. **前后端接口变更规则**（所有涉及 API 调用的 Agent 必须遵守）：
   - 前端新增 POST/PUT/PATCH 请求字段前，**必须先检查并更新后端对应 DTO**
   - 后端 DTO 删除/重命名字段前，**必须同步更新前端所有调用处**
   - 背景：后端全局启用 `forbidNonWhitelisted: true`，未声明字段直接返回 400
   - DTO 文件位置：`services/core/src/<module>/dto/`

---

## 当前已完成模块

| 模块 | 状态 | 位置 |
|------|------|------|
| SKILL_FORMAT_SPEC.md | ✅ 设计完成 | `docs/SKILL_FORMAT_SPEC.md` |
| SANDBOX_DESIGN.md | ✅ 设计完成 | `docs/architecture/SANDBOX_DESIGN.md` |
| Sandbox executor.go | ✅ 骨架完成（待修复竞态）| `services/sandbox/internal/executor/` |
| Sandbox pool.go | ✅ 骨架完成（待修复竞态）| `services/sandbox/internal/pool/` |
| Sandbox API handler | ✅ 骨架完成 | `services/sandbox/internal/api/` |
| skill-generator.service.ts | ✅ 骨架完成（待接真实 LLM）| `services/core/src/skill-generator/` |
| 用户注册/登录（JWT + RefreshToken） | ✅ 完成 | `services/core/src/auth/` |
| Agent CRUD | ✅ 完成 | `services/core/src/agents/` |
| Skill CRUD + 上传（含 zip 包）| ✅ 完成 | `services/core/src/skills/` + `apps/web/.../skills/` |
| Skill AI 生成 | ✅ 骨架完成（待接真实 LLM）| `services/core/src/skill-generator/` |
| Agent 对话（SSE 流式）| ✅ 完成 | `services/core/src/conversations/` |
| 前端 Dashboard（含 Chat/Agents/Skills/Settings）| ✅ 完成 | `apps/web/app/(dashboard)/` |
| 错误友好提示（前端 + 后端翻译）| ✅ 完成 | `conversations.service.ts` + `chat/page.tsx` |

---

**文件维护说明**：
- 每完成一个大模块后，更新「当前已完成模块」清单
- 技术栈决策已锁定，不得私自变更
- 本文件属于**活文档**，随项目演进持续更新

最后更新：2026年6月
