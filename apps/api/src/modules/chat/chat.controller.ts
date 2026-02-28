import * as fs from 'fs';
import * as path from 'path';

import {
  Controller,
  ForbiddenException,
  Get,
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
import { TranslationService, Translations } from '../translation/translation.service';

interface AuthRequest {
  user: { sub: string; email: string };
}

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly groupsService: GroupsService,
    private readonly personalContextService: PersonalContextService,
    private readonly translationService: TranslationService,
  ) {}

  @Get('groups/:groupId/messages')
  getGroupMessages(
    @Param('groupId') groupId: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ): Promise<Message[]> {
    return this.chatService.getPaginatedHistory(
      groupId,
      parseInt(page, 10) || 1,
      parseInt(limit, 10) || 50,
    );
  }

  @Post('messages/:messageId/retranslate')
  async retranslateMessage(
    @Param('messageId') messageId: string,
    @Request() req: AuthRequest,
  ): Promise<{ translations: Translations; confidenceScore: number }> {
    const userId = req.user.sub;

    const message = await this.chatService.findMessageById(messageId);
    if (!message) throw new NotFoundException('Message not found');

    const isMember = await this.groupsService.isMember(message.groupId, userId);
    if (!isMember) throw new ForbiddenException('You are not a member of this conversation');

    const userDictionary = await this.personalContextService.getUserDictionary(userId);

    let result;

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
      const audioBase64 = await fs.promises.readFile(localFilePath, { encoding: 'base64' });
      // Guess mime type from extension
      const ext = fileName.split('.').pop()?.toLowerCase() ?? 'm4a';
      const audioMimeType = ext === 'webm' ? 'audio/webm' : ext === 'ogg' ? 'audio/ogg' : `audio/${ext}`;
      result = await this.translationService.translateIntent({
        audioBase64,
        audioMimeType,
        chatHistory: [],
        userDictionary,
      });
    } else {
      // IMAGE / DOCUMENT: rawContent is the URL, derive local path
      const fileName = message.rawContent.split('/').pop()!;
      const localFilePath = path.join(process.cwd(), 'uploads', fileName);
      const ext = fileName.split('.').pop()?.toLowerCase() ?? 'jpg';
      const fileMimeType =
        ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
      result = await this.translationService.translateIntent({
        localFilePath,
        fileMimeType,
        rawText: message.transcription ?? undefined,
        chatHistory: [],
        userDictionary,
      });
    }

    await this.chatService.updateMessageTranslations(
      messageId,
      result.translations,
      result.confidenceScore,
    );

    return { translations: result.translations, confidenceScore: result.confidenceScore };
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
    if (!isMember) throw new ForbiddenException('You are not a member of this conversation');

    return this.chatService.searchMessages(
      groupId,
      query.trim(),
      parseInt(page, 10) || 1,
      parseInt(limit, 10) || 20,
    );
  }
}

