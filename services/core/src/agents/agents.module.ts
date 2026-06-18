import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agent } from './agent.entity';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';
import { SkillsModule } from '../skills/skills.module';
import { Skill } from '../skills/skill.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Agent, Skill]), SkillsModule],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
