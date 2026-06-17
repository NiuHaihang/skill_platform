import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  name?: string;
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
  toolCallDelta?: { id?: string; name?: string; arguments?: string };
  done: boolean;
  usage?: LlmResponse['usage'];
};

@Injectable()
export class LlmGatewayService {
  private readonly logger = new Logger(LlmGatewayService.name);
  private readonly openaiClient: AxiosInstance;
  private readonly anthropicClient: AxiosInstance;
  private readonly groqClient: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    const openaiKey = config.get<string>('app.llm.openaiApiKey');
    const anthropicKey = config.get<string>('app.llm.anthropicApiKey');
    const groqKey = config.get<string>('app.llm.groqApiKey');

    this.openaiClient = axios.create({
      baseURL: 'https://api.openai.com/v1',
      headers: { Authorization: `Bearer ${openaiKey}` },
      timeout: 120000,
    });

    this.anthropicClient = axios.create({
      baseURL: 'https://api.anthropic.com/v1',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      timeout: 120000,
    });

    this.groqClient = axios.create({
      baseURL: 'https://api.groq.com/openai/v1',
      headers: { Authorization: `Bearer ${groqKey}` },
      timeout: 60000,
    });
  }

  /**
   * Route a non-streaming LLM request based on the model name.
   */
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const provider = this.detectProvider(req.model);

    this.logger.debug(`LLM request: model=${req.model}, provider=${provider}, messages=${req.messages.length}`);

    switch (provider) {
      case 'openai':
      case 'groq':
        return this.openaiComplete(req, provider);
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

    switch (provider) {
      case 'openai':
      case 'groq':
        yield* this.openaiStream(req, provider);
        break;
      case 'anthropic':
        yield* this.anthropicStream(req);
        break;
      default:
        throw new Error(`Unsupported LLM provider: ${provider}`);
    }
  }

  // ─────────────────────────────────────────────
  // OpenAI / Groq (same API format)
  // ─────────────────────────────────────────────

  private async openaiComplete(req: LlmRequest, provider: 'openai' | 'groq'): Promise<LlmResponse> {
    const client = provider === 'groq' ? this.groqClient : this.openaiClient;

    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
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
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      model: data.model,
      finishReason: choice.finish_reason,
    };
  }

  private async *openaiStream(req: LlmRequest, provider: 'openai' | 'groq'): AsyncGenerator<LlmStreamChunk> {
    const client = provider === 'groq' ? this.groqClient : this.openaiClient;

    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
    };

    if (req.tools?.length) {
      body.tools = req.tools;
      body.tool_choice = req.toolChoice ?? 'auto';
    }

    const response = await client.post('/chat/completions', body, {
      responseType: 'stream',
    });

    let buffer = '';
    for await (const chunk of response.data) {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          yield { delta: '', done: true };
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          yield {
            delta: delta.content || '',
            toolCallDelta: delta.tool_calls?.[0]
              ? {
                  id: delta.tool_calls[0].id,
                  name: delta.tool_calls[0].function?.name,
                  arguments: delta.tool_calls[0].function?.arguments,
                }
              : undefined,
            done: false,
          };
        } catch {
          // Skip malformed chunks.
        }
      }
    }
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

  private async *anthropicStream(req: LlmRequest): AsyncGenerator<LlmStreamChunk> {
    // Simplified streaming — full implementation follows SSE parsing.
    const result = await this.anthropicComplete(req);
    yield { delta: result.content, done: false };
    yield { delta: '', done: true, usage: result.usage };
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  private detectProvider(model: string): string {
    if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3')) return 'openai';
    if (model.startsWith('claude-')) return 'anthropic';
    if (model.startsWith('llama') || model.startsWith('mixtral') || model.startsWith('gemma')) return 'groq';
    if (model.startsWith('deepseek-')) return 'deepseek';
    return 'openai';
  }

  private convertToolsToAnthropicFormat(tools: LlmTool[]) {
    return tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
  }
}
