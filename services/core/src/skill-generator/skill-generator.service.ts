/**
 * SkillForge — Skill Generator Service
 *
 * Core backend processing logic for converting natural language descriptions
 * into fully structured SKILL.md files.
 *
 * Architecture:
 * ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
 * │   Frontend   │────▶│  Generator   │────▶│  LLM Gateway │
 * │  (NL input)  │     │  Service     │     │  (GPT-4o)    │
 * └──────────────┘     └──────┬───────┘     └──────────────┘
 *                             │
 *                      ┌──────▼───────┐
 *                      │  Validator   │
 *                      │  + Enricher  │
 *                      └──────┬───────┘
 *                             │
 *                      ┌──────▼───────┐
 *                      │  SKILL.md    │
 *                      │  Assembler   │
 *                      └──────────────┘
 */

import * as yaml from 'yaml';
import {
  STAGE_1_SYSTEM_PROMPT,
  STAGE_2_SYSTEM_PROMPT,
  SINGLE_SHOT_SYSTEM_PROMPT,
  REFINEMENT_SYSTEM_PROMPT,
  VALID_CATEGORIES,
  buildStage1UserPrompt,
  buildStage2UserPrompt,
  buildSingleShotUserPrompt,
  buildRefinementPrompt,
} from './prompts/nl-to-skill.prompt';
import type {
  GenerateSkillRequest,
  GenerateSkillResponse,
  RefineSkillRequest,
  SkillMetadata,
  TokenUsage,
  ValidationResult,
  ValidationError,
} from './types';

// ---------------------------------------------------------------------------
// LLM Client Interface (to be implemented by LLM Gateway integration)
// ---------------------------------------------------------------------------

/**
 * LLMChatMessage represents a single message in a chat completion request.
 */
interface LLMChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * LLMChatResponse represents the response from an LLM chat completion.
 */
interface LLMChatResponse {
  content: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * LLMClient is the interface for the LLM Gateway.
 * The actual implementation lives in the llm-gw service.
 */
interface LLMClient {
  chatCompletion(
    messages: LLMChatMessage[],
    options?: {
      model?: string;
      temperature?: number;
      max_tokens?: number;
      response_format?: { type: 'json_object' | 'text' };
    },
  ): Promise<LLMChatResponse>;
}

// ---------------------------------------------------------------------------
// Skill Generator Service
// ---------------------------------------------------------------------------

export class SkillGeneratorService {
  private llm: LLMClient;
  private defaultModel: string;

