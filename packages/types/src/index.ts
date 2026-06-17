// SkillForge Shared Types
// This package contains all TypeScript types shared between frontend and backend.

// ─────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────

export type UserRole = 'user' | 'creator' | 'admin';

export interface User {
  id: string;
  email: string;
  username: string;
  role: UserRole;
  avatarUrl?: string;
  bio?: string;
  isEmailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
}

// ─────────────────────────────────────────────
// Skill
// ─────────────────────────────────────────────

export type SkillStatus = 'draft' | 'published' | 'archived';

export type SkillCategory =
  | 'productivity'
  | 'coding'
  | 'writing'
  | 'data-analysis'
  | 'design'
  | 'marketing'
  | 'education'
  | 'business'
  | 'customer-service'
  | 'translation'
  | 'research'
  | 'automation';

/** L1 — Lightweight metadata for routing decisions (~150 tokens) */
export interface SkillMetadataL1 {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: SkillCategory;
  tags: string[];
  version: string;
  author: {
    id: string;
    username: string;
  };
  status: SkillStatus;
  triggers?: {
    keywords?: string[];
    intentPatterns?: string[];
    inputTypes?: string[];
  };
  capabilities?: {
    requiresCodeExecution?: boolean;
    requiresFileAccess?: boolean;
    requiresNetwork?: boolean;
    supportsStreaming?: boolean;
    supportedLanguages?: string[];
  };
  tokenBudget?: {
    metadataTokens: number;
    fullLoadTokens: number;
    avgExecutionTokens: number;
  };
  downloadCount: number;
  ratingAvg: number;
  createdAt: string;
  updatedAt: string;
}

/** L2 — Full skill spec including SKILL.md content (~2000-5000 tokens) */
export interface SkillFull extends SkillMetadataL1 {
  skillMd: string;
  metadataJson: Record<string, unknown>;
  pricing?: {
    type: 'free' | 'one_time' | 'subscription';
    price: number;
    currency: string;
  };
  license?: string;
  dependencies?: {
    skills?: string[];
    packages?: {
      python?: string[];
      javascript?: string[];
    };
  };
}

export interface CreateSkillRequest {
  name: string;
  description: string;
  category: SkillCategory;
  tags: string[];
  skillMd?: string;
}

export interface GenerateSkillRequest {
  description: string;
  preferredCategory?: SkillCategory;
  preferredLanguage?: 'python' | 'javascript';
  mode?: 'two-stage' | 'single-shot';
}

export interface GenerateSkillResponse {
  success: boolean;
  skillMd: string;
  metadata: Record<string, unknown>;
  warnings: string[];
  usage: {
    totalTokens: number;
  };
  error?: string;
}

// ─────────────────────────────────────────────
// Agent
// ─────────────────────────────────────────────

export type ModelProvider = 'openai' | 'anthropic' | 'groq' | 'deepseek' | 'qwen';

export interface ModelConfig {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  systemPrompt?: string;
  modelProvider: ModelProvider;
  modelName: string;
  modelConfig: ModelConfig;
  isPublic: boolean;
  skills: SkillMetadataL1[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  systemPrompt?: string;
  modelProvider: ModelProvider;
  modelName: string;
  modelConfig?: ModelConfig;
  isPublic?: boolean;
}

// ─────────────────────────────────────────────
// Conversation & Messages
// ─────────────────────────────────────────────

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  promptTokens?: number;
  completionTokens?: number;
  modelUsed?: string;
  createdAt: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  toolCallId: string;
  output: string;
  error?: string;
}

export interface Conversation {
  id: string;
  agentId: string;
  userId: string;
  title: string;
  messageCount: number;
  totalTokens: number;
  lastMessageAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SendMessageRequest {
  content: string;
  files?: Array<{
    name: string;
    content: string; // base64
  }>;
}

// ─────────────────────────────────────────────
// SSE Streaming
// ─────────────────────────────────────────────

export type SSEEventType =
  | 'message_start'
  | 'content_delta'
  | 'tool_use'
  | 'tool_result'
  | 'message_done'
  | 'error';

export interface SSEEvent {
  event: SSEEventType;
  data: {
    messageId?: string;
    delta?: string;
    toolCall?: ToolCall;
    toolResult?: ToolResult;
    usage?: {
      promptTokens: number;
      completionTokens: number;
    };
    error?: string;
  };
}

// ─────────────────────────────────────────────
// Sandbox Execution
// ─────────────────────────────────────────────

export type ExecutionStatus = 'success' | 'failed' | 'timeout' | 'oom';
export type ExecutionLanguage = 'python' | 'javascript';
export type SecurityTier = 1 | 2 | 3;

export interface ExecutionResult {
  executionId: string;
  status: ExecutionStatus;
  exitCode: number;
  stdout: string;
  stderr: string;
  outputFiles?: Record<string, string>; // filename -> base64
  resourceUsage?: {
    cpuTimeMs: number;
    memoryPeakBytes: number;
    durationMs: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

// ─────────────────────────────────────────────
// Marketplace
// ─────────────────────────────────────────────

export interface MarketplaceSearchParams {
  query?: string;
  category?: SkillCategory;
  tags?: string[];
  page?: number;
  limit?: number;
  sortBy?: 'downloads' | 'rating' | 'created_at' | 'updated_at';
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─────────────────────────────────────────────
// API Response Wrapper
// ─────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    requestId?: string;
    timestamp?: string;
  };
}
