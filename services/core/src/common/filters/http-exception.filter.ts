import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * GlobalHttpExceptionFilter
 *
 * Catches all unhandled exceptions and normalises the error response shape to:
 *   { statusCode, message, error, path, timestamp }
 *
 * Without this filter, NestJS exposes raw exception details that can leak
 * internal stack traces and vary in format across different exception types.
 */
@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalHttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    // SSE endpoints write directly to res and call res.end() — skip filter.
    if (response.headersSent) return;

    let status: number;
    let message: string | string[];
    let error: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        error = exception.name;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const res = exceptionResponse as Record<string, unknown>;
        message = (res.message as string | string[]) ?? exception.message;
        error = (res.error as string) ?? exception.name;
      } else {
        message = exception.message;
        error = exception.name;
      }
    } else {
      // Unhandled non-HTTP exception — treat as 500.
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      error = 'InternalServerError';

      // Log the full error for server-side debugging.
      this.logger.error(
        { err: exception instanceof Error ? exception.message : String(exception) },
        'Unhandled exception',
      );
    }

    response.status(status).json({
      statusCode: status,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
