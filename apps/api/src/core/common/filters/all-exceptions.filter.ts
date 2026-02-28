import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    // Only handle HTTP context — WS has its own filter
    if (host.getType() !== 'http') {
      return;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string | string[];
    let error: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const res = exceptionResponse as Record<string, unknown>;
        message = (res.message as string | string[]) || exception.message;
        error = (res.error as string) || exception.name;
      } else {
        message = exception.message;
        error = exception.name;
      }

      // Log client errors at warn level, not error
      if (status >= 400 && status < 500) {
        this.logger.warn(
          `${request.method} ${request.url} ${status} - ${JSON.stringify(message)}`,
        );
      } else {
        this.logger.error(
          `${request.method} ${request.url} ${status} - ${JSON.stringify(message)}`,
          exception instanceof Error ? exception.stack : undefined,
        );
      }
    } else {
      // Unexpected errors — these are genuine 500s
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      error = 'Internal Server Error';

      this.logger.error(
        `${request.method} ${request.url} ${status} - Unexpected error`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
