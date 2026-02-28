import * as path from 'path';

import { JwtService } from '@nestjs/jwt';
import { Logger, UseFilters, UseGuards } from '@nestjs/common';
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
import { ActionService } from '../actions/action.service';
import { PersonalContextService } from '../personal-context/personal-context.service';
import { GroupsService } from '../groups/groups.service';
import { NotificationService } from '../notification/notification.service';
import {
  AuthenticatedSocket,
  WsJwtGuard,
  WsUserPayload,
} from './guards/ws-jwt.guard';
import { Message, MessageContentType } from './entities/message.entity';
import { WsAllExceptionsFilter } from '../../core/common/filters/ws-all-exceptions.filter';
import {
  Translations,
  ExtractedAction,
} from '../translation/translation.service';

interface JoinRoomPayload {
  groupId: string;
}

interface RawJoinRoomPayload {
  groupId?: unknown;
  group_id?: unknown;
}

interface SendMessagePayload {
  groupId: string;
  nativeDialect: string;
  targetLanguages: string[];
  contentType: MessageContentType;
  rawContent?: string;
  audioBase64?: string;
  audioMimeType?: string;
  fileUrl?: string;
  fileMimeType?: string;
}

interface DeleteMessagesPayload {
  groupId: string;
  messageIds: string[];
}

interface EditMessagePayload {
  groupId: string;
  messageId: string;
  newContent: string;
}

interface RawSendMessagePayload {
  groupId?: unknown;
  group_id?: unknown;
  nativeDialect?: unknown;
  targetLanguages?: unknown;
  contentType?: unknown;
  content_type?: unknown;
  rawContent?: unknown;
  raw_content?: unknown;
  audioBase64?: unknown;
  audio_base64?: unknown;
  audioMimeType?: unknown;
  audio_mime_type?: unknown;
  fileUrl?: unknown;
  file_url?: unknown;
  fileMimeType?: unknown;
  file_mime_type?: unknown;
}

