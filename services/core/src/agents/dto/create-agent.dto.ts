import { IsString, IsNotEmpty, IsOptional, MaxLength, IsBoolean, IsObject } from 'class-validator';
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

  @ApiProperty({ example: 'openai' })
  @IsString()
  @IsNotEmpty()
  modelProvider: string;

  @ApiProperty({ example: 'gpt-4o' })
  @IsString()
  @IsNotEmpty()
  modelName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  modelConfig?: { temperature?: number; maxTokens?: number; topP?: number };

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
