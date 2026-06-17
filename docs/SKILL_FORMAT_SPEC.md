# SkillForge — SKILL.md 格式规范 v1.0

> 本文档定义了 SkillForge 平台 Skill 的标准格式规范。
> 所有 Skill 必须遵循此规范才能被平台正确解析、加载和执行。

## 1. 文件结构

一个标准 Skill 由以下文件组成：

```
skill-name/
├── SKILL.md                    # [必需] 主文件
├── scripts/                    # [可选] 可执行脚本
├── templates/                  # [可选] 输出模板  
├── knowledge/                  # [可选] 领域知识
├── config/                     # [可选] 配置文件
├── tests/                      # [推荐] 测试用例
├── assets/                     # [可选] 静态资源
└── .skillignore                # [可选] 打包忽略规则
```

## 2. SKILL.md 结构

SKILL.md 由两部分组成：

### 2.1 YAML Front Matter（元数据层）

```yaml
---
# 基础标识 (必需)
name: "string"              # Skill 名称
slug: "string"              # URL 友好标识符 [a-z0-9-]
version: "semver"           # 语义化版本 x.y.z
author: "string"            # 作者用户名

# 分类 (必需)
category: "string"          # 主分类
tags: ["string"]            # 标签列表

# 描述 (必需 - 用于 LLM 路由)
description: "string"       # 简短描述 (建议 < 200 字)

# 触发条件 (推荐)
triggers:
  keywords: ["string"]      # 触发关键词
  intent_patterns: ["regex"] # 意图正则模式
  input_types: ["string"]    # 支持的输入类型

# 能力声明 (推荐)
capabilities:
  requires_code_execution: boolean
  requires_file_access: boolean
  requires_network: boolean
  supports_streaming: boolean
  supported_languages: ["string"]  # python, javascript, etc.

# 模型要求 (可选)
model_requirements:
  min_context_window: integer
  recommended_model: "string"
  supports_vision: boolean
  supports_function_calling: boolean

# 输入输出 Schema (推荐)
input_schema:
  type: object
  properties: {...}
  required: [...]

output_schema:
  type: object
  properties: {...}

# Token 预算 (推荐)
token_budget:
  metadata_tokens: integer    # 元数据加载消耗
  full_load_tokens: integer   # 完整内容加载消耗
  avg_execution_tokens: integer

# 依赖 (可选)
dependencies:
  skills: ["slug"]            # 依赖的其他 Skill
  packages:
    python: ["package>=version"]
    javascript: ["package@version"]

# 定价 (商店发布时必需)
pricing:
  type: "free|one_time|subscription"
  price: number
  currency: "USD"

# 许可证 (可选)
license: "MIT|Apache-2.0|proprietary"
---
```

### 2.2 Markdown 主体（指令层）

主体部分使用标准 Markdown 格式，建议包含以下章节：

```markdown
# [Skill 名称]

## 角色定义
定义此 Skill 扮演的角色和专业背景。

## 适用场景 ✅
列出此 Skill 最适合处理的场景。

## 不适用场景 ❌
明确说明此 Skill 不适合的场景，避免误用。

## 工作流程（SOP）
### Phase 1: [阶段名]
1. 步骤 1
2. 步骤 2
...

## 核心指令
LLM 需要遵循的具体执行指令。

## Few-shot 示例
### 示例 1: [场景名]
**用户输入:** ...
**期望输出:** ...

## 工具调用配置
定义此 Skill 可调用的工具及其配置。

## 版本历史
记录版本变更。
```

## 3. 分层加载规则

| 层级 | 加载内容 | 加载时机 | Token 预算 |
|------|---------|---------|-----------|
| L1 | YAML Front Matter 中的 name, description, triggers | Agent 启动 | ~150/skill |
| L2 | 完整 SKILL.md (YAML + Markdown) | LLM 判断相关 | ~2000-5000 |
| L3 | scripts/, templates/, knowledge/ | 代码执行时 | 不进 Context |

## 4. .skill 包格式

`.skill` 文件是标准 ZIP 压缩包，后缀名为 `.skill`。

### 4.1 包结构

```
name-version.skill (ZIP)
├── manifest.json           # 包清单
├── SKILL.md               # 主文件
├── scripts/               # 脚本
├── templates/             # 模板
├── knowledge/             # 知识
├── config/                # 配置
├── tests/                 # 测试
├── assets/                # 资源
├── checksums.sha256       # 文件校验和
└── signature.sig          # 数字签名 (可选)
```

### 4.2 manifest.json

```json
{
  "format_version": "1.0",
  "skill": {
    "name": "string",
    "slug": "string",
    "version": "string",
    "author": "string",
    "description": "string",
    "category": "string",
    "tags": ["string"],
    "type": "prompt|workflow|tool|hybrid",
    "license": "string"
  },
  "requirements": {
    "min_platform_version": "string",
    "capabilities": ["string"],
    "python_packages": ["string"],
    "javascript_packages": ["string"]
  },
  "files": {
    "total_count": 0,
    "total_size_bytes": 0
  },
  "created_at": "ISO8601",
  "checksum": "sha256:..."
}
```

## 5. 命名规范

- **slug**: 小写字母、数字、连字符，如 `data-analysis-expert`
- **version**: 语义化版本 (SemVer)，如 `1.2.3`
- **category**: 预定义分类集合中选择
- **tags**: 自由标签，建议 3-10 个

## 6. 预定义分类

| 分类 slug | 中文名 | 说明 |
|-----------|--------|------|
| `productivity` | 效率工具 | 通用提效类 |
| `coding` | 编程开发 | 代码相关 |
| `writing` | 写作创作 | 文案、文章 |
| `data-analysis` | 数据分析 | 数据处理与可视化 |
| `design` | 设计 | UI/UX、图像 |
| `marketing` | 营销 | 市场营销 |
| `education` | 教育 | 学习辅导 |
| `business` | 商业 | 商业分析 |
| `customer-service` | 客服 | 客户服务 |
| `translation` | 翻译 | 多语言翻译 |
| `research` | 研究 | 学术/行业研究 |
| `automation` | 自动化 | 流程自动化 |
