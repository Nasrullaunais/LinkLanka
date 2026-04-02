import * as path from 'path';

import {
  Controller,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../core/identity/guards/jwt-auth.guard';
import { ChatService } from './chat.service';
import { Message, MessageContentType } from './entities/message.entity';
import { GroupsService } from '../groups/groups.service';
import { PersonalContextService } from '../personal-context/personal-context.service';
import {
  DetectedLanguage,
  TranslationService,
  Translations,
  TranslatedAudioUrls,
} from '../translation/translation.service';
import { S3StorageService } from '../../core/common/storage/s3-storage.service';

interface AuthRequest {
  user: { sub: string; email: string };
}

interface StoredMediaReference {
  fileUrl: string;
  fileName: string;
}

interface SignedReadUrlCreator {
  createSignedReadUrl(fileUrlOrKey: string): Promise<string>;
}

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly groupsService: GroupsService,
    private readonly personalContextService: PersonalContextService,
    private readonly translationService: TranslationService,
    private readonly s3StorageService: S3StorageService,
  ) {}

  @Get('groups/:groupId/messages')
  async getGroupMessages(
    @Param('groupId') groupId: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
    @Query('before') before?: string,
    @Request() req?: AuthRequest,
  ): Promise<Message[]> {
    const isMember = await this.groupsService.isMember(groupId, req!.user.sub);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    // If a cursor is provided, use cursor-based pagination (infinite scroll)
    if (before) {
      const messages = await this.chatService.getCursorHistory(
        groupId,
        req!.user.sub,
        before,
        parseInt(limit, 10) || 30,
      );

      return this.hydrateMessageMediaUrls(messages);
    }

    const messages = await this.chatService.getPaginatedHistory(
      groupId,
      req!.user.sub,
      parseInt(page, 10) || 1,
      parseInt(limit, 10) || 50,
    );

    return this.hydrateMessageMediaUrls(messages);
  }

  @Get('groups/:groupId/messages/all')
  async getAllGroupMessages(
    @Param('groupId') groupId: string,
    @Request() req?: AuthRequest,
  ): Promise<Message[]> {
    const isMember = await this.groupsService.isMember(groupId, req!.user.sub);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    const messages = await this.chatService.getAllMessages(
      groupId,
      req!.user.sub,
    );

    return this.hydrateMessageMediaUrls(messages);
  }

  @Post('messages/:messageId/retranslate')
  async retranslateMessage(
    @Param('messageId') messageId: string,
    @Request() req: AuthRequest,
  ): Promise<{
    translations: Translations;
    confidenceScore: number;
    detectedLanguage: DetectedLanguage | null;
    originalTone: string | null;
    translatedAudioUrls: TranslatedAudioUrls | null;
  }> {
    const userId = req.user.sub;

    const message = await this.chatService.findMessageById(messageId);
    if (!message) throw new NotFoundException('Message not found');

    const isMember = await this.groupsService.isMember(message.groupId, userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    const userDictionary =
      await this.personalContextService.getUserDictionary(userId);

    let result: {
      translations: Translations;
      confidenceScore: number;
      detectedLanguage: DetectedLanguage;
      originalTone: string;
    };

    let translatedAudioUrls: TranslatedAudioUrls | null = null;

    try {
      if (message.contentType === MessageContentType.TEXT) {
        result = await this.translationService.translateIntent({
          rawText: message.rawContent,
          chatHistory: [],
          userDictionary,
        });
      } else if (message.contentType === MessageContentType.AUDIO) {
        const mediaRef = this.resolveStoredMediaReference(message.rawContent);
        const mediaBuffer = await this.loadMediaBuffer(mediaRef);
        const audioBase64 = mediaBuffer.toString('base64');

        // Keep retry MIME behavior aligned with AudioController.
        const ext = mediaRef.fileName.split('.').pop()?.toLowerCase() ?? 'm4a';
        const audioMimeType =
          ext === 'm4a'
            ? 'audio/mp4'
            : ext === 'webm'
              ? 'audio/webm'
              : ext === 'ogg'
                ? 'audio/ogg'
                : `audio/${ext}`;

        result = await this.translationService.translateIntent({
          audioBase64,
          audioMimeType,
          chatHistory: [],
          userDictionary,
        });

        translatedAudioUrls =
          await this.translationService.generateTranslatedAudioFiles({
            translations: result.translations,
            detectedLanguage: result.detectedLanguage,
            originalTone: result.originalTone,
          });
      } else {
        const mediaRef = this.resolveStoredMediaReference(message.rawContent);
        const mediaBuffer = await this.loadMediaBuffer(mediaRef);
        const ext = mediaRef.fileName.split('.').pop()?.toLowerCase() ?? 'jpg';
        const fileMimeType =
          ext === 'pdf'
            ? 'application/pdf'
            : ext === 'png'
              ? 'image/png'
              : ext === 'gif'
                ? 'image/gif'
                : 'image/jpeg';
        result = await this.translationService.translateIntent({
          mediaBase64: mediaBuffer.toString('base64'),
          mediaMimeType: fileMimeType,
          rawText: message.transcription ?? undefined,
          chatHistory: [],
          userDictionary,
        });
      }
    } catch (error) {
      this.logger.error(
        `[retranslateMessage] Failed for messageId=${messageId}, type=${message.contentType}, rawContent=${message.rawContent}: ${String(error)}`,
      );
      throw error;
    }

    await this.chatService.updateMessageWithTranslation(messageId, {
      detectedLanguage: result.detectedLanguage,
      originalTone: result.originalTone,
      translatedAudioUrls,
      translations: result.translations,
      confidenceScore: result.confidenceScore,
    });

    const signedTranslatedAudioUrls =
      await this.signTranslatedAudioUrls(translatedAudioUrls);

    return {
      translations: result.translations,
      confidenceScore: result.confidenceScore,
      detectedLanguage: result.detectedLanguage,
      originalTone: result.originalTone,
      translatedAudioUrls: signedTranslatedAudioUrls,
    };
  }

  private async hydrateMessageMediaUrls(
    messages: Message[],
  ): Promise<Message[]> {
    return Promise.all(
      messages.map((message) => this.hydrateSingleMessageMediaUrls(message)),
    );
  }

  private async hydrateSingleMessageMediaUrls(
    message: Message,
  ): Promise<Message> {
    const isMediaMessage =
      message.contentType === MessageContentType.AUDIO ||
      message.contentType === MessageContentType.IMAGE ||
      message.contentType === MessageContentType.DOCUMENT;

    const rawContent = isMediaMessage
      ? await this.signRawMediaContent(message.rawContent)
      : message.rawContent;

    const translatedAudioUrls = await this.signTranslatedAudioUrls(
      message.translatedAudioUrls,
    );

    return {
      ...message,
      rawContent,
      translatedAudioUrls,
    };
  }

  private async signRawMediaContent(rawContent: string): Promise<string> {
    const trimmed = rawContent.trim();
    if (!trimmed) {
      return rawContent;
    }

    if (!trimmed.startsWith('{')) {
      return this.createSignedReadUrl(trimmed);
    }

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const rawUrl =
        typeof parsed.url === 'string' && parsed.url.trim().length > 0
          ? parsed.url.trim()
          : null;

      if (!rawUrl) {
        return rawContent;
      }

      const signedUrl = await this.createSignedReadUrl(rawUrl);

      return JSON.stringify({
        ...parsed,
        url: signedUrl,
      });
    } catch {
      return this.createSignedReadUrl(trimmed);
    }
  }

  private async createSignedReadUrl(fileUrlOrKey: string): Promise<string> {
    const signer = this.s3StorageService as unknown as SignedReadUrlCreator;
    return signer.createSignedReadUrl(fileUrlOrKey);
  }

  private async signTranslatedAudioUrls(
    urls: TranslatedAudioUrls | null | undefined,
  ): Promise<TranslatedAudioUrls | null> {
    if (!urls) {
      return null;
    }

    const signed: TranslatedAudioUrls = {};

    if (urls.english) {
      signed.english = await this.createSignedReadUrl(urls.english);
    }
    if (urls.singlish) {
      signed.singlish = await this.createSignedReadUrl(urls.singlish);
    }
    if (urls.tanglish) {
      signed.tanglish = await this.createSignedReadUrl(urls.tanglish);
    }

    return Object.keys(signed).length > 0 ? signed : null;
  }

  private resolveStoredMediaReference(
    rawContent: string,
  ): StoredMediaReference {
    const trimmed = rawContent.trim();
    let fileUrl = trimmed;

    try {
      const parsed = JSON.parse(trimmed) as { url?: unknown };
      if (typeof parsed.url === 'string' && parsed.url.trim()) {
        fileUrl = parsed.url.trim();
      }
    } catch {
      // Older messages store the URL directly as raw text.
    }

    let fileName = '';

    try {
      const parsedUrl = new URL(fileUrl);
      fileName = path.basename(parsedUrl.pathname);
    } catch {
      fileName = path.basename(fileUrl.split('?')[0].split('#')[0]);
    }

    const normalizedFileName = decodeURIComponent(fileName || '').trim();
    if (!normalizedFileName) {
      throw new NotFoundException('Stored media reference is invalid');
    }

    return {
      fileUrl,
      fileName: normalizedFileName,
    };
  }

  private async loadMediaBuffer(
    mediaRef: StoredMediaReference,
  ): Promise<Buffer> {
    try {
      return await this.s3StorageService.downloadBufferFromUrl(
        mediaRef.fileUrl,
      );
    } catch (error) {
      this.logger.warn(
        `[retranslateMessage] Media fetch failed for ${mediaRef.fileUrl}: ${String(error)}`,
      );

      throw new NotFoundException(
        'Original media file is no longer available for re-translation. Please resend the message.',
      );
    }
  }

  @Get('groups/:groupId/search')
  async searchMessages(
    @Param('groupId') groupId: string,
    @Query('q') query: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Request() req: AuthRequest,
  ) {
    const userId = req.user.sub;

    if (!query || !query.trim()) {
      return { results: [], total: 0 };
    }

    const isMember = await this.groupsService.isMember(groupId, userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    return this.chatService.searchMessages(
      groupId,
      userId,
      query.trim(),
      parseInt(page, 10) || 1,
      parseInt(limit, 10) || 20,
    );
  }
}
