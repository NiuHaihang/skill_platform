import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from './conversation.entity';
import { Message, MessageRole } from './message.entity';
import { AgentsService } from '../agents/agents.service';
import { SkillsService } from '../skills/skills.service';
import { LlmGatewayService, LlmMessage, LlmTool } from '../llm-gateway/llm-gateway.service';
import { SandboxService } from '../sandbox/sandbox.service';
import { Agent } from '../agents/agent.entity';

export type ConversationSSEEvent =
  | { event: 'message_start'; data: { messageId: string; role: 'user' | 'assistant' } }
  | { event: 'content_delta'; data: { delta: string } }
  | { event: 'tool_use'; data: { toolCallId: string; skillSlug: string; language: string } }
  | { event: 'tool_result'; data: { toolCallId: string; stdout: string; stderr: string; exitCode: number } }
  | { event: 'message_done'; data: { messageId: string; usage: { promptTokens: number; completionTokens: number } } }
  | { event: 'error'; data: { message: string } };

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    private readonly agentsService: AgentsService,
    private readonly skillsService: SkillsService,
    private readonly llmGateway: LlmGatewayService,
    private readonly sandboxService: SandboxService,
  ) {}

  // ─────────────────────────────────────────────
  // Conversation Management
  // ─────────────────────────────────────────────

  async createConversation(agentId: string, userId: string): Promise<Conversation> {
    await this.agentsService.findByIdOrThrow(agentId);

    const conv = this.conversationRepo.create({
      agentId,
      userId,
      title: 'New Conversation',
      messageCount: 0,
      totalTokens: 0,
    });
    return this.conversationRepo.save(conv);
  }

  async getConversations(userId: string): Promise<Conversation[]> {
    return this.conversationRepo.find({
      where: { userId },
      order: { lastMessageAt: 'DESC' },
    });
  }

  async getMessages(conversationId: string, userId: string): Promise<Message[]> {
    const conv = await this.getConversationOrThrow(conversationId, userId);
    return this.messageRepo.find({
      where: { conversationId: conv.id },
      order: { createdAt: 'ASC' },
    });
  }

  // ─────────────────────────────────────────────
  // Streaming Message Handler
  // ─────────────────────────────────────────────

  /**
   * Process a user message and stream the assistant response as SSE events.
   *
   * Architecture:
   * 1. Save user message to DB
   * 2. Build context (history + L1 skill list for routing)
   * 3. Stream LLM response
   * 4. If LLM calls a tool (Skill), load L2 spec and execute in sandbox
   * 5. Feed tool result back to LLM for final response
   * 6. Save all messages to DB
   */
  async *sendMessage(
    conversationId: string,
    userId: string,
    userContent: string,
  ): AsyncGenerator<ConversationSSEEvent> {
    const conv = await this.getConversationOrThrow(conversationId, userId);
    const agent = await this.agentsService.findByIdOrThrow(conv.agentId);

    // 1. Save user message.
    const userMessage = await this.saveMessage(conversationId, 'user', userContent);
    yield { event: 'message_start', data: { messageId: userMessage.id, role: 'user' } };

    try {
      // 2. Load message history and build LLM messages.
      const history = await this.messageRepo.find({
        where: { conversationId },
        order: { createdAt: 'ASC' },
        take: 50, // Limit context window.
      });

      // 3. Get L1 skill metadata for this agent's skills.
      const skillIds = agent.skills.map((s) => s.id);
      const skillsL1 = await this.skillsService.getL1MetadataForAgent(skillIds);

      // 4. Convert skills to LLM tool definitions.
      const tools = this.buildSkillTools(skillsL1);

      // 5. Build the full LLM message list.
      const llmMessages = this.buildLlmMessages(agent, history, userContent);

      // 6. Stream the LLM response.
      let fullContent = '';
      let pendingToolCalls: any[] = [];
      let totalUsage = { promptTokens: 0, completionTokens: 0 };
      const assistantMessageId = await this.generateMessageId();

      yield { event: 'message_start', data: { messageId: assistantMessageId, role: 'assistant' } };

      for await (const chunk of this.llmGateway.stream({
        model: agent.modelName,
        messages: llmMessages,
        tools: tools.length > 0 ? tools : undefined,
        toolChoice: tools.length > 0 ? 'auto' : undefined,
        temperature: agent.modelConfig.temperature,
        maxTokens: agent.modelConfig.maxTokens,
        stream: true,
      })) {
        if (chunk.delta) {
          fullContent += chunk.delta;
          yield { event: 'content_delta', data: { delta: chunk.delta } };
        }

        if (chunk.toolCallDelta) {
          // Accumulate tool call deltas.
          const existing = pendingToolCalls.find((tc) => tc.id === chunk.toolCallDelta!.id);
          if (existing) {
            existing.function.arguments = (existing.function.arguments || '') + (chunk.toolCallDelta.arguments || '');
          } else if (chunk.toolCallDelta.name) {
            pendingToolCalls.push({
              id: chunk.toolCallDelta.id || `tc_${Date.now()}`,
              type: 'function',
              function: { name: chunk.toolCallDelta.name, arguments: chunk.toolCallDelta.arguments || '' },
            });
          }
        }

        if (chunk.done) {
          totalUsage = chunk.usage ?? totalUsage;
        }
      }

      // 7. Handle tool calls (Skill execution).
      const toolResults = new Map<string, { stdout: string; stderr: string; exitCode: number }>();

      let savedToolMessageCount = 0;

      if (pendingToolCalls.length > 0) {
        for (const toolCall of pendingToolCalls) {
          const skillSlug = toolCall.function.name.replace(/_/g, '-');

          let args: { language?: string; files?: Record<string, string> };
          try {
            args = JSON.parse(toolCall.function.arguments || '{}');
          } catch {
            const failure = { stdout: '', stderr: 'Invalid tool arguments', exitCode: 1 };
            toolResults.set(toolCall.id, failure);
            yield {
              event: 'tool_result',
              data: { toolCallId: toolCall.id, ...failure },
            };
            continue;
          }

          yield {
            event: 'tool_use',
            data: {
              toolCallId: toolCall.id,
              skillSlug,
              language: args.language || 'python',
            },
          };

          // Load L2 spec and extract executable code.
          const skillFull = await this.skillsService.findBySlugL2(skillSlug);
          if (!skillFull?.skillMd) {
            const failure = { stdout: '', stderr: `Skill ${skillSlug} not found`, exitCode: 1 };
            toolResults.set(toolCall.id, failure);
            yield {
              event: 'tool_result',
              data: { toolCallId: toolCall.id, ...failure },
            };
            continue;
          }

          const code = this.extractCodeFromSkillMd(skillFull.skillMd, args.language || 'python');
          const tier = this.determineTier(skillFull);

          const execResult = await this.sandboxService.execute({
            language: (args.language || 'python') as 'python' | 'javascript',
            code,
            tier,
            files: args.files,
          });

          toolResults.set(toolCall.id, {
            stdout: execResult.stdout,
            stderr: execResult.stderr,
            exitCode: execResult.exitCode,
          });

          yield {
            event: 'tool_result',
            data: {
              toolCallId: toolCall.id,
              stdout: execResult.stdout,
              stderr: execResult.stderr,
              exitCode: execResult.exitCode,
            },
          };

          const toolContent = [execResult.stdout, execResult.stderr].filter(Boolean).join('\n');
          await this.saveMessage(conversationId, 'tool', toolContent, {
            toolCallId: toolCall.id,
          });
          savedToolMessageCount++;
        }

        // Get final response after tool results via streaming.
        for await (const chunk of this.llmGateway.stream({
          model: agent.modelName,
          messages: [
            ...llmMessages,
            { role: 'assistant', content: fullContent },
            ...pendingToolCalls.map((tc) => {
              const result = toolResults.get(tc.id);
              return {
                role: 'tool' as const,
                content: result
                  ? JSON.stringify({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode })
                  : 'Tool execution failed',
                toolCallId: tc.id,
              };
            }),
          ],
          temperature: agent.modelConfig.temperature,
          maxTokens: agent.modelConfig.maxTokens,
          stream: true,
        })) {
          if (chunk.delta) {
            yield { event: 'content_delta', data: { delta: chunk.delta } };
            fullContent += chunk.delta;
          }
          if (chunk.done && chunk.usage) {
            totalUsage.promptTokens += chunk.usage.promptTokens;
            totalUsage.completionTokens += chunk.usage.completionTokens;
          }
        }
      }

      // 8. Save assistant message.
      const assistantMsg = await this.saveMessage(
        conversationId,
        'assistant',
        fullContent,
        {
          toolCalls: pendingToolCalls.length > 0 ? pendingToolCalls : undefined,
          promptTokens: totalUsage.promptTokens,
          completionTokens: totalUsage.completionTokens,
          modelUsed: agent.modelName,
        },
      );

      // 9. Update conversation stats.
      await this.conversationRepo.update(conversationId, {
        messageCount: () => `message_count + ${2 + savedToolMessageCount}`,
        totalTokens: () => `total_tokens + ${totalUsage.promptTokens + totalUsage.completionTokens}`,
        lastMessageAt: new Date(),
      });

      yield {
        event: 'message_done',
        data: {
          messageId: assistantMsg.id,
          usage: totalUsage,
        },
      };
    } catch (error: any) {
      this.logger.error('Error processing message', { error: error.message, conversationId });
      yield { event: 'error', data: { message: error.message || 'An error occurred' } };
    }
  }

  // ─────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────

  private buildLlmMessages(agent: Agent, history: Message[], newUserContent: string): LlmMessage[] {
    const messages: LlmMessage[] = [];

    // System prompt.
    const systemPrompt = agent.systemPrompt || 'You are a helpful AI assistant with access to specialized Skills.';
    messages.push({ role: 'system', content: systemPrompt });

    // Historical messages (exclude the latest user message we're about to add).
    for (const msg of history.slice(0, -1)) {
      messages.push({ role: msg.role, content: msg.content });
    }

    // Current user message.
    messages.push({ role: 'user', content: newUserContent });

    return messages;
  }

  private buildSkillTools(skillsL1: any[]): LlmTool[] {
    return skillsL1.map((skill) => ({
      type: 'function',
      function: {
        name: skill.slug.replace(/-/g, '_'),
        description: skill.description,
        parameters: {
          type: 'object',
          properties: {
            language: {
              type: 'string',
              enum: ['python', 'javascript'],
              description: 'The programming language to use',
            },
            files: {
              type: 'object',
              description: 'Optional input files as filename->base64 map',
            },
          },
        },
      },
    }));
  }

  private extractCodeFromSkillMd(skillMd: string, language: string): string {
    // Extract code from the first matching code block.
    const langPattern = language === 'python' ? /```python\n([\s\S]*?)```/
                                               : /```(?:javascript|js)\n([\s\S]*?)```/;
    const match = skillMd.match(langPattern);
    return match ? match[1] : '';
  }

  private determineTier(skill: any): 1 | 2 | 3 {
    const capabilities = skill.metadataJson?.capabilities as any;
    if (capabilities?.requiresNetwork) return 3;
    if (capabilities?.requiresFileAccess) return 2;
    return 1;
  }

  private async saveMessage(
    conversationId: string,
    role: MessageRole,
    content: string,
    extras?: {
      toolCalls?: any[];
      toolCallId?: string;
      promptTokens?: number;
      completionTokens?: number;
      modelUsed?: string;
    },
  ): Promise<Message> {
    const msg = this.messageRepo.create({
      conversationId,
      role,
      content,
      toolCalls: extras?.toolCalls,
      promptTokens: extras?.promptTokens,
      completionTokens: extras?.completionTokens,
      modelUsed: extras?.modelUsed,
    });
    return this.messageRepo.save(msg);
  }

  private async getConversationOrThrow(id: string, userId: string): Promise<Conversation> {
    const conv = await this.conversationRepo.findOne({ where: { id } });
    if (!conv) throw new NotFoundException(`Conversation not found: ${id}`);
    if (conv.userId !== userId) throw new ForbiddenException('Not your conversation');
    return conv;
  }

  private async generateMessageId(): Promise<string> {
    const { v4: uuidv4 } = await import('uuid');
    return uuidv4();
  }
}
