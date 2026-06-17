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
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../users/user.entity';
import { Skill } from '../skills/skill.entity';

@Entity('agents')
export class Agent {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty()
  @Column({ type: 'varchar', length: 200 })
  name: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'text', nullable: true })
  description?: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'owner_id' })
  owner: User;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @ApiProperty({ nullable: true })
  @Column({ name: 'system_prompt', type: 'text', nullable: true })
  systemPrompt?: string;

  @ApiProperty({ description: 'LLM provider name' })
  @Column({ name: 'model_provider', type: 'varchar', length: 50 })
  modelProvider: string;

  @ApiProperty({ description: 'Specific model name' })
  @Column({ name: 'model_name', type: 'varchar', length: 100 })
  modelName: string;

  @ApiProperty({ description: 'Model configuration (temperature, max_tokens, etc.)' })
  @Column({ name: 'model_config', type: 'jsonb', default: {} })
  modelConfig: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  };

  @ApiProperty()
  @Column({ name: 'is_public', type: 'boolean', default: false })
  isPublic: boolean;

  /** The skills installed on this agent (many-to-many). */
  @ManyToMany(() => Skill, { eager: false })
  @JoinTable({
    name: 'agent_skills',
    joinColumn: { name: 'agent_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'skill_id', referencedColumnName: 'id' },
  })
  skills: Skill[];

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
