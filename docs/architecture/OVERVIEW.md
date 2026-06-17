# SkillForge 架构总览

## 系统上下文

```mermaid
C4Context
    title SkillForge — 系统上下文图

    Person(user, "普通用户", "浏览商店、安装 Skill、与 Agent 对话")
    Person(creator, "Skill 创作者", "创建、测试、发布 Skill")
    Person(admin, "平台管理员", "审核、监控、管理")

    System(skillforge, "SkillForge Platform", "AI Agent 平台 + Skill 商店")

    System_Ext(llm, "LLM Providers", "OpenAI / Anthropic / Groq / DeepSeek")
    System_Ext(payment, "支付网关", "Stripe / 支付宝")
    System_Ext(storage, "对象存储", "S3 / MinIO")

    Rel(user, skillforge, "使用")
    Rel(creator, skillforge, "创建与发布")
    Rel(admin, skillforge, "管理")
    Rel(skillforge, llm, "API 调用")
    Rel(skillforge, payment, "支付处理")
    Rel(skillforge, storage, "文件存储")
```

## 服务拓扑

```mermaid
graph TB
    subgraph "客户端"
        WEB["Web App<br/>(Next.js 15)"]
        CLI["CLI 工具<br/>(Skill SDK)"]
        API_CLIENT["API Client<br/>(SDK)"]
    end

    subgraph "网关"
        GW["API Gateway<br/>(Nginx/Kong)"]
    end

    subgraph "应用服务"
        CORE["Core Service<br/>(NestJS)"]
        LLM_GW["LLM Gateway<br/>(NestJS)"]
        SANDBOX["Sandbox<br/>(Go)"]
        WORKER["Worker<br/>(BullMQ)"]
    end

    subgraph "数据存储"
        PG["PostgreSQL 16<br/>(+ pgvector)"]
        REDIS["Redis 7"]
        MINIO["MinIO / S3"]
        CH["ClickHouse<br/>(Logs)"]
    end

    WEB --> GW
    CLI --> GW
    API_CLIENT --> GW

    GW --> CORE
    GW --> LLM_GW

    CORE --> PG
    CORE --> REDIS
    CORE --> MINIO
    CORE --> SANDBOX
    CORE --> WORKER
    CORE --> LLM_GW

    LLM_GW --> REDIS

    WORKER --> PG
    WORKER --> MINIO
    WORKER --> CH

    SANDBOX --> MINIO
```

## 核心概念关系

```mermaid
graph LR
    USER["👤 用户"] -->|创建| SKILL["📦 Skill"]
    USER -->|创建| AGENT["🤖 Agent"]
    USER -->|发起| CONV["💬 对话"]

    SKILL -->|安装到| AGENT
    SKILL -->|发布到| MARKET["🏪 商店"]
    SKILL -->|打包为| PKG[".skill 包"]
    SKILL -->|包含| RES["📁 资源<br/>(脚本/模板/知识)"]

    AGENT -->|使用| SKILL
    AGENT -->|关联| WF["🔄 工作流"]
    AGENT -->|绑定| KB["📚 知识库"]
    AGENT -->|配置| MODEL["🧠 模型"]

    CONV -->|路由| SKILL
    CONV -->|产生| MSG["📨 消息"]
    MSG -->|触发| EXEC["⚙️ 执行<br/>(沙箱)"]

    MARKET -->|交易| ORDER["💰 订单"]
```

## 请求处理流程

```
1. 用户发送消息
   ↓
2. API Gateway 路由 → Core Service
   ↓
3. 认证 & 权限验证
   ↓
4. Skill Router (L1: 加载元数据, ~150 tokens/skill)
   ↓
5. LLM 路由推理 (轻量模型: GPT-4o-mini)
   → 判断哪个 Skill 与用户意图相关
   ↓
6. Skill Loader (L2: 加载完整 SKILL.md, ~2500 tokens)
   ↓
7. 组装完整 Prompt = System + Skill 指令 + 对话历史 + 用户消息
   ↓
8. LLM 推理 (标准模型: GPT-4o)
   → 返回回答 或 tool_call 决策
   ↓
9. [如有 tool_call] Skill Loader (L3: 加载脚本/模板)
   → Sandbox 执行代码
   → 返回结果
   ↓
10. LLM 合成最终回答
   ↓
11. SSE 流式返回给用户
   ↓
12. 保存消息 + 执行日志 + Token 统计
```

## 安全架构

```mermaid
graph TB
    subgraph "公网"
        CLIENT["客户端"]
    end

    subgraph "DMZ"
        WAF["WAF / CDN"]
        GW["API Gateway<br/>Rate Limit + Auth"]
    end

    subgraph "应用层"
        APP["应用服务<br/>RBAC 权限控制"]
    end

    subgraph "执行层 (隔离区)"
        SB["沙箱集群<br/>gVisor / Firecracker"]
    end

    subgraph "数据层"
        DB["数据库<br/>加密 + RLS"]
        OBJ["对象存储<br/>签名 URL"]
    end

    CLIENT -->|HTTPS| WAF
    WAF --> GW
    GW -->|JWT 验证| APP
    APP -->|隔离通信| SB
    APP -->|加密连接| DB
    APP -->|签名访问| OBJ

    style SB fill:#ff6b6b,color:#fff
    style GW fill:#4ecdc4,color:#fff
    style DB fill:#45b7d1,color:#fff
```

## 数据流总览

| 数据流 | 协议 | 说明 |
|--------|------|------|
| 前端 ↔ API | HTTPS + SSE | REST API + 流式响应 |
| API ↔ LLM | HTTPS | 模型 API 调用 |
| API ↔ DB | TCP (加密) | PostgreSQL 协议 |
| API ↔ Redis | TCP | 缓存读写 |
| API ↔ Sandbox | HTTP/gRPC | 代码执行请求 |
| API ↔ S3 | HTTPS | 文件上传/下载 |
| Worker ↔ Queue | Redis Protocol | 任务分发 |
