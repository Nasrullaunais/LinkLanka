import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';

export interface WsUserPayload {
  sub: string;
  email: string;
}

export interface AuthenticatedSocket extends Socket {
  user?: WsUserPayload;
}

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client: AuthenticatedSocket = context
      .switchToWs()
      .getClient<AuthenticatedSocket>();

    const token: string | null = this.extractToken(client);

    if (!token) {
      throw new WsException(new UnauthorizedException('Missing token'));
    }

    try {
      const payload: WsUserPayload =
        await this.jwtService.verifyAsync<WsUserPayload>(token);
      client.user = payload;
      return true;
    } catch {
      throw new WsException(new UnauthorizedException('Invalid token'));
    }
  }

  private extractToken(client: Socket): string | null {
    // 1. Preferred: socket.io auth object — io(url, { auth: { token: '...' } })
    const authToken: unknown = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim().length > 0) {
      return this.normalizeToken(authToken);
    }

    // 2. Query param fallback — io(url, { query: { token: '...' } })
    const queryToken: unknown = client.handshake.query?.token;
    if (typeof queryToken === 'string' && queryToken.trim().length > 0) {
      return this.normalizeToken(queryToken);
    }

    // 3. HTTP Authorization header (works in Node.js / server-to-server, NOT in browsers)
    const authHeader: unknown = client.handshake.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.trim().length > 0) {
      return this.normalizeToken(authHeader);
    }

    return null;
  }

  private normalizeToken(value: string): string {
    const prefix: string = 'Bearer ';
    return value.startsWith(prefix) ? value.slice(prefix.length).trim() : value;
  }
}
