import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  ManyToMany,
  JoinColumn,
  JoinTable,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../users/user.entity';

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

@Entity('skills')
export class Skill {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'URL-friendly unique identifier' })
  @Column({ type: 'varchar', length: 100, unique: true })
  @Index()
  slug: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @ApiProperty({ description: 'Short description used for LLM routing (L1)' })
  @Column({ type: 'text' })
  description: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 50 })
  @Index()
  category: SkillCategory;

  @ApiProperty({ type: [String] })
  @Column({ type: 'text', array: true, default: [] })
  tags: string[];

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'author_id' })
  author: User;

  @Column({ name: 'author_id', type: 'uuid' })
  @Index()
  authorId: string;

  @ApiProperty({ enum: ['draft', 'published', 'archived'] })
  @Column({ type: 'varchar', length: 20, default: 'draft' })
  @Index()
  status: SkillStatus;

  /**
   * L1 metadata: Complete YAML Front Matter parsed as JSON.
   * Stored as JSONB for efficient querying.
   */
  @Column({ name: 'metadata_json', type: 'jsonb', default: {} })
  metadataJson: Record<string, unknown>;

  /**
   * L2 content: Full SKILL.md text.
   * Only loaded when the user's intent matches this skill.
   */
  @Column({ name: 'skill_md', type: 'text', nullable: true })
  skillMd?: string;

  @ApiProperty({ description: 'SemVer version string' })
  @Column({ type: 'varchar', length: 20, default: '1.0.0' })
  version: string;

  @ApiProperty()
  @Column({ name: 'download_count', type: 'integer', default: 0 })
  downloadCount: number;

  @ApiProperty()
  @Column({ name: 'rating_avg', type: 'float', default: 0 })
  ratingAvg: number;

  @ApiProperty()
  @Column({ name: 'rating_count', type: 'integer', default: 0 })
  ratingCount: number;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
