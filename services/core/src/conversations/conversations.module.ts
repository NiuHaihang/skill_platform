import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './conversation.entity';
import { Message } from './message.entity';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { AgentsModule } from '../agents/agents.module';
import { SkillsModule } from '../skills/skills.module';
import { LlmGatewayModule } from '../llm-gateway/llm-gateway.module';
import { SandboxModule } from '../sandbox/sandbox.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, Message]),
    AgentsModule,
    SkillsModule,
    LlmGatewayModule,
    SandboxModule,
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
