import { IsString, IsNotEmpty, IsOptional, MaxLength, IsBoolean, IsObject, IsArray, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAgentDto {
  @ApiProperty({ example: 'My Data Analyst' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Custom system prompt' })
  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @ApiProperty({ example: 'gpt-4o' })
  @IsString()
  @IsNotEmpty()
  modelName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  modelConfig?: { temperature?: number; maxTokens?: number; topP?: number };

  @ApiPropertyOptional({ example: 'openai', description: 'Inferred from modelName if omitted' })
  @IsOptional()
  @IsString()
  modelProvider?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional({ description: 'Skill IDs to attach on creation', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  skillIds?: string[];
}
