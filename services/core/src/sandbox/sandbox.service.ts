import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface SandboxExecutionRequest {
  executionId?: string;
  language: 'python' | 'javascript';
  code: string;
  tier?: 1 | 2 | 3;
  files?: Record<string, string>;  // filename -> base64 content
  env?: Record<string, string>;
  /** JSON data piped to the process's stdin. Skills receive arguments here. */
  stdin?: string;
  /** CLI arguments appended after the code file (e.g., the query string). */
  args?: string[];
}

export interface SandboxExecutionResult {
  executionId: string;
  status: 'completed' | 'failed' | 'timeout' | 'oom';
  exitCode: number;
  stdout: string;
  stderr: string;
  outputFiles?: Record<string, string>;
  resourceUsage?: {
    cpuTimeMs: number;
    memoryPeakBytes: number;
    durationMs: number;
  };
  error?: {
    code: string;
    message: string;
  };
}

@Injectable()
export class SandboxService {
  private readonly logger = new Logger(SandboxService.name);
  private readonly client: AxiosInstance;

  constructor(private readonly config: ConfigService) {
    const apiUrl = config.get<string>('app.sandbox.apiUrl', 'http://localhost:8194');
    const apiKey = config.get<string>('app.sandbox.apiKey', '');
    const timeoutMs = config.get<number>('app.sandbox.timeoutMs', 120000);

    this.client = axios.create({
      baseURL: apiUrl,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: timeoutMs + 5000, // Give a bit of extra headroom beyond sandbox timeout.
    });
  }

  /**
   * Execute code in the sandbox service.
   * This is the primary method called from SkillExecutorService.
   */
  async execute(req: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    this.logger.debug(`Executing ${req.language} code, tier=${req.tier ?? 2}`);

    try {
      const { data } = await this.client.post<SandboxExecutionResult>(
        '/v1/sandbox/run',
        {
          execution_id: req.executionId,
          language: req.language,
          code: req.code,
          tier: req.tier ?? 2,
          files: req.files ?? {},
          env: req.env ?? {},
          stdin: req.stdin,
          args: req.args,
        },
      );

      this.logger.debug(
        `Execution complete: id=${data.executionId}, status=${data.status}, exit=${data.exitCode}`,
      );

      return data;
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ECONNABORTED') {
        throw new ServiceUnavailableException(
          'Sandbox service is not available. Please try again later.',
        );
      }

      if (error.response?.status === 503) {
        throw new ServiceUnavailableException('Sandbox pool is exhausted. Please try again later.');
      }

      this.logger.error('Sandbox execution error', {
        status: error.response?.status,
        message: error.message,
      });

      throw error;
    }
  }

  /**
   * Check if the sandbox service is healthy.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const { data } = await this.client.get('/v1/sandbox/health', {
        timeout: 5000,
      });
      return data.status === 'healthy';
    } catch {
      return false;
    }
  }
}