  constructor(llmClient: LLMClient, defaultModel: string = 'gpt-4o') {
    this.llm = llmClient;
    this.defaultModel = defaultModel;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Public API: Generate Skill from Natural Language
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * generate() is the main entry point. It converts a user's natural language
   * description into a complete SKILL.md file.
   *
   * Pipeline:
   * 1. Input validation
   * 2. Stage 1: Extract structured metadata (JSON) via LLM
   * 3. Validate & enrich metadata
   * 4. Stage 2: Generate Markdown body via LLM
   * 5. Validate Markdown structure
   * 6. Assemble final SKILL.md (YAML + Markdown)
   * 7. Return result with warnings
   */
  async generate(req: GenerateSkillRequest): Promise<GenerateSkillResponse> {
    const warnings: string[] = [];
    const usage: TokenUsage = {
      stage1_prompt_tokens: 0,
      stage1_completion_tokens: 0,
      stage2_prompt_tokens: 0,
      stage2_completion_tokens: 0,
      total_tokens: 0,
    };

    try {
      // Step 0: Validate input.
      this.validateInput(req);

      const model = req.model || this.defaultModel;

      // Branch based on generation mode.
      if (req.mode === 'single-shot') {
        return await this.generateSingleShot(req, model);
      }

      // ── Stage 1: Extract Metadata ──────────────────────────────────────

      console.log(`[SkillGenerator] Stage 1: Extracting metadata from NL description`);

      const stage1Response = await this.llm.chatCompletion(
        [
          { role: 'system', content: STAGE_1_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildStage1UserPrompt(req.description, {
              preferredLanguage: req.preferredLanguage,
              preferredCategory: req.preferredCategory as any,
              authorName: req.authorName,
            }),
          },
        ],
        {
          model,
          temperature: 0.3, // Low temperature for structured output.
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        },
      );

      usage.stage1_prompt_tokens = stage1Response.usage.prompt_tokens;
      usage.stage1_completion_tokens = stage1Response.usage.completion_tokens;

      // Parse and validate the metadata JSON.
      let metadata: SkillMetadata;
      try {
        metadata = JSON.parse(stage1Response.content) as SkillMetadata;
      } catch (parseError) {
        throw new Error(
          `Stage 1 produced invalid JSON: ${(parseError as Error).message}\n` +
            `Raw output: ${stage1Response.content.substring(0, 500)}`,
        );
      }

      // Enrich & fix metadata.
      metadata = this.enrichMetadata(metadata, req, warnings);

      // Validate metadata.
      const metadataValidation = this.validateMetadata(metadata);
      if (!metadataValidation.valid) {
        const errors = metadataValidation.errors
          .filter((e) => e.severity === 'error')
          .map((e) => `${e.field}: ${e.message}`);
        if (errors.length > 0) {
          throw new Error(`Metadata validation failed: ${errors.join('; ')}`);
        }
      }
      warnings.push(
        ...metadataValidation.warnings,
        ...metadataValidation.errors
          .filter((e) => e.severity === 'warning')
          .map((e) => `${e.field}: ${e.message}`),
      );

      console.log(
        `[SkillGenerator] Stage 1 complete: "${metadata.name}" (${metadata.slug})`,
      );

      // ── Stage 2: Generate Markdown Body ────────────────────────────────

      console.log(`[SkillGenerator] Stage 2: Generating Markdown body`);

      const stage2Response = await this.llm.chatCompletion(
        [
          { role: 'system', content: STAGE_2_SYSTEM_PROMPT },
          {
            role: 'user',
            content: buildStage2UserPrompt(req.description, metadata as any),
          },
        ],
        {
          model,
          temperature: 0.7, // Higher temperature for creative content.
          max_tokens: 6000,
        },
      );

      usage.stage2_prompt_tokens = stage2Response.usage.prompt_tokens;
      usage.stage2_completion_tokens = stage2Response.usage.completion_tokens;

      const markdownBody = stage2Response.content.trim();

      // Validate Markdown structure.
      const mdValidation = this.validateMarkdownStructure(markdownBody);
      warnings.push(...mdValidation.warnings);

      // ── Assemble Final SKILL.md ────────────────────────────────────────

      const skillMd = this.assembleSkillMd(metadata, markdownBody);

      usage.total_tokens =
        usage.stage1_prompt_tokens +
        usage.stage1_completion_tokens +
        usage.stage2_prompt_tokens +
        usage.stage2_completion_tokens;

      console.log(
        `[SkillGenerator] Generation complete. Total tokens: ${usage.total_tokens}`,
      );

      return {
        success: true,
        skillMd,
        metadata,
        usage,
        warnings,
      };
    } catch (error) {
      console.error(`[SkillGenerator] Generation failed:`, error);
      return {
        success: false,
        skillMd: '',
        metadata: {} as SkillMetadata,
        usage,
        warnings,
        error: (error as Error).message,
      };
    }
  }

  /**
   * refine() improves an existing SKILL.md based on user feedback.
   */
  async refine(req: RefineSkillRequest): Promise<GenerateSkillResponse> {
    const warnings: string[] = [];
    const usage: TokenUsage = {
      stage1_prompt_tokens: 0,
      stage1_completion_tokens: 0,
      stage2_prompt_tokens: 0,
      stage2_completion_tokens: 0,
      total_tokens: 0,
    };

    try {
      const response = await this.llm.chatCompletion(
        [
          { role: 'system', content: REFINEMENT_SYSTEM_PROMPT },
          { role: 'user', content: buildRefinementPrompt(req.currentSkillMd, req.feedback) },
        ],
        {
          model: this.defaultModel,
          temperature: 0.5,
          max_tokens: 8000,
        },
      );

      usage.stage1_prompt_tokens = response.usage.prompt_tokens;
      usage.stage1_completion_tokens = response.usage.completion_tokens;
      usage.total_tokens = response.usage.total_tokens;

      const refinedSkillMd = this.cleanLLMOutput(response.content);

      // Parse metadata from the refined output.
      const metadata = this.parseYamlFrontMatter(refinedSkillMd);

      return {
        success: true,
        skillMd: refinedSkillMd,
        metadata,
        usage,
        warnings,
      };
    } catch (error) {
      return {
        success: false,
        skillMd: '',
        metadata: {} as SkillMetadata,
        usage,
        warnings,
        error: (error as Error).message,
      };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Single-Shot Generation (fallback / fast mode)
  // ─────────────────────────────────────────────────────────────────────────

  private async generateSingleShot(
    req: GenerateSkillRequest,
    model: string,
  ): Promise<GenerateSkillResponse> {
    const warnings: string[] = [];
    const response = await this.llm.chatCompletion(
      [
        { role: 'system', content: SINGLE_SHOT_SYSTEM_PROMPT },
        { role: 'user', content: buildSingleShotUserPrompt(req.description, req.authorName) },
      ],
      { model, temperature: 0.5, max_tokens: 8000 },
    );

    const skillMd = this.cleanLLMOutput(response.content);
    const metadata = this.parseYamlFrontMatter(skillMd);

    return {
      success: true,
      skillMd,
      metadata,
      usage: {
        stage1_prompt_tokens: response.usage.prompt_tokens,
        stage1_completion_tokens: response.usage.completion_tokens,
        stage2_prompt_tokens: 0,
        stage2_completion_tokens: 0,
        total_tokens: response.usage.total_tokens,
      },
      warnings,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Input Validation
  // ─────────────────────────────────────────────────────────────────────────

  private validateInput(req: GenerateSkillRequest): void {
    if (!req.description || req.description.trim().length === 0) {
      throw new Error('description is required');
    }

    if (req.description.length < 10) {
      throw new Error(
        'description is too short (minimum 10 characters). Please provide more details about what the Skill should do.',
      );
    }

    if (req.description.length > 10000) {
      throw new Error('description is too long (maximum 10,000 characters)');
    }

    if (!req.authorName || req.authorName.trim().length === 0) {
      throw new Error('authorName is required');
    }

    if (
      req.preferredCategory &&
      !VALID_CATEGORIES.includes(req.preferredCategory as any)
    ) {
      throw new Error(
        `Invalid category "${req.preferredCategory}". Valid categories: ${VALID_CATEGORIES.join(', ')}`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Metadata Enrichment & Validation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * enrichMetadata fills in missing fields and normalizes values.
   * This compensates for LLM inconsistencies in structured output.
   */
  private enrichMetadata(
    raw: SkillMetadata,
    req: GenerateSkillRequest,
    warnings: string[],
  ): SkillMetadata {
    const metadata = { ...raw };

    // Ensure author is set from the request.
    metadata.author = req.authorName;

    // Normalize slug: lowercase, hyphens only, no leading/trailing hyphens.
    if (metadata.slug) {
      metadata.slug = metadata.slug
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    } else {
      // Generate slug from name using pinyin or direct transliteration.
      metadata.slug = this.generateSlug(metadata.name);
      warnings.push('slug was auto-generated from name');
    }

    // Enforce version format.
    if (!metadata.version || !/^\d+\.\d+\.\d+$/.test(metadata.version)) {
      metadata.version = '1.0.0';
    }

    // Validate and fix category.
    if (!VALID_CATEGORIES.includes(metadata.category as any)) {
      warnings.push(
        `Category "${metadata.category}" is not in the predefined list. Using "productivity" as default.`,
      );
      metadata.category = 'productivity';
    }

    // Ensure tags is an array with at least 3 items.
    if (!Array.isArray(metadata.tags) || metadata.tags.length < 3) {
      warnings.push('tags should have at least 3 items');
    }

    // Default pricing.
    if (!metadata.pricing) {
      metadata.pricing = { type: 'free', price: 0, currency: 'USD' };
    }

    // Default license.
    if (!metadata.license) {
      metadata.license = 'MIT';
    }

    // Ensure token_budget has reasonable values.
    if (metadata.token_budget) {
      if (metadata.token_budget.metadata_tokens < 50) {
        metadata.token_budget.metadata_tokens = 150;
      }
      if (metadata.token_budget.full_load_tokens < 500) {
        metadata.token_budget.full_load_tokens = 2500;
      }
    } else {
      metadata.token_budget = {
        metadata_tokens: 150,
        full_load_tokens: 2500,
        avg_execution_tokens: 3000,
      };
    }

    // Ensure dependencies structure exists.
    if (!metadata.dependencies) {
      metadata.dependencies = { skills: [], packages: {} };
    }

    return metadata;
  }

  /**
   * validateMetadata performs structural validation on the extracted metadata.
   */
  private validateMetadata(metadata: SkillMetadata): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    // Required fields.
    if (!metadata.name) {
      errors.push({ field: 'name', message: 'is required', severity: 'error' });
    }
    if (!metadata.slug) {
      errors.push({ field: 'slug', message: 'is required', severity: 'error' });
    }
    if (!metadata.description) {
      errors.push({ field: 'description', message: 'is required', severity: 'error' });
    }
    if (!metadata.category) {
      errors.push({ field: 'category', message: 'is required', severity: 'error' });
    }

    // Slug format.
    if (metadata.slug && !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(metadata.slug)) {
      errors.push({
        field: 'slug',
        message: 'must be lowercase alphanumeric with hyphens',
        severity: 'error',
      });
    }

    // Recommended fields.
    if (!metadata.triggers?.keywords?.length) {
      warnings.push('triggers.keywords is empty — Skill may not be easily discovered');
    }
    if (!metadata.triggers?.intent_patterns?.length) {
      warnings.push('triggers.intent_patterns is empty — Skill routing may be less accurate');
    }

    // Validate intent patterns are valid regex.
    if (metadata.triggers?.intent_patterns) {
      for (const pattern of metadata.triggers.intent_patterns) {
        try {
          new RegExp(pattern);
        } catch {
          errors.push({
            field: 'triggers.intent_patterns',
            message: `Invalid regex: "${pattern}"`,
            severity: 'warning',
          });
        }
      }
    }

    // Capabilities consistency checks.
    if (metadata.capabilities) {
      if (
        metadata.capabilities.requires_code_execution &&
        (!metadata.capabilities.supported_languages ||
          metadata.capabilities.supported_languages.length === 0)
      ) {
        warnings.push(
          'requires_code_execution is true but supported_languages is empty',
        );
      }
    }

    return {
      valid: errors.filter((e) => e.severity === 'error').length === 0,
      errors,
      warnings,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Markdown Structure Validation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * validateMarkdownStructure checks that the generated Markdown body
   * contains all required sections.
   */
  private validateMarkdownStructure(markdown: string): {
    valid: boolean;
    warnings: string[];
  } {
    const warnings: string[] = [];
    const requiredSections = [
      { heading: '角色定义', required: true },
      { heading: '适用场景', required: true },
      { heading: '不适用场景', required: true },
      { heading: '工作流程', required: true },
      { heading: '核心指令', required: true },
      { heading: 'Few-shot 示例', required: true },
      { heading: '版本历史', required: false },
    ];

    for (const section of requiredSections) {
      if (!markdown.includes(section.heading)) {
        const level = section.required ? 'Missing required' : 'Missing recommended';
        warnings.push(`${level} section: "${section.heading}"`);
      }
    }

    // Check for at least one code block in 核心指令.
    if (markdown.includes('核心指令') && !markdown.includes('```')) {
      warnings.push('核心指令 section should contain a code block with execution instructions');
    }

    return {
      valid: warnings.filter((w) => w.startsWith('Missing required')).length === 0,
      warnings,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Assembly & Formatting
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * assembleSkillMd combines the YAML Front Matter and Markdown body
   * into a complete SKILL.md file.
   */
  private assembleSkillMd(metadata: SkillMetadata, markdownBody: string): string {
    // Convert metadata to YAML string.
    const yamlStr = yaml.stringify(metadata, {
      indent: 2,
      lineWidth: 120,
      defaultStringType: 'QUOTE_DOUBLE',
      defaultKeyType: 'PLAIN',
    });

    // Assemble the final document.
    return `---\n${yamlStr}---\n\n${markdownBody}\n`;
  }

  /**
   * cleanLLMOutput removes common LLM artifacts from the output.
   */
  private cleanLLMOutput(content: string): string {
    let cleaned = content.trim();

    // Remove wrapping ```markdown code fences.
    if (cleaned.startsWith('```markdown')) {
      cleaned = cleaned.replace(/^```markdown\n?/, '').replace(/\n?```$/, '');
    }
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```\n?/, '').replace(/\n?```$/, '');
    }

    return cleaned.trim();
  }

  /**
   * parseYamlFrontMatter extracts the YAML front matter from a SKILL.md string.
   */
  private parseYamlFrontMatter(skillMd: string): SkillMetadata {
    const match = skillMd.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      throw new Error('Could not find YAML Front Matter in the generated content');
    }

    try {
      return yaml.parse(match[1]) as SkillMetadata;
    } catch (error) {
      throw new Error(`Failed to parse YAML Front Matter: ${(error as Error).message}`);
    }
  }

  /**
   * generateSlug creates a URL-friendly slug from a name string.
   * For Chinese names, it creates a transliterated version.
   */
  private generateSlug(name: string): string {
    // Simple approach: remove non-alphanumeric chars, lowercase.
    // For Chinese text, we'd need a pinyin library in production.
    const slug = name
      .toLowerCase()
      .replace(/[\u4e00-\u9fff]+/g, (match) => {
        // Basic Chinese → placeholder mapping for common words.
        // In production, use a pinyin library like `pinyin-pro`.
        return match;
      })
      .replace(/[^a-z0-9\u4e00-\u9fff]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    // If slug is all Chinese or empty, use a timestamp-based slug.
    if (!slug || /^[\u4e00-\u9fff-]+$/.test(slug)) {
      return `skill-${Date.now().toString(36)}`;
    }

    return slug;
  }
}
