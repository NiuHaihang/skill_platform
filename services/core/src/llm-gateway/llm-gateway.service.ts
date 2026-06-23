import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  toolCallId?: string;
  name?: string;
  // Present on assistant messages that made tool calls.
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface LlmTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmRequest {
  model: string;
  messages: LlmMessage[];
  tools?: LlmTool[];
  toolChoice?: 'auto' | 'none' | 'required';
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface LlmResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason: string;
}

export type LlmStreamChunk = {
  delta: string;
  // Present when the LLM is streaming a tool call fragment.
  // index identifies which parallel tool call this belongs to.
  toolCallDelta?: { index?: number; id?: string; name?: string; arguments?: string };
  done: boolean;
  usage?: LlmResponse['usage'];
};

/** All supported provider identifiers. */
type Provider = 'openai' | 'anthropic' | 'groq' | 'deepseek' | 'ollama';

@Injectable()
export class LlmGatewayService {
  private readonly logger = new Logger(LlmGatewayService.name);

  private readonly openaiClient: AxiosInstance;
  private readonly anthropicClient: AxiosInstance;
  private readonly groqClient: AxiosInstance;
  private readonly deepseekClient: AxiosInstance;
  private readonly ollamaClient: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    const openaiKey = config.get<string>('app.llm.openaiApiKey');
    const anthropicKey = config.get<string>('app.llm.anthropicApiKey');
    const groqKey = config.get<string>('app.llm.groqApiKey');
    const deepseekKey = config.get<string>('app.llm.deepseekApiKey');
    const deepseekBaseUrl = config.get<string>('app.llm.deepseekBaseUrl') ?? 'https://api.deepseek.com/v1';
    const ollamaBaseUrl = config.get<string>('app.llm.ollamaBaseUrl') ?? 'http://localhost:11434/v1';

    this.openaiClient = axios.create({
      baseURL: 'https://api.openai.com/v1',
      headers: { Authorization: `Bearer ${openaiKey}` },
      timeout: 120_000,
    });

    this.anthropicClient = axios.create({
      baseURL: 'https://api.anthropic.com/v1',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      timeout: 120_000,
    });

    this.groqClient = axios.create({
      baseURL: 'https://api.groq.com/openai/v1',
      headers: { Authorization: `Bearer ${groqKey}` },
      timeout: 60_000,
    });

    // DeepSeek uses the OpenAI-compatible API format.
    this.deepseekClient = axios.create({
      baseURL: deepseekBaseUrl,
      headers: { Authorization: `Bearer ${deepseekKey}` },
      timeout: 120_000,
    });

