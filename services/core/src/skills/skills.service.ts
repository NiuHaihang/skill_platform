import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Skill, SkillCategory, SkillStatus } from './skill.entity';
import { SkillVersion } from './skill-version.entity';
import { CreateSkillDto } from './dto/create-skill.dto';
import { UpdateSkillDto } from './dto/update-skill.dto';
import * as yaml from 'yaml';
import { v4 as uuidv4 } from 'uuid';

export interface SkillL1 {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  version: string;
  status: string;
  authorId: string;
  metadataJson: Record<string, unknown>;
  downloadCount: number;
  ratingAvg: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SkillsService {
  constructor(
    @InjectRepository(Skill)
    private readonly skillRepo: Repository<Skill>,
    @InjectRepository(SkillVersion)
    private readonly versionRepo: Repository<SkillVersion>,
  ) {}

  // ─────────────────────────────────────────────
  // CRUD Operations
  // ─────────────────────────────────────────────

  async create(dto: CreateSkillDto, authorId: string): Promise<Skill> {
    let parsedMetadata: Record<string, unknown> = {};
    let slug = dto.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // If skillMd is provided, parse the YAML front matter.
    if (dto.skillMd) {
      parsedMetadata = this.parseSkillMdMetadata(dto.skillMd);
      if ((parsedMetadata as any).name) {
        slug = String((parsedMetadata as any).name)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      }
    }

    // Ensure slug uniqueness.
    slug = await this.ensureUniqueSlug(slug);

    const skill = this.skillRepo.create({
      slug,
      name: dto.name,
      description: dto.description,
      category: dto.category,
      tags: dto.tags || [],
      authorId,
      status: dto.isPublic ? 'published' : 'draft',
      metadataJson: parsedMetadata,
      skillMd: dto.skillMd || undefined,
      version: '1.0.0',
    });

    const saved = await this.skillRepo.save(skill);

    // Create initial version history entry if skillMd provided.
    if (dto.skillMd) {
      await this.saveVersion(saved.id, '1.0.0', dto.skillMd, 'Initial version');
    }

    return saved;
  }

  async findAll(params: {
    status?: SkillStatus;
    authorId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: Skill[]; total: number }> {
    const { status, authorId, page = 1, limit = 20 } = params;

    const qb = this.skillRepo.createQueryBuilder('skill');

    if (status) qb.andWhere('skill.status = :status', { status });
    if (authorId) qb.andWhere('skill.author_id = :authorId', { authorId });

    // Only return L1 fields (no skillMd for list views).
    qb.select([
      'skill.id', 'skill.slug', 'skill.name', 'skill.description',
      'skill.category', 'skill.tags', 'skill.version', 'skill.status',
      'skill.authorId', 'skill.downloadCount', 'skill.ratingAvg',
      'skill.metadataJson', 'skill.createdAt', 'skill.updatedAt',
    ]);

    const [data, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, total };
  }

  /** L1: Returns metadata only (no skillMd). Fast and cheap. */
  async findBySlugL1(slug: string): Promise<Skill | null> {
    return this.skillRepo.findOne({
      where: { slug },
      select: [
        'id', 'slug', 'name', 'description', 'category', 'tags',
        'version', 'status', 'authorId', 'metadataJson', 'downloadCount',
        'ratingAvg', 'ratingCount', 'createdAt', 'updatedAt',
      ],
    });
  }

  /** L2: Returns full skill including skillMd. Used when executing. */
  async findBySlugL2(slug: string): Promise<Skill | null> {
    return this.skillRepo.findOne({ where: { slug } });
  }

  async findById(id: string): Promise<Skill | null> {
    return this.skillRepo.findOne({ where: { id } });
  }

  async findByIdOrThrow(id: string): Promise<Skill> {
    const skill = await this.findById(id);
    if (!skill) throw new NotFoundException(`Skill not found: ${id}`);
    return skill;
  }

  async update(id: string, dto: UpdateSkillDto, userId: string): Promise<Skill> {
    const skill = await this.findByIdOrThrow(id);
    this.assertOwner(skill, userId);

    if (dto.skillMd) {
      const parsedMeta = this.parseSkillMdMetadata(dto.skillMd);
      skill.metadataJson = parsedMeta;
      skill.skillMd = dto.skillMd;
    }

    if (dto.name) skill.name = dto.name;
    if (dto.description) skill.description = dto.description;
    if (dto.category) skill.category = dto.category;
    if (dto.tags !== undefined) skill.tags = dto.tags;

    return this.skillRepo.save(skill);
  }

  async publish(id: string, userId: string): Promise<Skill> {
    const skill = await this.findByIdOrThrow(id);
    this.assertOwner(skill, userId);

    if (!skill.skillMd) {
      throw new BadRequestException('Cannot publish a Skill without SKILL.md content');
    }

    skill.status = 'published';
    return this.skillRepo.save(skill);
  }

  async delete(id: string, userId: string, userRole: string): Promise<void> {
    const skill = await this.findByIdOrThrow(id);

    if (skill.authorId !== userId && userRole !== 'admin') {
      throw new ForbiddenException('You do not have permission to delete this Skill');
    }

    await this.skillRepo.remove(skill);
  }

  // ─────────────────────────────────────────────
  // Skill L1 list for LLM routing
  // Returns minimal metadata for all published skills of an agent.
  // ─────────────────────────────────────────────

  async getL1MetadataForAgent(skillIds: string[]): Promise<SkillL1[]> {
    if (skillIds.length === 0) return [];

    const skills = await this.skillRepo
      .createQueryBuilder('skill')
      .select([
        'skill.id', 'skill.slug', 'skill.name', 'skill.description',
        'skill.category', 'skill.tags', 'skill.version', 'skill.status',
        'skill.authorId', 'skill.metadataJson', 'skill.downloadCount',
        'skill.ratingAvg', 'skill.createdAt', 'skill.updatedAt',
      ])
      .whereInIds(skillIds)
      .andWhere('skill.status = :status', { status: 'published' })
      .getMany();

    return skills as SkillL1[];
  }

  // ─────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────

  /**
   * Parse the YAML front matter from SKILL.md.
   * The front matter is between the first pair of --- delimiters.
   */
  private parseSkillMdMetadata(skillMd: string): Record<string, unknown> {
    const frontMatterMatch = skillMd.match(/^---\n([\s\S]*?)\n---/);
    if (!frontMatterMatch) return {};

    try {
      return yaml.parse(frontMatterMatch[1]) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private async ensureUniqueSlug(baseSlug: string): Promise<string> {
    let slug = baseSlug;
    let counter = 0;

    while (true) {
      const existing = await this.skillRepo.findOne({ where: { slug } });
      if (!existing) return slug;
      counter++;
      slug = `${baseSlug}-${counter}`;
    }
  }

  private async saveVersion(
    skillId: string,
    version: string,
    skillMd: string,
    changeLog: string,
  ): Promise<void> {
    const sv = this.versionRepo.create({ skillId, version, skillMd, changeLog });
    await this.versionRepo.save(sv);
  }

  private assertOwner(skill: Skill, userId: string): void {
    if (skill.authorId !== userId) {
      throw new ForbiddenException('You do not have permission to modify this Skill');
    }
  }
}
