import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Skill } from './skill.entity';

@Entity('skill_versions')
export class SkillVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Skill, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'skill_id' })
  skill: Skill;

  @Column({ name: 'skill_id', type: 'uuid' })
  skillId: string;

  @Column({ type: 'varchar', length: 20 })
  version: string;

  @Column({ name: 'skill_md', type: 'text' })
  skillMd: string;

  @Column({ name: 'change_log', type: 'text', nullable: true })
  changeLog?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
