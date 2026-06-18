import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Agent } from './agent.entity';
import { Skill } from '../skills/skill.entity';
import { CreateAgentDto } from './dto/create-agent.dto';

@Injectable()
export class AgentsService {
  constructor(
    @InjectRepository(Agent)
    private readonly agentRepo: Repository<Agent>,
    @InjectRepository(Skill)
    private readonly skillRepo: Repository<Skill>,
  ) {}

  async create(dto: CreateAgentDto, ownerId: string): Promise<Agent> {
    const { skillIds, ...rest } = dto;

    // Auto-infer modelProvider from modelName if not provided.
    const modelProvider = rest.modelProvider || this.inferProvider(rest.modelName);

    const agent = this.agentRepo.create({
      ...rest,
      modelProvider,
      ownerId,
      skills: [],
      modelConfig: rest.modelConfig || {},
    });
    const saved = await this.agentRepo.save(agent);

    // Attach requested skills.
    if (skillIds?.length) {
      const skills = await this.skillRepo.find({ where: { id: In(skillIds) } });
      saved.skills = skills;
      await this.agentRepo.save(saved);
    }

    return saved;
  }

  /** Infer provider name from model name prefix. */
  private inferProvider(modelName: string): string {
    if (modelName.startsWith('gpt-') || /^o[134]/.test(modelName)) return 'openai';
    if (modelName.startsWith('claude-')) return 'anthropic';
    if (modelName.startsWith('deepseek-')) return 'deepseek';
    if (modelName.startsWith('llama') || modelName.startsWith('mixtral') || modelName.startsWith('gemma')) return 'groq';
    if (modelName.startsWith('ollama/') || modelName.includes(':')) return 'ollama';
    return 'openai';
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
