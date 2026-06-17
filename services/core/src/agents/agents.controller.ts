import {
  Controller, Get, Post, Put, Delete, Body, Param,
  UseGuards, Request, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AgentsService } from './agents.service';
import { SkillsService } from '../skills/skills.service';
import { CreateAgentDto } from './dto/create-agent.dto';

@ApiTags('agents')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller({ path: 'agents', version: '1' })
export class AgentsController {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly skillsService: SkillsService,
  ) {}

  @ApiOperation({ summary: 'Create a new Agent' })
  @Post()
  async create(@Body() dto: CreateAgentDto, @Request() req: any) {
    return this.agentsService.create(dto, req.user.id);
  }

  @ApiOperation({ summary: 'List my Agents' })
  @Get()
  async list(@Request() req: any) {
    return this.agentsService.findAllByOwner(req.user.id);
  }

  @ApiOperation({ summary: 'Get Agent by ID' })
  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.agentsService.findByIdOrThrow(id);
  }

  @ApiOperation({ summary: 'Update Agent' })
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<CreateAgentDto>,
    @Request() req: any,
  ) {
    return this.agentsService.update(id, dto, req.user.id);
  }

  @ApiOperation({ summary: 'Delete Agent' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async delete(@Param('id') id: string, @Request() req: any) {
    await this.agentsService.delete(id, req.user.id);
  }

  @ApiOperation({ summary: 'Install a Skill on an Agent' })
  @Post(':id/skills/:skillId')
  async addSkill(
    @Param('id') id: string,
    @Param('skillId') skillId: string,
    @Request() req: any,
  ) {
    const skill = await this.skillsService.findByIdOrThrow(skillId);
    return this.agentsService.addSkill(id, skill, req.user.id);
  }

  @ApiOperation({ summary: 'Uninstall a Skill from an Agent' })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id/skills/:skillId')
  async removeSkill(
    @Param('id') id: string,
    @Param('skillId') skillId: string,
    @Request() req: any,
  ) {
    await this.agentsService.removeSkill(id, skillId, req.user.id);
  }
}
