/**
 * SkillForge — Skill Generator REST Controller
 *
 * HTTP endpoints for the NL-to-Skill generation pipeline.
 * These endpoints are consumed by the frontend Skill creation wizard.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { SkillGeneratorService } from './skill-generator.service';
import type { GenerateSkillRequest, RefineSkillRequest } from './types';

/**
 * Creates the Express router for skill generation endpoints.
 *
 * Routes:
 *   POST /api/v1/skills/generate     — Generate a new SKILL.md from NL description
 *   POST /api/v1/skills/refine       — Improve an existing SKILL.md based on feedback
 *   POST /api/v1/skills/preview      — Quick preview (single-shot, lower quality)
 *   POST /api/v1/skills/validate     — Validate an existing SKILL.md
 */
export function createSkillGeneratorRouter(
  generatorService: SkillGeneratorService,
): Router {
  const router = Router();

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/v1/skills/generate
  // Full two-stage generation: NL description → SKILL.md
  // ─────────────────────────────────────────────────────────────────────────
  router.post(
    '/generate',
    asyncHandler(async (req: Request, res: Response) => {
      const { description, preferredCategory, preferredLanguage, model } =
        req.body;

      // authorName comes from the authenticated user (set by auth middleware).
      const authorName =
        (req as any).user?.username || req.body.authorName || 'anonymous';

      const request: GenerateSkillRequest = {
        description,
        preferredCategory,
        preferredLanguage,
        authorName,
        mode: 'two-stage',
        model,
      };

      console.log(
        `[SkillGeneratorController] Generate request from "${authorName}": "${description.substring(0, 100)}..."`,
      );

      const result = await generatorService.generate(request);

      if (!result.success) {
        res.status(400).json({
          success: false,
          error: result.error,
          warnings: result.warnings,
        });
        return;
      }

      res.json({
        success: true,
        data: {
          skill_md: result.skillMd,
          metadata: result.metadata,
          usage: result.usage,
        },
        warnings: result.warnings,
      });
    }),
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/v1/skills/preview
  // Quick single-shot generation for real-time preview.
  // Lower quality but faster (~1 LLM call instead of 2).
  // ─────────────────────────────────────────────────────────────────────────
  router.post(
    '/preview',
    asyncHandler(async (req: Request, res: Response) => {
      const { description, model } = req.body;
      const authorName =
        (req as any).user?.username || req.body.authorName || 'anonymous';

      const request: GenerateSkillRequest = {
        description,
        authorName,
        mode: 'single-shot',
        model,
      };

      const result = await generatorService.generate(request);

      if (!result.success) {
        res.status(400).json({
          success: false,
          error: result.error,
        });
        return;
      }

      res.json({
        success: true,
        data: {
          skill_md: result.skillMd,
          metadata: result.metadata,
        },
        warnings: result.warnings,
      });
    }),
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/v1/skills/refine
  // Iteratively improve an existing SKILL.md based on user feedback.
  // ─────────────────────────────────────────────────────────────────────────
  router.post(
    '/refine',
    asyncHandler(async (req: Request, res: Response) => {
      const { current_skill_md, feedback } = req.body;
      const authorName =
        (req as any).user?.username || req.body.authorName || 'anonymous';

      if (!current_skill_md || !feedback) {
        res.status(400).json({
          success: false,
          error: 'current_skill_md and feedback are required',
        });
        return;
      }

      const request: RefineSkillRequest = {
        currentSkillMd: current_skill_md,
        feedback,
        authorName,
      };

      console.log(
        `[SkillGeneratorController] Refine request from "${authorName}": "${feedback.substring(0, 100)}..."`,
      );

      const result = await generatorService.refine(request);

      if (!result.success) {
        res.status(400).json({
          success: false,
          error: result.error,
        });
        return;
      }

      res.json({
        success: true,
        data: {
          skill_md: result.skillMd,
          metadata: result.metadata,
          usage: result.usage,
        },
        warnings: result.warnings,
      });
    }),
  );

  // ─────────────────────────────────────────────────────────────────────────
  // POST /api/v1/skills/validate
  // Validate an existing SKILL.md without regeneration.
  // ─────────────────────────────────────────────────────────────────────────
  router.post(
    '/validate',
    asyncHandler(async (req: Request, res: Response) => {
      const { skill_md } = req.body;

      if (!skill_md) {
        res.status(400).json({
          success: false,
          error: 'skill_md is required',
        });
        return;
      }

      // Parse YAML front matter.
      const yamlMatch = skill_md.match(/^---\n([\s\S]*?)\n---/);
      if (!yamlMatch) {
        res.status(400).json({
          success: false,
          error: 'Invalid SKILL.md: missing YAML Front Matter',
          details: 'File must start with --- followed by YAML metadata and another ---',
        });
        return;
      }

      try {
        const yaml = require('yaml');
        const metadata = yaml.parse(yamlMatch[1]);

        // Basic structural validation.
        const errors: string[] = [];
        const warnings: string[] = [];

        const requiredFields = ['name', 'slug', 'version', 'category', 'description'];
        for (const field of requiredFields) {
          if (!metadata[field]) {
            errors.push(`Missing required field: ${field}`);
          }
        }

        // Check Markdown sections.
        const markdownBody = skill_md.replace(/^---\n[\s\S]*?\n---\n*/, '');
        const requiredSections = ['角色定义', '适用场景', '工作流程', '核心指令'];
        for (const section of requiredSections) {
          if (!markdownBody.includes(section)) {
            warnings.push(`Missing recommended section: ${section}`);
          }
        }

        res.json({
          success: errors.length === 0,
          valid: errors.length === 0,
          metadata,
          errors,
          warnings,
        });
      } catch (error) {
        res.status(400).json({
          success: false,
          error: `YAML parsing failed: ${(error as Error).message}`,
        });
      }
    }),
  );

  return router;
}

// ---------------------------------------------------------------------------
// Async Handler Wrapper (avoids try/catch in every route)
// ---------------------------------------------------------------------------

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch((error) => {
      console.error('[SkillGeneratorController] Unhandled error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error during Skill generation',
      });
    });
  };
}
