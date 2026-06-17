import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SkillGeneratorNestService } from './skill-generator-nest.service';

class GenerateSkillDto {
  @ApiProperty({ description: 'Natural language description of the Skill' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  preferredCategory?: string;

  @ApiPropertyOptional({ enum: ['python', 'javascript'] })
  @IsOptional()
  @IsString()
  preferredLanguage?: string;

  @ApiPropertyOptional({ enum: ['two-stage', 'single-shot'], default: 'two-stage' })
  @IsOptional()
  @IsString()
  mode?: 'two-stage' | 'single-shot';
}

@ApiTags('skill-generator')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'skills/generate', version: '1' })
export class SkillGeneratorNestController {
  constructor(private readonly generatorService: SkillGeneratorNestService) {}

  @ApiOperation({ summary: 'Generate a SKILL.md from natural language description' })
  @Post()
  async generate(@Body() dto: GenerateSkillDto, @Request() req: any) {
    return this.generatorService.generateSkill({
      description: dto.description,
      preferredCategory: dto.preferredCategory,
      preferredLanguage: dto.preferredLanguage,
      mode: dto.mode,
    });
  }

  @ApiOperation({ summary: 'Quick preview (single-shot generation, faster but lower quality)' })
  @Post('preview')
  async preview(@Body() dto: GenerateSkillDto) {
    return this.generatorService.generateSkill({
      description: dto.description,
      preferredCategory: dto.preferredCategory,
      preferredLanguage: dto.preferredLanguage,
      mode: 'single-shot',
    });
  }
}
