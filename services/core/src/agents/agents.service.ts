import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent } from './agent.entity';
import { Skill } from '../skills/skill.entity';
import { CreateAgentDto } from './dto/create-agent.dto';

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,
  ) {}

  async create(dto: CreateAgentDto, ownerId: string): Promise<Agent> {
    const agent = this.agentRepo.create({
      ...dto,
      ownerId,
      skills: [],
      modelConfig: dto.modelConfig || {},
    });
    return this.agentRepo.save(agent);
  }

  async findAllByOwner(ownerId: string): Promise<Agent[]> {
    return this.agentRepo.find({
      where: { ownerId },
      relations: ['skills'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string): Promise<Agent | null> {
    return this.agentRepo.findOne({
      where: { id },
      relations: ['skills'],
    });
  }

  async findByIdOrThrow(id: string): Promise<Agent> {
    const agent = await this.findById(id);
    if (!agent) throw new NotFoundException(`Agent not found: ${id}`);
    return agent;
  }

  async update(id: string, dto: Partial<CreateAgentDto>, userId: string): Promise<Agent> {
    const agent = await this.findByIdOrThrow(id);
    if (agent.ownerId !== userId) throw new ForbiddenException('Not your agent');
    Object.assign(agent, dto);
    return this.agentRepo.save(agent);
  }

  async delete(id: string, userId: string): Promise<void> {
    const agent = await this.findByIdOrThrow(id);
    if (agent.ownerId !== userId) throw new ForbiddenException('Not your agent');
    await this.agentRepo.remove(agent);
  }

  async addSkill(agentId: string, skill: Skill, userId: string): Promise<Agent> {
    const agent = await this.findByIdOrThrow(agentId);
    if (agent.ownerId !== userId) throw new ForbiddenException('Not your agent');

    const alreadyInstalled = agent.skills.some((s) => s.id === skill.id);
    if (!alreadyInstalled) {
      agent.skills.push(skill);
      await this.agentRepo.save(agent);
    }
    return agent;
  }

  async removeSkill(agentId: string, skillId: string, userId: string): Promise<Agent> {
    const agent = await this.findByIdOrThrow(agentId);
    if (agent.ownerId !== userId) throw new ForbiddenException('Not your agent');

    agent.skills = agent.skills.filter((s) => s.id !== skillId);
    return this.agentRepo.save(agent);
  }
}
