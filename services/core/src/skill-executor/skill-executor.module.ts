import { Module } from '@nestjs/common';
import { SkillExecutorService } from './skill-executor.service';
import { SkillsModule } from '../skills/skills.module';
import { SandboxModule } from '../sandbox/sandbox.module';

@Module({
  imports: [SkillsModule, SandboxModule],
  providers: [SkillExecutorService],
  exports: [SkillExecutorService],
})
export class SkillExecutorModule {}
