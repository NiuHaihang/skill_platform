import { Module } from '@nestjs/common';
import { SkillGeneratorNestController } from './skill-generator-nest.controller';
import { SkillGeneratorNestService } from './skill-generator-nest.service';
import { LlmGatewayModule } from '../llm-gateway/llm-gateway.module';
import { SkillsModule } from '../skills/skills.module';

@Module({
  imports: [LlmGatewayModule, SkillsModule],
  controllers: [SkillGeneratorNestController],
  providers: [SkillGeneratorNestService],
  exports: [SkillGeneratorNestService],
})
export class SkillGeneratorModule {}
