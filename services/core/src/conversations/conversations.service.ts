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
      relations: ['agent'],
    });
  }

  async renameConversation(id: string, userId: string, title: string): Promise<Conversation> {
    const conv = await this.getConversationOrThrow(id, userId);
    conv.title = title.trim() || conv.title;
    return this.conversationRepo.save(conv);
  }

  async deleteConversation(id: string, userId: string): Promise<void> {
    const conv = await this.getConversationOrThrow(id, userId);
    // Cascade-delete messages first (entity might not have cascade set).
    await this.messageRepo.delete({ conversationId: conv.id });
    await this.conversationRepo.remove(conv);
  }

  async getMessages(
    conversationId: string,
    userId: string,
    options: { limit?: number; before?: string } = {},
  ): Promise<{ data: Message[]; hasMore: boolean }> {
    const conv = await this.getConversationOrThrow(conversationId, userId);
    const limit = Math.min(options.limit ?? 50, 200); // cap at 200

    const qb = this.messageRepo
      .createQueryBuilder('msg')
      .where('msg.conversation_id = :id', { id: conv.id })
      .orderBy('msg.created_at', 'DESC')
      .take(limit + 1); // fetch one extra to know if there are more

    // Cursor-based pagination: load messages older than the given message ID.
    if (options.before) {
      const cursor = await this.messageRepo.findOne({ where: { id: options.before } });
      if (cursor) {
        qb.andWhere('msg.created_at < :cursor', { cursor: cursor.createdAt });
      }
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const data = rows.slice(0, limit).reverse(); // return in chronological order

    return { data, hasMore };
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

    // Auto-update title from the first user message.
    if (conv.messageCount === 0) {
      const autoTitle = userContent.slice(0, 60).trim() + (userContent.length > 60 ? '…' : '');
      await this.conversationRepo.update(conversationId, { title: autoTitle });
    }

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
      const llmMessages = this.buildLlmMessages(agent, history, userContent, skillsL1);

      // 6. Stream the LLM response.
      let fullContent = '';
      // Use an index-keyed map so we correctly accumulate fragments for each
      // parallel tool call (index 0, 1, 2 …) without id-based collisions.
      const toolCallByIndex = new Map<number, { id: string; name: string; arguments: string }>();
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
          const cleanDelta = this.cleanLlmContent(chunk.delta);
          if (cleanDelta) {
            fullContent += cleanDelta;
            yield { event: 'content_delta', data: { delta: cleanDelta } };
          }
        }

        if (chunk.toolCallDelta) {
          const { index = 0, id, name, arguments: args } = chunk.toolCallDelta;
          if (!toolCallByIndex.has(index)) {
            toolCallByIndex.set(index, { id: '', name: '', arguments: '' });
          }
          const entry = toolCallByIndex.get(index)!;
          if (id)   entry.id        = id;
          if (name) entry.name      = name;
          if (args) entry.arguments += args;
        }

        if (chunk.done) {
          totalUsage = chunk.usage ?? totalUsage;
        }
      }

      // Convert index-map to ordered array.
      const pendingToolCalls = Array.from(toolCallByIndex.entries())
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => ({
          id: tc.id || `tc_${Date.now()}`,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));

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
          if (!skillFull?.skillMd?.trim()) {
            const failure = { stdout: '', stderr: `Skill '${skillSlug}' has no implementation code (skillMd is empty). Please add code to the skill.`, exitCode: 1 };
            toolResults.set(toolCall.id, failure);
            yield {
              event: 'tool_result',
              data: { toolCallId: toolCall.id, ...failure },
            };
            continue;
          }

          const rawCode = this.extractCodeFromSkillMd(skillFull.skillMd, args.language || 'python');

          // If no executable code block, generate a minimal wrapper that outputs
          // the query so the LLM can use its own knowledge to fulfill the request.
          // This gracefully handles CLI-based skills that don't have inline Python code.
          let code = rawCode;
          if (!code.trim()) {
            const query = (args as any).query || (args as any).input || '';
            if (!query.trim()) {
              const failure = {
                stdout: '',
                stderr: `Skill '${skillSlug}' requires a 'query' argument but none was provided.`,
                exitCode: 1,
              };
              toolResults.set(toolCall.id, failure);
              yield { event: 'tool_result', data: { toolCallId: toolCall.id, ...failure } };
              continue;
            }
            // Generate a wrapper that prints the query context; the LLM will
            // synthesize an answer from its own knowledge using this structure.
            code = `import json, sys\nquery = ${JSON.stringify(query)}\nprint(json.dumps({"query": query, "status": "no_code", "message": "Skill '${skillSlug}' has no executable code. Using LLM knowledge to answer: " + query}))\n`;
          } else {
            // ── Inject tool-call arguments into the skill code ──
            // Skills expect input via sys.argv[1] or stdin JSON, but the
            // sandbox executes code without arguments. We prepend a preamble
            // that sets sys.argv and patches sys.stdin so the skill code can
            // read the query through its normal input channels.
            const toolArgs = { ...args } as Record<string, unknown>;
            // Remove 'language' as it's a meta param, not a skill input.
            delete toolArgs.language;
            delete toolArgs.files;
            const query = (toolArgs.query || toolArgs.input || '') as string;
            const argsJson = JSON.stringify(toolArgs);

            const lang = args.language || 'python';
            if (lang === 'python') {
              const preamble = [
                `import sys as _sys, io as _io`,
                `_sys.argv = ['skill.py', ${JSON.stringify(query)}]`,
                `_sys.stdin = _io.StringIO(${JSON.stringify(argsJson)})`,
                ``,
              ].join('\n');
              code = preamble + code;
            } else {
              // JavaScript: inject via global variables
              const preamble = [
                `globalThis.__SKILL_ARGS = ${JSON.stringify(argsJson)};`,
                `globalThis.__SKILL_QUERY = ${JSON.stringify(query)};`,
                `process.argv = ['node', 'skill.js', ${JSON.stringify(query)}];`,
                ``,
              ].join('\n');
              code = preamble + code;
            }
          }

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
        // Build the correct assistant message: include tool_calls when present.
        const assistantTurnMessage: any = {
          role: 'assistant',
          // content may be null when LLM only makes tool calls (no text)
          content: fullContent || null,
        };
        if (pendingToolCalls.length > 0) {
          assistantTurnMessage.tool_calls = pendingToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          }));
        }

        for await (const chunk of this.llmGateway.stream({
          model: agent.modelName,
          messages: [
            ...llmMessages,
            assistantTurnMessage,
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
            const cleanDelta = this.cleanLlmContent(chunk.delta);
            if (cleanDelta) {
              yield { event: 'content_delta', data: { delta: cleanDelta } };
              fullContent += cleanDelta;
            }
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
      // Always print raw error — nestjs-pino field merging only works with object-first format.
      console.error('[sendMessage] ERROR:', error?.message, '\nStack:', error?.stack?.slice(0, 600));

      // Safely extract response data — in streaming mode error.response?.data is a
      // Node.js IncomingMessage (not plain JSON), so JSON.stringify causes a circular
      // reference crash. Only stringify if it's a plain object/string.
      let responseDataStr: string | undefined;
      try {
        const rd = error.response?.data;
        if (rd && typeof rd === 'object' && !rd.readable) {
          responseDataStr = JSON.stringify(rd)?.slice(0, 500);
        } else if (typeof rd === 'string') {
          responseDataStr = rd.slice(0, 500);
        }
      } catch {
        responseDataStr = '[unserializable]';
      }

      // nestjs-pino requires object as first arg for field merging.
      this.logger.error(
        { err: error.message, httpStatus: error.response?.status, responseData: responseDataStr, conversationId },
        'Error processing message',
      );
      yield { event: 'error', data: { message: this.toUserFriendlyError(error) } };
    }
  }

  /** Translate raw/technical errors into user-friendly messages. */
  private toUserFriendlyError(error: any): string {
    const msg: string = error?.message ?? '';
    const status: number = error?.response?.status ?? error?.status ?? 0;

    // ── Sandbox-specific errors ──────────────────────────────────
    // ServiceUnavailableException thrown by SandboxService
    if (error?.name === 'ServiceUnavailableException' || status === 503) {
      return '🐳 代码沙箱服务暂时不可用，请稍后重试。';
    }
    // Sandbox auth error (wrong SANDBOX_API_KEY config)
    if (msg.includes('Sandbox') || msg.includes('sandbox')) {
      if (status === 401) {
        return '🔑 沙箱服务鉴权失败，请检查服务器的 SANDBOX_API_KEY 配置是否一致。';
      }
      return '❌ 代码沙箱执行失败，请检查 Skill 代码是否正确。';
    }

    // ── LLM provider errors ──────────────────────────────────────
    // LLM API key / auth errors
    if (status === 401 || msg.includes('401') || msg.toLowerCase().includes('invalid api key') || msg.toLowerCase().includes('unauthorized')) {
      return '❌ AI 模型 API Key 无效或未配置。请在 .env.local 中填入正确的 API Key，然后重启服务。';
    }

    // Rate limit
    if (status === 429 || msg.includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('too many requests')) {
      return '⚠️ AI 模型请求频率超限（Rate Limit），请稍等几秒后重试。';
    }

    // Quota / billing
    if (status === 402 || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('billing') || msg.toLowerCase().includes('insufficient_quota')) {
      return '💳 API 额度已用完，请检查你的账户余额或升级套餐。';
    }

    // Model not found
    if (status === 404 || (msg.toLowerCase().includes('model') && msg.toLowerCase().includes('not found'))) {
      return '🤖 指定的 AI 模型不存在，请在 Agent 设置中检查模型名称是否正确。';
    }

    // Context length
    if ((msg.toLowerCase().includes('context') && msg.toLowerCase().includes('length')) || msg.toLowerCase().includes('maximum context')) {
      return '📄 消息超出模型最大上下文长度，请缩短对话历史或减少消息长度。';
    }

    // Network / timeout
    if (msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('econnaborted') || msg.toLowerCase().includes('network')) {
      return '🌐 网络请求超时，请检查网络连接后重试。';
    }

    // Ollama not running
    if (msg.toLowerCase().includes('econnrefused') && msg.includes('11434')) {
      return '🦙 Ollama 服务未启动，请运行 `ollama serve` 后重试。';
    }

    // Bad request (invalid message format, unsupported parameters)
    if (status === 400) {
      return '⚠️ AI 模型请求格式错误（可能是对话历史中存在损坏的消息）。请尝试新建一个对话重试。';
    }

    // Generic fallback
    return '😕 对话处理失败，请稍后重试。如果问题持续存在，请检查服务器日志。';
  }

  // ─────────────────────────────────────────────

  // Private helpers
  // ─────────────────────────────────────────────

  private buildLlmMessages(agent: Agent, history: Message[], newUserContent: string, skillsL1: any[] = []): LlmMessage[] {
    const messages: LlmMessage[] = [];

    // Build system prompt: start with agent's custom prompt, then append skill guidance.
    let systemPrompt = agent.systemPrompt || 'You are a helpful AI assistant.';

    if (skillsL1.length > 0) {
      const skillList = skillsL1.map((s) =>
        `- **${s.name}** (slug: \`${s.slug}\`): ${s.description}`,
      ).join('\n');

      systemPrompt += `

## Available Skills
You have access to the following Skills that can be executed in a sandboxed environment. **When the user's request matches a skill's purpose, you MUST call it using the function calling mechanism instead of answering from memory.**

${skillList}

## How to Use Skills
- Call the skill's function with a \`query\` parameter containing the user's search term or instructions.
- Wait for the tool result, then synthesize it into your final answer.
- If a skill is available that can answer the user's question with real-time or specialized data, ALWAYS prefer calling the skill over using your training data.
- Do NOT make up search results — always call the skill to get real data.`;
    }

    messages.push({ role: 'system', content: systemPrompt });

    // Historical messages (exclude the latest user message we're about to add).
    // We must correctly reconstruct tool/assistant messages to satisfy the LLM API contract:
    //   - assistant messages with tool_calls must include tool_calls field (not just content)
    //   - tool messages must include tool_call_id
    //   - content must be stripped of any internal markup (DSML etc.)
    for (const msg of history.slice(0, -1)) {
      if (msg.role === 'user') {
        messages.push({ role: 'user', content: this.cleanLlmContent(msg.content) ?? '' });

      } else if (msg.role === 'assistant') {
        const assistantMsg: LlmMessage = {
          role: 'assistant',
          // Strip any leaked DSML or think tags from saved assistant content.
          content: this.cleanLlmContent(msg.content) || null,
        };
        // Re-attach toolCalls if this assistant turn made function calls.
        if (msg.toolCalls && Array.isArray(msg.toolCalls) && msg.toolCalls.length > 0) {
          assistantMsg.tool_calls = msg.toolCalls as any;
        }
        messages.push(assistantMsg);

      } else if (msg.role === 'tool') {
        // Reconstruct tool result message — tool_call_id is mandatory.
        // We store it in tool_results jsonb or derive it from tool_calls on the matched assistant msg.
        const toolCallId: string | undefined =
          (msg.toolResults as any)?.toolCallId ??
          (msg.toolResults as any)?.[0]?.toolCallId;

        if (!toolCallId) {
          // Defensively skip orphaned tool messages without an ID — sending them
          // would cause a 400 from DeepSeek (tool message must reference a tool_call).
          this.logger.warn({ msgId: msg.id }, 'Skipping orphaned tool message without tool_call_id');
          continue;
        }

        messages.push({
          role: 'tool',
          content: this.cleanLlmContent(msg.content) ?? '',
          toolCallId,
        });
      }
    }

    // ── Repair: ensure every assistant tool_call has a matching tool response ──
    // DeepSeek (and OpenAI) require that every tool_call ID in an assistant
    // message has a corresponding tool-role message. When orphaned tool messages
    // were skipped above, the assistant's tool_calls array may reference IDs
    // that no longer appear in the message list. We fix this by injecting
    // synthetic placeholder tool responses for any missing IDs.
    const presentToolIds = new Set(
      messages.filter((m) => m.role === 'tool' && m.toolCallId).map((m) => m.toolCallId!),
    );

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (m.role !== 'assistant' || !m.tool_calls?.length) continue;

      const missingCalls = m.tool_calls.filter((tc) => !presentToolIds.has(tc.id));
      if (missingCalls.length === 0) continue;

      if (missingCalls.length === m.tool_calls.length) {
        // ALL tool calls are orphaned — strip tool_calls entirely so the LLM
        // doesn't see a broken conversation turn.
        this.logger.warn(
          { assistantMsgIndex: i, orphanedIds: missingCalls.map((tc) => tc.id) },
          'Stripping all orphaned tool_calls from assistant message (no matching tool responses)',
        );
        delete m.tool_calls;
      } else {
        // Partial orphans — inject placeholder tool responses right after this
        // assistant message so the LLM sees a complete tool-call / tool-response pair.
        const placeholders: LlmMessage[] = missingCalls.map((tc) => ({
          role: 'tool' as const,
          content: JSON.stringify({ error: 'Tool result unavailable (previous execution lost)' }),
          toolCallId: tc.id,
        }));
        // Insert right after the assistant message.
        const insertIdx = i + 1;
        messages.splice(insertIdx, 0, ...placeholders);
        // Also register them so later passes don't double-fix.
        for (const ph of placeholders) presentToolIds.add(ph.toolCallId!);
        this.logger.warn(
          { assistantMsgIndex: i, injectedIds: missingCalls.map((tc) => tc.id) },
          'Injected placeholder tool responses for orphaned tool_calls',
        );
      }
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
            // Primary input: natural-language query or instruction for the skill.
            query: {
              type: 'string',
              description: 'The search query, question, or instruction to pass to the skill.',
            },
            // Alternate parameter name for non-search skills.
            input: {
              type: 'string',
              description: 'Additional input or parameters for the skill (JSON string or plain text).',
            },
            language: {
              type: 'string',
              enum: ['python', 'javascript'],
              description: 'Programming language for code execution (default: python)',
            },
          },
          required: ['query'],
        },
      },
    }));
  }

  /**
   * Strip internal LLM markup from model output before sending to the client.
   * Currently handles:
   *  - DeepSeek DSML function-call markers (<｜｜DSML｜｜...> blocks)
   *  - Any stray <｜｜...｜｜> tokens
   */
  private cleanLlmContent(text: string): string {
    if (!text) return text;
    // Remove full DSML tool_calls blocks (they span multiple chunks when buffered,
    // but we sanitize greedily per-chunk and let incomplete tags pass harmlessly).
    return text
      // Full self-contained DSML blocks
      .replace(/<｜｜DSML｜｜tool_calls>[\s\S]*?<\/｜｜DSML｜｜tool_calls>/g, '')
      // Any remaining standalone DSML open/close tags
      .replace(/<｜｜DSML｜｜[^>]*>/g, '')
      .replace(/<\/｜｜DSML｜｜[^>]*>/g, '')
      // DeepSeek thinking separators that sometimes leak
      .replace(/<｜think｜>/g, '').replace(/<｜\/think｜>/g, '')
      // Generic ｜｜...｜｜ markers
      .replace(/<｜｜[^｜]*｜｜>/g, '');
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
      // Store toolCallId in toolResults so buildLlmMessages() can reconstruct
      // multi-turn tool histories without the "orphaned tool message" warning.
      toolResults: extras?.toolCallId ? [{ toolCallId: extras.toolCallId }] : undefined,
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
