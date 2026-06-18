import {
  IsString, IsNotEmpty, IsOptional, IsArray, IsEnum, IsBoolean, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SkillCategory } from '../skill.entity';

export class CreateSkillDto {
  @ApiProperty({ example: 'CSV Analyzer' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({ example: 'Analyze CSV files and produce statistical summaries' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description: string;

  @ApiProperty({ enum: ['productivity','coding','writing','data-analysis','design','marketing','education','business','customer-service','translation','research','automation'] })
  @IsEnum(['productivity','coding','writing','data-analysis','design','marketing','education','business','customer-service','translation','research','automation'])
  category: SkillCategory;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Full SKILL.md content' })
  @IsOptional()
  @IsString()
  skillMd?: string;

  @ApiPropertyOptional({ description: 'Publish to marketplace immediately', default: false })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
