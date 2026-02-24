import { JwtService } from '@nestjs/jwt';
import { Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { ChatService } from './chat.service';
import { TranslationService } from '../translation/translation.service';
import { PersonalContextService } from '../personal-context/personal-context.service';
import {
  AuthenticatedSocket,
  WsJwtGuard,
  WsUserPayload,
} from './guards/ws-jwt.guard';
import { Message, MessageContentType } from './entities/message.entity';

interface JoinRoomPayload {
  groupId: string;
}

interface RawJoinRoomPayload {
  groupId?: unknown;
  group_id?: unknown;
}

interface SendMessagePayload {
  groupId: string;
  contentType: MessageContentType;
  rawContent: string;
}

interface RawSendMessagePayload {
  groupId?: unknown;
  group_id?: unknown;
  contentType?: unknown;
  content_type?: unknown;
  rawContent?: unknown;
  raw_content?: unknown;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger: Logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
    private readonly personalContextService: PersonalContextService,
    private readonly translationService: TranslationService,
  ) {}

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    const token: string | null = this.extractToken(client);

    if (!token) {
      this.logger.warn(`Socket disconnected (missing token): ${client.id}`);
      client.disconnect();
      return;
    }

    try {
      const payload: WsUserPayload =
        await this.jwtService.verifyAsync<WsUserPayload>(token);
      client.user = payload;
      this.logger.log(
        `Socket connected: ${client.id}, userId=${payload.sub}, email=${payload.email}`,
      );

      client.onAny((eventName: string, ...args: unknown[]) => {
        this.logger.log(
          `Socket ${client.id} incoming event: ${eventName} payload=${JSON.stringify(args)}`,
        );
      });
    } catch {
      this.logger.warn(`Socket disconnected (invalid token): ${client.id}`);
      client.disconnect();
    }
  }

  handleDisconnect(): void {
    this.logger.log('Socket disconnected');
  }

  @SubscribeMessage('joinRoom')
  async joinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RawJoinRoomPayload,
  ): Promise<{ joinedGroupId: string }> {
    const normalizedPayload: JoinRoomPayload =
      this.normalizeJoinRoomPayload(payload);

    await client.join(normalizedPayload.groupId);
    this.logger.log(
      `Socket ${client.id} joined room ${normalizedPayload.groupId}`,
    );

    client.emit('roomJoined', {
      joinedGroupId: normalizedPayload.groupId,
      socketId: client.id,
    });

    this.logger.log(
      `roomJoined ack emitted to socket ${client.id} for room ${normalizedPayload.groupId}`,
    );

    return { joinedGroupId: normalizedPayload.groupId };
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('sendMessage')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RawSendMessagePayload,
  ): Promise<Message> {
    const authenticatedClient: AuthenticatedSocket = client;
    const userId: string | undefined = authenticatedClient.user?.sub;

    if (!userId) {
      throw new WsException('Unauthorized');
    }

    const normalizedPayload: SendMessagePayload =
      this.normalizeSendMessagePayload(payload);

    this.logger.log(
      `sendMessage received: userId=${userId}, groupId=${normalizedPayload.groupId}, contentType=${normalizedPayload.contentType}`,
    );

    const message: Message = await this.chatService.saveMessage(
      userId,
      normalizedPayload.groupId,
      normalizedPayload.contentType,
      normalizedPayload.rawContent,
    );

    const userDictionary =
      await this.personalContextService.getUserDictionary(userId);

    await this.translationService.translateIntent({
      rawText: normalizedPayload.rawContent,
      nativeDialect: 'si',
      targetLanguages: ['en'],
      chatHistory: [],
      userDictionary,
    });

    this.logger.log(
      `Message persisted: messageId=${message.id}, groupId=${normalizedPayload.groupId}`,
    );

    this.server.to(normalizedPayload.groupId).emit('newMessage', message);

    this.logger.log(
      `newMessage broadcasted to room ${normalizedPayload.groupId}`,
    );

    return message;
  }

  private normalizeSendMessagePayload(
    payload: RawSendMessagePayload,
  ): SendMessagePayload {
    const groupIdValue: unknown = payload.groupId ?? payload.group_id;
    const contentTypeValue: unknown =
      payload.contentType ?? payload.content_type;
    const rawContentValue: unknown = payload.rawContent ?? payload.raw_content;

    if (typeof groupIdValue !== 'string' || groupIdValue.trim().length === 0) {
      throw new WsException(
        'Invalid payload: groupId (or group_id) is required',
      );
    }

    if (
      typeof contentTypeValue !== 'string' ||
      !Object.values(MessageContentType).includes(
        contentTypeValue as MessageContentType,
      )
    ) {
      throw new WsException(
        'Invalid payload: contentType must be TEXT, AUDIO, or DOCUMENT',
      );
    }

    if (
      typeof rawContentValue !== 'string' ||
      rawContentValue.trim().length === 0
    ) {
      throw new WsException(
        'Invalid payload: rawContent (or raw_content) is required',
      );
    }

    return {
      groupId: groupIdValue,
      contentType: contentTypeValue as MessageContentType,
      rawContent: rawContentValue,
    };
  }

  private normalizeJoinRoomPayload(
    payload: RawJoinRoomPayload,
  ): JoinRoomPayload {
    const groupIdValue: unknown = payload.groupId ?? payload.group_id;

    if (typeof groupIdValue !== 'string' || groupIdValue.trim().length === 0) {
      throw new WsException(
        'Invalid payload: groupId (or group_id) is required',
      );
    }

    return { groupId: groupIdValue };
  }

  private extractToken(client: Socket): string | null {
    const authToken: unknown = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim().length > 0) {
      return this.normalizeToken(authToken);
    }

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
