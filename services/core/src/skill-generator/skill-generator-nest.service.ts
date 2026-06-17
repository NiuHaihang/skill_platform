/**
 * SkillGeneratorNestService
 *
 * NestJS-integrated wrapper for the Skill generation pipeline.
 * Connects to LlmGatewayService and adapts the types correctly.
 */
import { Injectable, Logger } from '@nestjs/common';
import { LlmGatewayService } from '../llm-gateway/llm-gateway.service';
import {
  STAGE_1_SYSTEM_PROMPT,
  STAGE_2_SYSTEM_PROMPT,
  SINGLE_SHOT_SYSTEM_PROMPT,
  buildStage1UserPrompt,
  buildStage2UserPrompt,
  buildSingleShotUserPrompt,
} from './prompts/nl-to-skill.prompt';
import * as yaml from 'yaml';

export interface GenerateSkillInput {
  description: string;
  preferredCategory?: string;
  preferredLanguage?: string;
  mode?: 'two-stage' | 'single-shot';
}

export interface GenerateSkillOutput {
  success: boolean;
  skillMd: string;
  metadata: Record<string, unknown>;
  warnings: string[];
  usage: { totalTokens: number };
  error?: string;
}

@Injectable()
export class SkillGeneratorNestService {
  private readonly logger = new Logger(SkillGeneratorNestService.name);

  constructor(private readonly llmGateway: LlmGatewayService) {}

  async generateSkill(input: GenerateSkillInput): Promise<GenerateSkillOutput> {
    this.logger.log(`Generating skill for: "${input.description.slice(0, 80)}..."`);

    const mode = input.mode || 'two-stage';

    try {
      if (mode === 'two-stage') {
        return await this.generateTwoStage(input);
      } else {
        return await this.generateSingleShot(input);
      }
    } catch (error: any) {
      this.logger.error('Skill generation failed', error.message);
      return {
        success: false,
        skillMd: '',
        metadata: {},
        warnings: [],
        usage: { totalTokens: 0 },
        error: error.message,
      };
    }
  }

  private async generateTwoStage(input: GenerateSkillInput): Promise<GenerateSkillOutput> {
    let totalTokens = 0;
    const warnings: string[] = [];

    // Stage 1: Extract metadata.
    this.logger.debug('Stage 1: Extracting metadata...');
    const stage1Response = await this.llmGateway.complete({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: STAGE_1_SYSTEM_PROMPT },
        { role: 'user', content: buildStage1UserPrompt(input.description) },
      ],
      temperature: 0.3,
      maxTokens: 1000,
    });

    totalTokens += stage1Response.usage.totalTokens;

    let metadata: Record<string, unknown> = {};
    try {
      const yamlContent = stage1Response.content
        .replace(/^```yaml\n?/, '')
        .replace(/\n?```$/, '')
        .trim();
      metadata = yaml.parse(yamlContent) as Record<string, unknown>;
    } catch {
      warnings.push('Failed to parse Stage 1 metadata — using defaults');
    }

    // Stage 2: Generate full SKILL.md.
    this.logger.debug('Stage 2: Generating full spec...');
    const stage2Response = await this.llmGateway.complete({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: STAGE_2_SYSTEM_PROMPT },
        { role: 'user', content: buildStage2UserPrompt(input.description, metadata) },
      ],
      temperature: 0.5,
      maxTokens: 4096,
    });

    totalTokens += stage2Response.usage.totalTokens;

    const skillMd = stage2Response.content
      .replace(/^```markdown\n?/, '')
      .replace(/\n?```$/, '')
      .trim();

    return {
      success: true,
      skillMd,
      metadata,
      warnings,
      usage: { totalTokens },
    };
  }

  private async generateSingleShot(input: GenerateSkillInput): Promise<GenerateSkillOutput> {
    // Build a rich description that embeds the user's preferences.
    let enrichedDescription = input.description;
    if (input.preferredCategory) {
      enrichedDescription += `\n\n偏好分类: ${input.preferredCategory}`;
    }
    if (input.preferredLanguage) {
      enrichedDescription += `\n偏好编程语言: ${input.preferredLanguage}`;
    }

    const response = await this.llmGateway.complete({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SINGLE_SHOT_SYSTEM_PROMPT },
        {
          role: 'user',
          content: buildSingleShotUserPrompt(enrichedDescription),
        },
      ],
      temperature: 0.5,
      maxTokens: 4096,
    });

    const skillMd = response.content
      .replace(/^```markdown\n?/, '')
      .replace(/\n?```$/, '')
      .trim();

    return {
      success: true,
      skillMd,
      metadata: {},
      warnings: [],
      usage: { totalTokens: response.usage.totalTokens },
    };
  }
}
