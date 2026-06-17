/**
 * SkillForge — Skill Generator Types
 *
 * Type definitions for the NL-to-Skill generation pipeline.
 */

// ---------------------------------------------------------------------------
// Request / Response Types
// ---------------------------------------------------------------------------

/**
 * GenerateSkillRequest is the input from the frontend when a user wants
 * to create a new Skill from a natural language description.
 */
export interface GenerateSkillRequest {
  /** The user's natural language description of what the Skill should do. */
  description: string;

  /** Optional: preferred category to guide classification. */
  preferredCategory?: string;

  /** Optional: preferred programming language. */
  preferredLanguage?: string;

  /** The author's username, injected by the auth middleware. */
  authorName: string;

  /** Optional: generation mode. Defaults to 'two-stage'. */
  mode?: 'two-stage' | 'single-shot';

  /** Optional: model to use for generation. Defaults to platform default. */
  model?: string;
}

/**
 * GenerateSkillResponse is the output of the generation pipeline.
 */
export interface GenerateSkillResponse {
  /** Whether the generation succeeded. */
  success: boolean;

  /** The generated SKILL.md content (YAML Front Matter + Markdown body). */
  skillMd: string;

  /** The parsed metadata (YAML Front Matter) as a structured object. */
  metadata: SkillMetadata;

  /** Token usage stats for the generation. */
  usage: TokenUsage;

  /** Any warnings from validation (e.g., missing recommended sections). */
  warnings: string[];

  /** Error message if generation failed. */
  error?: string;
}

/**
 * RefineSkillRequest is the input for iterative Skill improvement.
 */
export interface RefineSkillRequest {
  /** The current SKILL.md content to improve. */
  currentSkillMd: string;

  /** The user's feedback / change request. */
  feedback: string;

  /** The author's username. */
  authorName: string;
}

// ---------------------------------------------------------------------------
// Skill Metadata (mirrors YAML Front Matter schema)
// ---------------------------------------------------------------------------

export interface SkillMetadata {
  name: string;
  slug: string;
  version: string;
  author: string;
  license?: string;

  category: string;
  tags: string[];
  description: string;

  triggers: SkillTriggers;
  capabilities: SkillCapabilities;
  model_requirements: ModelRequirements;

  input_schema: JsonSchema;
  output_schema: JsonSchema;

  token_budget: TokenBudget;
  dependencies: SkillDependencies;
  pricing: SkillPricing;
}

export interface SkillTriggers {
  keywords: string[];
  intent_patterns: string[];
  input_types: string[];
}

export interface SkillCapabilities {
  requires_code_execution: boolean;
  requires_file_access: boolean;
  requires_network: boolean;
  supports_streaming: boolean;
  supported_languages: string[];
}

export interface ModelRequirements {
  min_context_window: number;
  recommended_model: string;
  supports_vision: boolean;
  supports_function_calling: boolean;
}

export interface JsonSchema {
  type: string;
  properties: Record<string, unknown>;
  required?: string[];
}

export interface TokenBudget {
  metadata_tokens: number;
  full_load_tokens: number;
  avg_execution_tokens: number;
}

export interface SkillDependencies {
  skills: string[];
  packages: {
    python?: string[];
    javascript?: string[];
  };
}

export interface SkillPricing {
  type: 'free' | 'one_time' | 'subscription';
  price: number;
  currency?: string;
}

// ---------------------------------------------------------------------------
// Internal Pipeline Types
// ---------------------------------------------------------------------------

export interface TokenUsage {
  stage1_prompt_tokens: number;
  stage1_completion_tokens: number;
  stage2_prompt_tokens: number;
  stage2_completion_tokens: number;
  total_tokens: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface ValidationError {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}
