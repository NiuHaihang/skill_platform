import { Injectable, Logger } from '@nestjs/common';
import { SkillsService } from '../skills/skills.service';
import { SandboxService } from '../sandbox/sandbox.service';

/**
 * Result of a Skill execution in the sandbox.
 */
export interface SkillExecutionResult {
  /** Raw stdout from the sandbox process. */
  stdout: string;
  /** Raw stderr from the sandbox process. */
  stderr: string;
  /** Process exit code (0 = success). */
  exitCode: number;
  /** Whether the execution completed successfully. */
  success: boolean;
}

/**
 * SkillExecutorService encapsulates the logic for executing Skills in the sandbox.
 *
 * Responsibilities:
 * - Load L2 spec and extract executable code from SKILL.md
 * - Build standardized stdin JSON + CLI args from LLM tool-call arguments
 * - Call the sandbox service with the proper I/O contract
 * - Log execution context for observability
 *
 * This service is intentionally separated from ConversationsService to follow
 * the Single Responsibility Principle. ConversationsService handles conversation
 * management and SSE streaming; this service handles Skill execution.
 */
@Injectable()
export class SkillExecutorService {
  private readonly logger = new Logger(SkillExecutorService.name);

  constructor(
    private readonly skillsService: SkillsService,
    private readonly sandboxService: SandboxService,
  ) {}

  /**
   * Execute a Skill by its slug, passing the LLM's tool-call arguments
   * through the standardized I/O contract (stdin JSON + argv).
   *
   * @param skillSlug  The Skill's URL-friendly identifier.
   * @param toolCallArgs  The raw arguments from the LLM's tool_call (e.g., { query: "sqrt(144)" }).
   * @param language  Override the execution language (default: 'python').
   * @returns  The execution result with stdout, stderr, and exit code.
   */
  async executeSkill(
    skillSlug: string,
    toolCallArgs: Record<string, unknown>,
    language: 'python' | 'javascript' = 'python',
  ): Promise<SkillExecutionResult> {
    // ── Step 1: Load L2 Skill spec ──────────────────────────────
    const skill = await this.skillsService.findBySlugL2(skillSlug);
    if (!skill?.skillMd?.trim()) {
      this.logger.warn(`Skill '${skillSlug}' has no implementation code (skillMd is empty).`);
      return {
        stdout: '',
        stderr: `Skill '${skillSlug}' has no implementation code (skillMd is empty). Please add code to the skill.`,
        exitCode: 1,
        success: false,
      };
    }

    // ── Step 2: Extract executable code from SKILL.md ───────────
    const code = this.extractCodeFromSkillMd(skill.skillMd, language);
    if (!code.trim()) {
      // No code block found — generate a passthrough so the LLM can
      // use its own knowledge to answer.
      const query = (toolCallArgs.query || toolCallArgs.input || '') as string;
      if (!query.trim()) {
        return {
          stdout: '',
          stderr: `Skill '${skillSlug}' requires a 'query' argument but none was provided.`,
          exitCode: 1,
          success: false,
        };
      }
      return {
        stdout: JSON.stringify({
          query,
          status: 'no_code',
          message: `Skill '${skillSlug}' has no executable code. Using LLM knowledge to answer: ${query}`,
        }),
        stderr: '',
        exitCode: 0,
        success: true,
      };
    }

    // ── Step 3: Build standardized I/O ──────────────────────────
    // Strip meta params (language, files) — only pass skill-relevant args.
    const skillArgs = { ...toolCallArgs };
    delete skillArgs.language;
    delete skillArgs.files;

    // Primary query string for argv[1].
    const query = (skillArgs.query || skillArgs.input || '') as string;

    // stdin: full JSON object of all arguments.
    const stdinJson = JSON.stringify(skillArgs);

    // args: primary query as argv[1].
    const args = query ? [query] : [];

    // ── Step 4: Determine security tier ─────────────────────────
    const tier = this.determineTier(skill);

    // ── Step 5: Log execution context ───────────────────────────
    this.logger.log({
      message: 'Executing skill in sandbox',
      skillSlug,
      language,
      tier,
      codeSize: code.length,
      stdinPreview: stdinJson.slice(0, 200),
      argsPreview: args,
    });

    // ── Step 6: Execute in sandbox ──────────────────────────────
    const execResult = await this.sandboxService.execute({
      language,
      code,
      tier,
      files: (toolCallArgs.files as Record<string, string>) ?? undefined,
      stdin: stdinJson,
      args,
    });

    // ── Step 7: Log result ──────────────────────────────────────
    const success = execResult.exitCode === 0;
    this.logger.log({
      message: 'Skill execution completed',
      skillSlug,
      exitCode: execResult.exitCode,
      success,
      stdoutPreview: execResult.stdout?.slice(0, 200),
      stderrPreview: execResult.stderr?.slice(0, 200),
      durationMs: execResult.resourceUsage?.durationMs,
    });

    return {
      stdout: execResult.stdout ?? '',
      stderr: execResult.stderr ?? '',
      exitCode: execResult.exitCode ?? 1,
      success,
    };
  }

  /**
   * Extract the first code block matching the given language from SKILL.md.
   *
   * Looks for fenced code blocks like:
   * ```python
   * ...code...
   * ```
   */
  private extractCodeFromSkillMd(skillMd: string, language: string): string {
    const langPattern = language === 'python'
      ? /```python\n([\s\S]*?)```/
      : /```(?:javascript|js)\n([\s\S]*?)```/;
    const match = skillMd.match(langPattern);
    return match ? match[1] : '';
  }

  /**
   * Determine the security tier based on skill capabilities.
   * - Tier 1: No network, no file access (most restrictive)
   * - Tier 2: File access allowed
   * - Tier 3: Network access allowed
   */
  private determineTier(skill: any): 1 | 2 | 3 {
    const capabilities = skill.metadataJson?.capabilities as any;
    if (capabilities?.requiresNetwork) return 3;
    if (capabilities?.requiresFileAccess) return 2;
    return 1;
  }
}
