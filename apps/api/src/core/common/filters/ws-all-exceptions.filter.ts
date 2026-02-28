import { ArgumentsHost, Catch, Logger } from '@nestjs/common';
import { BaseWsExceptionFilter, WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

@Catch()
export class WsAllExceptionsFilter extends BaseWsExceptionFilter {
  private readonly logger = new Logger('WsExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const client = host.switchToWs().getClient<Socket>();

    let errorMessage: string;
    let errorStatus: string;

    if (exception instanceof WsException) {
      const wsError = exception.getError();
      errorMessage =
        typeof wsError === 'string'
          ? wsError
          : (wsError as Record<string, unknown>)?.message?.toString() ??
            'WebSocket error';
      errorStatus = 'BAD_REQUEST';

      this.logger.warn(
        `WS error [${client.id}]: ${errorMessage}`,
      );
    } else if (exception instanceof Error) {
      errorMessage = 'Internal server error';
      errorStatus = 'INTERNAL_ERROR';

      this.logger.error(
        `WS unhandled error [${client.id}]: ${exception.message}`,
        exception.stack,
      );
    } else {
      errorMessage = 'Internal server error';
      errorStatus = 'INTERNAL_ERROR';

      this.logger.error(
        `WS unknown error [${client.id}]: ${String(exception)}`,
      );
    }

    client.emit('error', {
      status: errorStatus,
      message: errorMessage,
      timestamp: new Date().toISOString(),
    });
  }
}
