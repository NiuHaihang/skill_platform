import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param,
  UseGuards, Request, Query, ParseIntPipe, DefaultValuePipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SkillsService } from './skills.service';
import { CreateSkillDto } from './dto/create-skill.dto';
import { UpdateSkillDto } from './dto/update-skill.dto';

@ApiTags('skills')
@Controller({ path: 'skills', version: '1' })
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @ApiOperation({ summary: 'Create a new Skill' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@Body() dto: CreateSkillDto, @Request() req: any) {
    return this.skillsService.create(dto, req.user.id);
  }

  @ApiOperation({ summary: 'List my Skills' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Get('my')
  async listMine(
    @Request() req: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.skillsService.findAll({ authorId: req.user.id, page, limit });
  }

  @ApiOperation({ summary: 'Get Skill L1 metadata (fast, lightweight)' })
  @Get(':slug/meta')
  async getMetadata(@Param('slug') slug: string) {
    return this.skillsService.findBySlugL1(slug);
  }

  @ApiOperation({ summary: 'Get full Skill by UUID id (for editing)' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Get(':id/detail')
  async getById(@Param('id') id: string) {
    return this.skillsService.findByIdOrThrow(id);
  }

  @ApiOperation({ summary: 'Get full Skill spec (requires auth)' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Get(':slug')
  async getFull(@Param('slug') slug: string) {
    return this.skillsService.findBySlugL2(slug);
  }

  @ApiOperation({ summary: 'Update a Skill' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSkillDto,
    @Request() req: any,
  ) {
    return this.skillsService.update(id, dto, req.user.id);
  }

  @ApiOperation({ summary: 'Publish a Skill to the marketplace' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @Patch(':id/publish')
  async publish(@Param('id') id: string, @Request() req: any) {
    return this.skillsService.publish(id, req.user.id);
  }

  @ApiOperation({ summary: 'Delete a Skill' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async delete(@Param('id') id: string, @Request() req: any) {
    await this.skillsService.delete(id, req.user.id, req.user.role);
  }
}
