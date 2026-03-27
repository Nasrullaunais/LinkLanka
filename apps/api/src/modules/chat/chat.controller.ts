import * as fs from 'fs';
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

interface AuthRequest {
  user: { sub: string; email: string };
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
      return this.chatService.getCursorHistory(
        groupId,
        req!.user.sub,
        before,
        parseInt(limit, 10) || 30,
      );
    }

    return this.chatService.getPaginatedHistory(
      groupId,
      req!.user.sub,
      parseInt(page, 10) || 1,
      parseInt(limit, 10) || 50,
    );
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
    return this.chatService.getAllMessages(groupId, req!.user.sub);
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
        // rawContent is the saved audio file URL; derive the local path
        const fileName = message.rawContent.split('/').pop()!;
        const localFilePath = path.join(process.cwd(), 'uploads', fileName);
        const audioBase64 = await fs.promises.readFile(localFilePath, {
          encoding: 'base64',
        });

        // Keep retry MIME behavior aligned with AudioController.
        const ext = fileName.split('.').pop()?.toLowerCase() ?? 'm4a';
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
        // IMAGE / DOCUMENT: rawContent is the URL, derive local path
        const fileName = message.rawContent.split('/').pop()!;
        const localFilePath = path.join(process.cwd(), 'uploads', fileName);
        const ext = fileName.split('.').pop()?.toLowerCase() ?? 'jpg';
        const fileMimeType =
          ext === 'pdf'
            ? 'application/pdf'
            : ext === 'png'
              ? 'image/png'
              : ext === 'gif'
                ? 'image/gif'
                : 'image/jpeg';
        result = await this.translationService.translateIntent({
          localFilePath,
          fileMimeType,
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

    return {
      translations: result.translations,
      confidenceScore: result.confidenceScore,
      detectedLanguage: result.detectedLanguage,
      originalTone: result.originalTone,
      translatedAudioUrls,
    };
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
