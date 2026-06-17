import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Conversation } from './conversation.entity';

export type MessageRole = 'user' | 'assistant' | 'tool';

@Entity('messages')
export class Message {
  @ApiProperty()
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Conversation, (conv) => conv.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column({ name: 'conversation_id', type: 'uuid' })
  @Index()
  conversationId: string;

  @ApiProperty({ enum: ['user', 'assistant', 'tool'] })
  @Column({ type: 'varchar', length: 20 })
  role: MessageRole;

  @ApiProperty()
  @Column({ type: 'text' })
  content: string;

  @ApiProperty({ nullable: true, description: 'LLM tool_call requests' })
  @Column({ name: 'tool_calls', type: 'jsonb', nullable: true })
  toolCalls?: Record<string, unknown>[];

  @ApiProperty({ nullable: true, description: 'Tool execution results' })
  @Column({ name: 'tool_results', type: 'jsonb', nullable: true })
  toolResults?: Record<string, unknown>[];

  @Column({ name: 'prompt_tokens', type: 'integer', nullable: true })
  promptTokens?: number;

  @Column({ name: 'completion_tokens', type: 'integer', nullable: true })
  completionTokens?: number;

  @Column({ name: 'model_used', type: 'varchar', length: 100, nullable: true })
  modelUsed?: string;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
