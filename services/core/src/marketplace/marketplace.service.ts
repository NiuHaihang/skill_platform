import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like, FindOptionsWhere } from 'typeorm';
import { Skill, SkillCategory } from '../skills/skill.entity';

export interface MarketplaceSearchQuery {
  query?: string;
  category?: SkillCategory;
  page?: number;
  limit?: number;
  sortBy?: 'downloads' | 'rating' | 'created_at';
  sortOrder?: 'ASC' | 'DESC';
}

@Injectable()
export class MarketplaceService {
  constructor(
    @InjectRepository(Skill)
    private readonly skillRepo: Repository<Skill>,
  ) {}

  async search(params: MarketplaceSearchQuery): Promise<{ data: Skill[]; total: number }> {
    const { query, category, page = 1, limit = 20, sortBy = 'downloads', sortOrder = 'DESC' } = params;

    const qb = this.skillRepo.createQueryBuilder('skill')
      .select([
        'skill.id', 'skill.slug', 'skill.name', 'skill.description',
        'skill.category', 'skill.tags', 'skill.version', 'skill.authorId',
        'skill.downloadCount', 'skill.ratingAvg', 'skill.ratingCount',
        'skill.metadataJson', 'skill.createdAt',
      ])
      .where('skill.status = :status', { status: 'published' });

    if (category) {
      qb.andWhere('skill.category = :category', { category });
    }

    if (query) {
      qb.andWhere(
        '(skill.name ILIKE :query OR skill.description ILIKE :query)',
        { query: `%${query}%` },
      );
    }

    const orderField = sortBy === 'downloads' ? 'skill.downloadCount'
      : sortBy === 'rating' ? 'skill.ratingAvg'
      : 'skill.createdAt';

    qb.orderBy(orderField, sortOrder)
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async getFeatured(): Promise<Skill[]> {
    return this.skillRepo.find({
      where: { status: 'published' },
      order: { downloadCount: 'DESC' },
      take: 12,
      select: [
        'id', 'slug', 'name', 'description', 'category', 'tags',
        'version', 'authorId', 'downloadCount', 'ratingAvg', 'metadataJson', 'createdAt',
      ],
    });
  }

  async incrementDownloads(skillId: string): Promise<void> {
    await this.skillRepo.increment({ id: skillId }, 'downloadCount', 1);
  }
}