@UseFilters(new WsAllExceptionsFilter())
@WebSocketGateway({ cors: { origin: '*' } })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger: Logger = new Logger(ChatGateway.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly groupsService: GroupsService,
    private readonly jwtService: JwtService,
    private readonly personalContextService: PersonalContextService,
    private readonly translationService: TranslationService,
    private readonly actionService: ActionService,
    private readonly notificationService: NotificationService,
  ) {}

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    const token: string | null = this.extractToken(client);

    if (!token) {
      this.logger.warn(
        `Socket disconnected (missing token): ${client.id} — ` +
          `auth=${JSON.stringify(client.handshake.auth)}, ` +
          `query.token=${String(client.handshake.query?.token)}, ` +
          `authorization header=${String(client.handshake.headers?.authorization?.slice(0, 20))}...`,
      );
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

    // Validate that the authenticated user is actually a member of the group
    const authenticatedClient = client as AuthenticatedSocket;
    const userId = authenticatedClient.user?.sub;

    if (!userId) {
      throw new WsException('Unauthorized');
    }

    const isMember = await this.groupsService.isMember(
      normalizedPayload.groupId,
      userId,
    );

    if (!isMember) {
      this.logger.warn(
        `Socket ${client.id} (userId=${userId}) attempted to join non-member room ${normalizedPayload.groupId} — rejected`,
      );
      throw new WsException('Forbidden: you are not a member of this group');
    }

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

    const userDictionary: string =
      await this.personalContextService.getUserDictionary(userId);

    let fileUrl: string | undefined;
    let transcription: string | null = null;
    let translations: Translations | null = null;
    let confidenceScore = 0;
    let extractedActions: ExtractedAction[] | null = null;

    const isMedia: boolean =
      normalizedPayload.contentType === MessageContentType.IMAGE ||
      normalizedPayload.contentType === MessageContentType.DOCUMENT;

    if (normalizedPayload.contentType === MessageContentType.AUDIO) {
      // Audio messages are now processed via the dedicated REST endpoint
      // POST /audio/process — which handles save → silence check → transcription → persist → broadcast.
      // If the client still sends AUDIO over the socket (old client version), surface a clear error.
      client.emit('messageFailed', {
        reason:
          'Please update your app. Audio messages now use a dedicated endpoint.',
      });
      throw new WsException(
        'AUDIO not accepted on WebSocket — use POST /audio/process',
      );
    } else if (isMedia) {
      fileUrl = normalizedPayload.fileUrl;
      const fileName = normalizedPayload.fileUrl!.split('/').pop()!;
      const localFilePath = path.join(process.cwd(), 'uploads', fileName);

      const result = await this.translationService.translateIntent({
        localFilePath,
        fileMimeType: normalizedPayload.fileMimeType,
        rawText: normalizedPayload.rawContent,
        chatHistory: [],
        userDictionary,
      });

      transcription = result.transcription;
      translations = result.translations;
      confidenceScore = result.confidenceScore;
      extractedActions = result.extractedActions ?? null;
    } else {
      const result = await this.translationService.translateIntent({
        rawText: normalizedPayload.rawContent,
        chatHistory: [],
        userDictionary,
      });

      transcription = result.transcription;
      translations = result.translations;
      confidenceScore = result.confidenceScore;
      extractedActions = result.extractedActions ?? null;
    }

    // Process extracted actions through ActionService
    let processedActions: ExtractedAction[] | null = null;
    if (extractedActions && extractedActions.length > 0) {
      processedActions = this.actionService.processActions(
        'pending', // messageId not yet known
        userId,
        normalizedPayload.groupId,
        extractedActions,
      );
    }

    // AUDIO is handled by the dedicated REST endpoint (AudioController).
    // This handler only reaches TEXT and IMAGE/DOCUMENT, so rawContentToSave
    // is either the file URL (media) or the raw text.
    const rawContentToSave: string = isMedia
      ? normalizedPayload.fileUrl!
      : normalizedPayload.rawContent!;

    const message: Message = await this.chatService.saveMessage(
      userId,
      normalizedPayload.groupId,
      normalizedPayload.contentType,
      rawContentToSave,
      transcription,
      translations,
      confidenceScore,
      processedActions,
    );

    this.logger.log(
      `Message persisted: messageId=${message.id}, groupId=${normalizedPayload.groupId}`,
    );

    // For TEXT messages the user's raw input is the definitive original text.
    // Using the AI's `transcription` field here would cause multi-line messages
    // to lose all lines except the last one, because the model interprets each
    // newline-separated line as a separate turn and only "transcribes" the final
    // one.  For AUDIO / media the transcription IS the source of truth because
    // the original is opaque binary data.
    const originalText =
      normalizedPayload.contentType === MessageContentType.TEXT
        ? normalizedPayload.rawContent
        : (transcription ?? normalizedPayload.rawContent);

    this.server.to(normalizedPayload.groupId).emit('newMessage', {
      messageId: message.id,
      senderId: userId,
      contentType: normalizedPayload.contentType,
      fileUrl: fileUrl ?? normalizedPayload.fileUrl,
      transcription,
      originalText,
      translations,
      confidenceScore,
      extractedActions: processedActions,
    });

    this.logger.log(
      `newMessage broadcasted to room ${normalizedPayload.groupId}`,
    );

    // Fire push notifications to offline members (non-blocking)
    this.sendChatNotification(
      normalizedPayload.groupId,
      userId,
      translations,
      transcription ?? normalizedPayload.rawContent ?? '',
    ).catch((err) =>
      this.logger.error(`[sendChatNotification] ${String(err)}`),
    );

    return message;
  }

  /**
   * Broadcasts a `newMessage` event to every socket in the given room.
   * Called by AudioController after saving and transcribing audio via REST.
   */
  broadcastToGroup(
    groupId: string,
    payload: {
      messageId: string;
      senderId: string;
      contentType: MessageContentType;
      fileUrl?: string;
      transcription: string | null;
      originalText: string | null;
      translations: Translations | null;
      confidenceScore: number;
      extractedActions?: ExtractedAction[] | null;
    },
  ): void {
    this.server.to(groupId).emit('newMessage', payload);
    this.logger.log(
      `[broadcastToGroup] newMessage emitted to room ${groupId}, messageId=${payload.messageId}`,
    );

    // Fire push notifications to offline members (non-blocking)
    this.sendChatNotification(
      groupId,
      payload.senderId,
      payload.translations,
      payload.transcription ?? payload.originalText ?? '',
    ).catch((err) =>
      this.logger.error(`[sendChatNotification] ${String(err)}`),
    );
  }

  /**
   * Sends push notifications to group members who are offline (not connected
   * via Socket.IO in the room). Uses the member's preferred language or
   * native dialect to pick the right translation for the notification body.
   */
  private async sendChatNotification(
    groupId: string,
    senderId: string,
    translations: Translations | null,
    fallbackText: string,
  ): Promise<void> {
    try {
      // 1. Get all members of the group with their user data
      const members = await this.groupsService.findMembers(groupId);

      // 2. Get the group info for the notification title
      const group = members.length > 0
        ? await this.groupsService.findGroupsForUser(senderId).then(
            (groups) => groups.find((g) => g.id === groupId),
          )
        : undefined;

      // 3. Get sender info for notification title
      const sender = members.find((m) => m.userId === senderId);
      const senderName = sender?.user?.displayName ?? 'Someone';

      const isGroup = group?.isGroup ?? true;
      const groupName = group?.name ?? 'Chat';

      // 4. Determine which members are currently connected via Socket.IO
      const socketsInRoom = await this.server.in(groupId).fetchSockets();
      const onlineUserIds = new Set<string>();
      for (const s of socketsInRoom) {
        const authSocket = s as unknown as { user?: WsUserPayload };
        if (authSocket.user?.sub) {
          onlineUserIds.add(authSocket.user.sub);
        }
      }

      // 5. Filter to offline members (not sender, not online, has push token)
      const offlineMembers = members.filter(
        (m) =>
          m.userId !== senderId &&
          !onlineUserIds.has(m.userId) &&
          m.user &&
          (m.user as { expoPushToken?: string | null }).expoPushToken,
      );

      if (offlineMembers.length === 0) return;

      // 6. Group offline members by the notification body text they should receive
      //    (based on their preferred language / native dialect)
      const tokensByBody = new Map<string, string[]>();

      for (const member of offlineMembers) {
        const user = member.user as {
          nativeDialect?: string;
          expoPushToken?: string | null;
        };
        const token = user.expoPushToken!;
        const lang = member.preferredLanguage ?? user.nativeDialect ?? 'english';
        const body =
          (translations as Record<string, string> | null)?.[lang] ??
          fallbackText;

        const existing = tokensByBody.get(body);
        if (existing) {
          existing.push(token);
        } else {
          tokensByBody.set(body, [token]);
        }
      }

      // 7. Send notifications grouped by body text
      const title = isGroup ? `${senderName} in ${groupName}` : senderName;

      for (const [body, tokens] of tokensByBody) {
        await this.notificationService.sendPushNotifications(
          tokens,
          title,
          body,
          {
            groupId,
            groupName: isGroup ? groupName : senderName,
            senderId,
            type: 'chat_message',
          },
        );
      }

      this.logger.log(
        `[sendChatNotification] Sent push to ${offlineMembers.length} offline member(s) in group ${groupId}`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`[sendChatNotification] Failed: ${msg}`);
    }
  }

  // ── deleteMessages ────────────────────────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('deleteMessages')
  async handleDeleteMessages(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: DeleteMessagesPayload,
  ): Promise<void> {
    const authenticatedClient = client as AuthenticatedSocket;
    const userId: string | undefined = authenticatedClient.user?.sub;
    if (!userId) throw new WsException('Unauthorized');

    const { groupId, messageIds } = payload ?? {};

    if (
      typeof groupId !== 'string' ||
      groupId.trim().length === 0 ||
      !Array.isArray(messageIds) ||
      messageIds.length === 0
    ) {
      client.emit('deleteFailed', {
        reason:
          'Invalid payload: groupId and a non-empty messageIds[] are required',
      });
      return;
    }

    const isMember = await this.groupsService.isMember(groupId, userId);
    if (!isMember) {
      client.emit('deleteFailed', {
        reason: 'Forbidden: you are not a member of this group',
      });
      return;
    }

    try {
      await this.chatService.deleteMessages(messageIds, userId);
      this.server
        .to(groupId)
        .emit('messagesDeleted', { messageIds, deletedBy: userId });
      this.logger.log(
        `[deleteMessages] ${messageIds.length} message(s) deleted by userId=${userId} in groupId=${groupId}`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Delete failed';
      this.logger.warn(`[deleteMessages] failed: ${reason}`);
      client.emit('deleteFailed', { reason });
    }
  }

  // ── editMessage ───────────────────────────────────────────────────────────

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('editMessage')
  async handleEditMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: EditMessagePayload,
  ): Promise<void> {
    const authenticatedClient = client as AuthenticatedSocket;
    const userId: string | undefined = authenticatedClient.user?.sub;
    if (!userId) throw new WsException('Unauthorized');

    const { groupId, messageId, newContent } = payload ?? {};

    // Validate required fields
    if (
      typeof groupId !== 'string' ||
      groupId.trim().length === 0 ||
      typeof messageId !== 'string' ||
      messageId.trim().length === 0 ||
      typeof newContent !== 'string'
    ) {
      client.emit('editFailed', {
        messageId: messageId ?? null,
        reason:
          'Invalid payload: groupId, messageId, and newContent are required',
      });
      return;
    }

    const trimmed = newContent.trim();

    if (trimmed.length === 0) {
      client.emit('editFailed', {
        messageId,
        reason: 'Message cannot be empty',
      });
      return;
    }

    if (trimmed.length > 2000) {
      client.emit('editFailed', {
        messageId,
        reason: 'Message is too long (max 2000 characters)',
      });
      return;
    }

    // Check for no actual change before touching the DB
    const existing = await this.chatService.findMessageById(messageId);
    if (existing && existing.rawContent === trimmed) {
      client.emit('editFailed', { messageId, reason: 'No changes detected' });
      return;
    }

    const isMember = await this.groupsService.isMember(groupId, userId);
    if (!isMember) {
      client.emit('editFailed', {
        messageId,
        reason: 'Forbidden: you are not a member of this group',
      });
      return;
    }

    try {
      // 1. Persist the edit (validates ownership, type, time window)
      await this.chatService.editMessage(messageId, userId, trimmed);

      // 2. Re-translate the new content
      const userDictionary: string =
        await this.personalContextService.getUserDictionary(userId);

      const result = await this.translationService.translateIntent({
        rawText: trimmed,
        chatHistory: [],
        userDictionary,
      });

      // 3. Save new translations
      const finalMessage = await this.chatService.updateMessageTranslations(
        messageId,
        result.translations,
        result.confidenceScore,
      );

      // 4. Broadcast to all room members
      this.server.to(groupId).emit('messageEdited', {
        messageId,
        newContent: trimmed,
        translations: finalMessage.translations,
        confidenceScore: finalMessage.confidenceScore,
        isEdited: true,
      });

      this.logger.log(
        `[editMessage] messageId=${messageId} edited & re-translated by userId=${userId}`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Edit failed';
      this.logger.warn(`[editMessage] failed: ${reason}`);
      client.emit('editFailed', { messageId, reason });
    }
  }

  private normalizeSendMessagePayload(
    payload: RawSendMessagePayload,
  ): SendMessagePayload {
    const groupIdValue: unknown = payload.groupId ?? payload.group_id;
    const contentTypeValue: unknown =
      payload.contentType ?? payload.content_type;
    const rawContentValue: unknown = payload.rawContent ?? payload.raw_content;
    const audioBase64Value: unknown =
      payload.audioBase64 ?? payload.audio_base64;
    const audioMimeTypeValue: unknown =
      payload.audioMimeType ?? payload.audio_mime_type;
    const fileUrlValue: unknown = payload.fileUrl ?? payload.file_url;
    const fileMimeTypeValue: unknown =
      payload.fileMimeType ?? payload.file_mime_type;
    const nativeDialectValue: unknown = payload.nativeDialect ?? 'singlish';
    const targetLanguagesValue: unknown = payload.targetLanguages ?? [];

    if (typeof groupIdValue !== 'string' || groupIdValue.trim().length === 0) {
      throw new WsException(
        'Invalid payload: groupId (or group_id) must be a non-empty string (received: ' +
          String(groupIdValue) +
          ')',
      );
    }

    if (
      typeof contentTypeValue !== 'string' ||
      !Object.values(MessageContentType).includes(
        contentTypeValue as MessageContentType,
      )
    ) {
      throw new WsException(
        'Invalid payload: contentType must be TEXT, AUDIO, IMAGE, or DOCUMENT',
      );
    }

    const resolvedContentType = contentTypeValue as MessageContentType;
    const isAudio: boolean = resolvedContentType === MessageContentType.AUDIO;
    const isMedia: boolean =
      resolvedContentType === MessageContentType.IMAGE ||
      resolvedContentType === MessageContentType.DOCUMENT;

    if (
      isAudio &&
      (typeof audioBase64Value !== 'string' ||
        audioBase64Value.trim().length === 0)
    ) {
      throw new WsException(
        'Invalid payload: audioBase64 (or audio_base64) is required for AUDIO messages',
      );
    }

    if (
      isMedia &&
      (typeof fileUrlValue !== 'string' || fileUrlValue.trim().length === 0)
    ) {
      throw new WsException(
        'Invalid payload: fileUrl (or file_url) is required for IMAGE/DOCUMENT messages',
      );
    }

    if (
      !isAudio &&
      !isMedia &&
      (typeof rawContentValue !== 'string' ||
        rawContentValue.trim().length === 0)
    ) {
      throw new WsException(
        'Invalid payload: rawContent (or raw_content) is required for TEXT messages',
      );
    }

    if (
      audioMimeTypeValue !== undefined &&
      typeof audioMimeTypeValue !== 'string'
    ) {
      throw new WsException(
        'Invalid payload: audioMimeType (or audio_mime_type) must be a string when provided',
      );
    }

    return {
      groupId: groupIdValue,
      nativeDialect:
        typeof nativeDialectValue === 'string'
          ? nativeDialectValue
          : 'singlish',
      targetLanguages: Array.isArray(targetLanguagesValue)
        ? (targetLanguagesValue as string[])
        : [],
      contentType: resolvedContentType,
      rawContent:
        typeof rawContentValue === 'string' ? rawContentValue : undefined,
      audioBase64:
        typeof audioBase64Value === 'string' ? audioBase64Value : undefined,
      audioMimeType:
        typeof audioMimeTypeValue === 'string' ? audioMimeTypeValue : undefined,
      fileUrl: typeof fileUrlValue === 'string' ? fileUrlValue : undefined,
      fileMimeType:
        typeof fileMimeTypeValue === 'string' ? fileMimeTypeValue : undefined,
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