    // Ollama exposes an OpenAI-compatible endpoint at /v1 (≥ v0.1.24).
    // No API key required for local usage; an empty bearer is harmless.
    this.ollamaClient = axios.create({
      baseURL: ollamaBaseUrl,
      headers: { Authorization: 'Bearer ollama' },
      timeout: 300_000, // local inference can be slow
    });
  }

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────

  /**
   * Route a non-streaming LLM request based on the model name.
   */
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const provider = this.detectProvider(req.model);
    this.logger.debug(`LLM complete: model=${req.model} provider=${provider} msgs=${req.messages.length}`);

    switch (provider) {
      case 'openai':
      case 'groq':
      case 'deepseek':
      case 'ollama':
        return this.openaiCompatibleComplete(req, provider);
      case 'anthropic':
        return this.anthropicComplete(req);
      default:
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }

  /**
   * Route a streaming LLM request.
   * Returns an async generator yielding chunks.
   */
  async *stream(req: LlmRequest): AsyncGenerator<LlmStreamChunk> {
    const provider = this.detectProvider(req.model);
    this.logger.debug(`LLM stream: model=${req.model} provider=${provider}`);

    switch (provider) {
      case 'openai':
      case 'groq':
      case 'deepseek':
      case 'ollama':
        yield* this.openaiCompatibleStream(req, provider);
        break;
      case 'anthropic':
        yield* this.anthropicStream(req);
        break;
      default:
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }

  // ─────────────────────────────────────────────
  // OpenAI-compatible (OpenAI / Groq / DeepSeek / Ollama)
  // ─────────────────────────────────────────────

  private resolveClient(provider: Provider): AxiosInstance {
    switch (provider) {
      case 'groq':     return this.groqClient;
      case 'deepseek': return this.deepseekClient;
      case 'ollama':   return this.ollamaClient;
      default:         return this.openaiClient;
    }
  }

  private async openaiCompatibleComplete(req: LlmRequest, provider: Provider): Promise<LlmResponse> {
    const client = this.resolveClient(provider);

    const body: Record<string, unknown> = {
      model: req.model,
      messages: this.serializeMessages(req.messages),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
    };

    if (req.tools?.length) {
      body.tools = req.tools;
      body.tool_choice = req.toolChoice ?? 'auto';
    }

    const { data } = await client.post('/chat/completions', body);
    const choice = data.choices[0];
    const message = choice.message;

    return {
      content: message.content || '',
      toolCalls: message.tool_calls || undefined,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      model: data.model,
      finishReason: choice.finish_reason,
    };
  }

  private async *openaiCompatibleStream(req: LlmRequest, provider: Provider): AsyncGenerator<LlmStreamChunk> {
    const client = this.resolveClient(provider);

    const body: Record<string, unknown> = {
      model: req.model,
      messages: this.serializeMessages(req.messages),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
      // Request usage in streaming mode (supported by DeepSeek & OpenAI).
      // Without this, usage is always 0 in streaming responses.
      stream_options: { include_usage: true },
    };

    if (req.tools?.length) {
      body.tools = req.tools;
      body.tool_choice = req.toolChoice ?? 'auto';
    }

    const response = await client.post('/chat/completions', body, {
      responseType: 'stream',
    });

    let buffer = '';
    // Accumulate tool call fragments indexed by their position (index field).
    // This supports parallel tool calls (multiple skills at once).
    const toolCallAcc: Record<number, { id: string; name: string; arguments: string }> = {};
    let pendingUsage: LlmResponse['usage'] | undefined;

    // Buffer for accumulating DSML content across multiple chunks.
    // DeepSeek sometimes streams DSML tool calls via delta.content instead of delta.tool_calls.
    let dsmlBuffer = '';
    let dsmlCapturing = false;

    for await (const chunk of response.data) {
      buffer += (chunk as Buffer).toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          // If we were capturing a DSML block that never completed, try to parse it.
          if (dsmlBuffer.trim()) {
            this.parseDsmlToolCalls(dsmlBuffer, toolCallAcc);
          }
          yield { delta: '', done: true, usage: pendingUsage };
          return;
        }

        try {
          const parsed = JSON.parse(data);

          // Capture usage from the final chunk that includes it (before [DONE]).
          if (parsed.usage) {
            pendingUsage = {
              promptTokens: parsed.usage.prompt_tokens ?? 0,
              completionTokens: parsed.usage.completion_tokens ?? 0,
              totalTokens: parsed.usage.total_tokens ?? 0,
            };
          }

          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          // Accumulate tool call fragments by index (supports parallel tool calls).
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx: number = tc.index ?? 0;
              if (!toolCallAcc[idx]) {
                toolCallAcc[idx] = { id: '', name: '', arguments: '' };
              }
              if (tc.id)                   toolCallAcc[idx].id        = tc.id;
              if (tc.function?.name)       toolCallAcc[idx].name      = tc.function.name;
              if (tc.function?.arguments)  toolCallAcc[idx].arguments += tc.function.arguments;

              yield {
                delta: '',
                toolCallDelta: {
                  index: idx,
                  id:        tc.id,
                  name:      tc.function?.name,
                  arguments: tc.function?.arguments,
                },
                done: false,
              };
            }
          }

          if (delta.content) {
            const content: string = delta.content;

            // Detect DeepSeek DSML tool_calls in content stream.
            // DeepSeek sometimes emits function calls as DSML text instead of delta.tool_calls.
            if (dsmlCapturing || content.includes('<｜｜DSML｜｜tool_calls>') || content.includes('<|DSML|>') || dsmlBuffer.length > 0) {
              dsmlBuffer += content;

              // Check if we've started capturing DSML.
              if (!dsmlCapturing && dsmlBuffer.includes('<｜｜DSML｜｜tool_calls>')) {
                dsmlCapturing = true;
                // Extract any text before the DSML block and yield it.
                const dsmlStart = dsmlBuffer.indexOf('<｜｜DSML｜｜tool_calls>');
                const textBefore = dsmlBuffer.slice(0, dsmlStart).trim();
                if (textBefore) {
                  yield { delta: textBefore, done: false };
                }
                dsmlBuffer = dsmlBuffer.slice(dsmlStart);
              }

              // Check if the DSML block is complete.
              if (dsmlCapturing && dsmlBuffer.includes('</｜｜DSML｜｜tool_calls>')) {
                // Extract the complete DSML block and parse it.
                const endTag = '</｜｜DSML｜｜tool_calls>';
                const endIdx = dsmlBuffer.indexOf(endTag) + endTag.length;
                const dsmlBlock = dsmlBuffer.slice(0, endIdx);
                const remainder = dsmlBuffer.slice(endIdx);

                // Parse the DSML block into standard tool call deltas.
                const parsedCalls = this.parseDsmlToolCalls(dsmlBlock, toolCallAcc);
                for (const tc of parsedCalls) {
                  yield {
                    delta: '',
                    toolCallDelta: { index: tc.index, id: tc.id, name: tc.name, arguments: tc.arguments },
                    done: false,
                  };
                }

                dsmlBuffer = '';
                dsmlCapturing = false;

                // Yield any text after the DSML block.
                if (remainder.trim()) {
                  yield { delta: remainder, done: false };
                }
              }
              // Still accumulating — don't yield anything yet.
            } else {
              // Normal text content — yield it directly.
              yield { delta: content, done: false };
            }
          }
        } catch {
          // Skip malformed SSE chunks.
        }
      }
    }
  }

  /**
   * Parse a DeepSeek DSML tool_calls block into standard tool call objects.
   * Format: <｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="fn"><｜｜DSML｜｜parameter name="p" string="true">val</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>
   *
   * Returns an array of parsed tool calls with index, id, name, arguments.
   */
  private parseDsmlToolCalls(
    dsml: string,
    acc: Record<number, { id: string; name: string; arguments: string }>,
  ): Array<{ index: number; id: string; name: string; arguments: string }> {
    const results: Array<{ index: number; id: string; name: string; arguments: string }> = [];

    // Match each <invoke> block.
    const invokeRegex = /<｜｜DSML｜｜invoke\s+name="([^"]+)">([\s\S]*?)<\/｜｜DSML｜｜invoke>/g;
    let match: RegExpExecArray | null;
    let idx = Object.keys(acc).length; // Continue index after existing tool calls.

    while ((match = invokeRegex.exec(dsml)) !== null) {
      const funcName = match[1];
      const body = match[2];

      // Parse parameters into a JSON object.
      const params: Record<string, unknown> = {};
      const paramRegex = /<｜｜DSML｜｜parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/｜｜DSML｜｜parameter>/g;
      let paramMatch: RegExpExecArray | null;

      while ((paramMatch = paramRegex.exec(body)) !== null) {
        params[paramMatch[1]] = paramMatch[2].trim();
      }

      const argsStr = JSON.stringify(params);
      const id = `dsml_tc_${Date.now()}_${idx}`;

      acc[idx] = { id, name: funcName, arguments: argsStr };
      results.push({ index: idx, id, name: funcName, arguments: argsStr });
      idx++;
    }

    return results;
  }


  // ─────────────────────────────────────────────
  // Anthropic
  // ─────────────────────────────────────────────

  private async anthropicComplete(req: LlmRequest): Promise<LlmResponse> {
    const messages = req.messages.filter((m) => m.role !== 'system');
    const systemMsg = req.messages.find((m) => m.role === 'system');

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.maxTokens ?? 4096,
    };

    if (systemMsg) body.system = systemMsg.content;
    if (req.tools?.length) body.tools = this.convertToolsToAnthropicFormat(req.tools);

    const { data } = await this.anthropicClient.post('/messages', body);
    const textBlock = data.content.find((b: any) => b.type === 'text');
    const toolBlock = data.content.find((b: any) => b.type === 'tool_use');

    return {
      content: textBlock?.text || '',
      toolCalls: toolBlock
        ? [{ id: toolBlock.id, type: 'function', function: { name: toolBlock.name, arguments: JSON.stringify(toolBlock.input) } }]
        : undefined,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
      model: data.model,
      finishReason: data.stop_reason,
    };
  }

  /**
   * True SSE streaming for Anthropic Messages API.
   * Parses event types: content_block_delta, message_delta (usage).
   */
  private async *anthropicStream(req: LlmRequest): AsyncGenerator<LlmStreamChunk> {
    const messages = req.messages.filter((m) => m.role !== 'system');
    const systemMsg = req.messages.find((m) => m.role === 'system');

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
    };

    if (systemMsg) body.system = systemMsg.content;
    if (req.tools?.length) body.tools = this.convertToolsToAnthropicFormat(req.tools);

    const response = await this.anthropicClient.post('/messages', body, {
      responseType: 'stream',
    });

    let buffer = '';
    let eventType = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of response.data) {
      buffer += (chunk as Buffer).toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
          continue;
        }

        if (!line.startsWith('data: ')) continue;
        const rawData = line.slice(6).trim();

        try {
          const parsed = JSON.parse(rawData);

          if (eventType === 'content_block_delta') {
            const delta = parsed.delta;
            if (delta?.type === 'text_delta') {
              yield { delta: delta.text || '', done: false };
            } else if (delta?.type === 'input_json_delta') {
              yield {
                delta: '',
                toolCallDelta: { arguments: delta.partial_json },
                done: false,
              };
            }
          } else if (eventType === 'content_block_start') {
            // Tool use block start — emit the tool name.
            if (parsed.content_block?.type === 'tool_use') {
              yield {
                delta: '',
                toolCallDelta: {
                  id: parsed.content_block.id,
                  name: parsed.content_block.name,
                },
                done: false,
              };
            }
          } else if (eventType === 'message_start') {
            inputTokens = parsed.message?.usage?.input_tokens ?? 0;
          } else if (eventType === 'message_delta') {
            outputTokens = parsed.usage?.output_tokens ?? 0;
          } else if (eventType === 'message_stop') {
            yield {
              delta: '',
              done: true,
              usage: {
                promptTokens: inputTokens,
                completionTokens: outputTokens,
                totalTokens: inputTokens + outputTokens,
              },
            };
            return;
          }
        } catch {
          // Skip malformed SSE chunks.
        }
      }
    }
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  /**
   * Determine the provider from the model name prefix.
   *
   * Model naming conventions:
   *  - OpenAI   : gpt-*, o1*, o3*, o4*
   *  - Anthropic: claude-*
   *  - Groq     : llama*, mixtral*, gemma*, whisper-*
   *  - DeepSeek : deepseek-*
   *  - Ollama   : ollama/* or any unrecognised model (local fallback)
   *               e.g. "ollama/llama3", "qwen2:7b", "mistral:latest"
   */
  detectProvider(model: string): Provider {
    if (model.startsWith('gpt-') || /^o[134]/.test(model)) return 'openai';
    if (model.startsWith('claude-')) return 'anthropic';
    if (model.startsWith('llama') || model.startsWith('mixtral') || model.startsWith('gemma') || model.startsWith('whisper-')) return 'groq';
    if (model.startsWith('deepseek-')) return 'deepseek';
    // Explicit ollama/ prefix OR any model with a colon tag (e.g. qwen2:7b)
    if (model.startsWith('ollama/') || model.includes(':')) return 'ollama';
    // Default fallback to OpenAI-compatible
    return 'openai';
  }

  /** Strip the "ollama/" namespace prefix if present before sending to the API. */
  private normalizeModelName(model: string, provider: Provider): string {
    if (provider === 'ollama' && model.startsWith('ollama/')) {
      return model.slice(7);
    }
    return model;
  }

  /**
   * Convert LlmMessage[] (our camelCase TS types) to the OpenAI wire format.
   * Key differences:
   *  - toolCallId  → tool_call_id  (for role='tool' messages)
   *  - tool_calls stays as-is (already snake_case from assistant turn)
   *  - content may be null when the assistant only makes tool calls
   */
  private serializeMessages(messages: LlmMessage[]): Record<string, unknown>[] {
    return messages.map((msg) => {
      const out: Record<string, unknown> = {
        role: msg.role,
        content: msg.content,
      };
      // tool role requires tool_call_id (snake_case)
      if (msg.role === 'tool' && msg.toolCallId) {
        out.tool_call_id = msg.toolCallId;
      }
      // assistant messages with tool calls
      if (msg.role === 'assistant' && msg.tool_calls) {
        out.tool_calls = msg.tool_calls;
      }
      return out;
    });
  }

  private convertToolsToAnthropicFormat(tools: LlmTool[]) {
    return tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }
}
