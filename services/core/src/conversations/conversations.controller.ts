import {
  Controller, Get, Post, Body, Param, Res, Delete, Patch, UseGuards, Request,
  HttpStatus, HttpCode, Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConversationsService } from './conversations.service';
import { IsString, IsNotEmpty, MaxLength, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class CreateConversationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  agentId: string;
}

class SendMessageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content: string;
}

class RenameConversationDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  @MaxLength(200)
  title: string;
}

@ApiTags('conversations')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'conversations', version: '1' })
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @ApiOperation({ summary: 'Create a new conversation with an Agent' })
  @Post()
  async create(@Body() dto: CreateConversationDto, @Request() req: any) {
    return this.conversationsService.createConversation(dto.agentId, req.user.id);
  }

  @ApiOperation({ summary: 'List my conversations' })
  @Get()
  async list(@Request() req: any) {
    return this.conversationsService.getConversations(req.user.id);
  }

  @ApiOperation({ summary: 'Get messages in a conversation (cursor-paginated)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Max messages to return (default 50, max 200)' })
  @ApiQuery({ name: 'before', required: false, type: String, description: 'Return messages older than this message ID (cursor)' })
  @Get(':id/messages')
  async getMessages(
    @Param('id') id: string,
    @Request() req: any,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10) || 50, 200) : 50;
    return this.conversationsService.getMessages(id, req.user.id, {
      limit: parsedLimit,
      before,
    });
  }

  @ApiOperation({ summary: 'Send a message and receive streamed response (SSE)',
    description: 'Returns a Server-Sent Events (SSE) stream. Connect with EventSource or ReadableStream.',
  })
  @Post(':id/messages')
  async sendMessage(
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Request() req: any,
    @Res() res: Response,
  ) {
    // Set SSE headers.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering.
    res.status(HttpStatus.OK);

    const generator = this.conversationsService.sendMessage(id, req.user.id, dto.content);

    for await (const event of generator) {
      const sseData = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
      res.write(sseData);
    }

    res.end();
  }

  @ApiOperation({ summary: 'Rename a conversation' })
  @Patch(':id')
  async rename(
    @Param('id') id: string,
    @Body() dto: RenameConversationDto,
    @Request() req: any,
  ) {
    return this.conversationsService.renameConversation(id, req.user.id, dto.title);
  }

  @ApiOperation({ summary: 'Delete a conversation and all its messages' })
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Request() req: any) {
    await this.conversationsService.deleteConversation(id, req.user.id);
  }
}
