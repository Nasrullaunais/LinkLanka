import * as path from 'path';

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Request,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../core/identity/guards/jwt-auth.guard';
import { GroupsService } from '../groups/groups.service';
import { PersonalContextService } from '../personal-context/personal-context.service';
import { TranslationService } from '../translation/translation.service';
import { ChatService } from '../chat/chat.service';
import { ChatGateway } from '../chat/chat.gateway';
import { MessageContentType } from '../chat/entities/message.entity';
import { AudioService } from './audio.service';
import { ActionService } from '../actions/action.service';
import { ExtractedAction } from '../translation/translation.service';

/** What the mobile client POSTs to /audio/process */
interface ProcessAudioDto {
  groupId: unknown;
  audioBase64: unknown;
  audioMimeType?: unknown;
}

/** Shape returned to the caller on success */
interface ProcessAudioResult {
  success: true;
  messageId: string;
  transcription: string | null;
  translations: {
    english: string;
    singlish: string;
    tanglish: string;
  } | null;
  confidenceScore: number;
  extractedActions?: ExtractedAction[] | null;
}

interface AuthRequest {
  user: { sub: string; email: string };
}

/**
 * Dedicated REST controller for audio message processing.
 *
 * Separating audio from the WebSocket gateway gives us:
 *  - Proper HTTP error codes (400 / 422 / 500) instead of socket error events.
 *  - A clean audibility gate — inaudible audio is rejected before it reaches
 *    the AI translation layer, preventing hallucinated transcriptions.
 *  - Isolation of the heavy (disk I/O + Gemini call) audio pipeline from the
 *    lightweight real-time socket path used for text/image messages.
 */
@Controller('audio')
@UseGuards(JwtAuthGuard)
export class AudioController {
  private readonly logger = new Logger(AudioController.name);

  constructor(
    private readonly audioService: AudioService,
    private readonly chatService: ChatService,
    private readonly chatGateway: ChatGateway,
    private readonly groupsService: GroupsService,
    private readonly personalContextService: PersonalContextService,
    private readonly translationService: TranslationService,
    private readonly actionService: ActionService,
  ) {}

  /**
   * POST /audio/process
   *
   * Pipeline:
   *   1. Validate payload & group membership.
   *   2. Save base64 audio buffer to disk.
   *   3. Run Gemini transcription + translation.
   *   4. Reject with 422 audioNotAudible if the recording was silent / inaudible.
   *   5. Persist the message to the database.
   *   6. Broadcast `newMessage` to the Socket.IO room.
   *   7. Return the result to the caller.
   */
  @Post('process')
  @HttpCode(HttpStatus.OK)
  async processAudio(
    @Body() body: ProcessAudioDto,
    @Request() req: AuthRequest,
  ): Promise<ProcessAudioResult> {
    const userId = req.user.sub;

    // ── 1. Input validation ───────────────────────────────────────────────
    if (typeof body.groupId !== 'string' || !body.groupId.trim()) {
      throw new BadRequestException('groupId is required');
    }
    if (
      typeof body.audioBase64 !== 'string' ||
      body.audioBase64.trim().length < 10
    ) {
      throw new BadRequestException(
        'audioBase64 is required and must be a non-empty string',
      );
    }

    const groupId = body.groupId.trim();
    const audioBase64 = body.audioBase64.trim();
    const rawMime =
      typeof body.audioMimeType === 'string' && body.audioMimeType.trim()
        ? body.audioMimeType.trim()
        : 'audio/mp4';

    // Gemini only accepts 'audio/mp4' for AAC / M4A content.
    const geminiMime = rawMime === 'audio/m4a' ? 'audio/mp4' : rawMime;

    // ── 2. Group membership check ─────────────────────────────────────────
    const isMember = await this.groupsService.isMember(groupId, userId);
    if (!isMember) {
      throw new BadRequestException('You are not a member of this group');
    }

    // ── 3. Persist audio to disk ──────────────────────────────────────────
    this.logger.log(
      `[processAudio] Saving audio for userId=${userId} groupId=${groupId}`,
    );

    const fileUrl = await this.audioService.saveAudioBuffer(
      audioBase64,
      rawMime,
    );
    const savedFileName = fileUrl.split('/').pop()!;
    const localFilePath = path.join(process.cwd(), 'uploads', savedFileName);

    // ── 4. Fetch user personalization dictionary ──────────────────────────
    const userDictionary =
      await this.personalContextService.getUserDictionary(userId);

    // ── 5. Gemini transcription + translation ─────────────────────────────
    this.logger.log(
      `[processAudio] Running Gemini transcription for userId=${userId}`,
    );

    const result = await this.translationService.translateIntent({
      localFilePath,
      fileMimeType: geminiMime,
      chatHistory: [],
      userDictionary,
    });

    const { transcription, translations, confidenceScore, extractedActions } =
      result;

    // ── 6. Audibility gate ────────────────────────────────────────────────
    // Gemini is instructed to return transcription="" and confidenceScore=0
    // for inaudible / silent recordings. We enforce that here so that the
    // client receives a clear, structured error rather than a hallucinated
    // transcription with garbage content.
    const appearsInaudible =
      confidenceScore <= 5 ||
      !transcription ||
      transcription.trim().length === 0;

    if (appearsInaudible) {
      this.logger.warn(
        `[processAudio] Inaudible audio rejected: userId=${userId}, confidenceScore=${confidenceScore}`,
      );
      // HTTP 422 — the request was valid but semantically unprocessable.
      throw new UnprocessableEntityException({
        reason: 'audioNotAudible',
        message:
          "Your audio wasn't audible. Please record in a quieter environment or speak louder.",
      });
    }

    // ── 6b. Process extracted actions ──────────────────────────────────────
    let processedActions: ExtractedAction[] | null = null;
    if (extractedActions && extractedActions.length > 0) {
      processedActions = this.actionService.processActions(
        'pending',
        userId,
        groupId,
        extractedActions,
      );
    }

    // ── 7. Persist message ────────────────────────────────────────────────
    const message = await this.chatService.saveMessage(
      userId,
      groupId,
      MessageContentType.AUDIO,
      fileUrl,
      transcription,
      translations,
      confidenceScore,
      processedActions,
    );

    this.logger.log(
      `[processAudio] Message persisted: messageId=${message.id}, groupId=${groupId}`,
    );

    // ── 8. Broadcast to room ──────────────────────────────────────────────
    this.chatGateway.broadcastToGroup(groupId, {
      messageId: message.id,
      senderId: userId,
      contentType: MessageContentType.AUDIO,
      fileUrl,
      transcription,
      originalText: transcription,
      translations,
      confidenceScore,
      extractedActions: processedActions,
    });

    // ── 9. Return result to caller ────────────────────────────────────────
    return {
      success: true,
      messageId: message.id,
      transcription,
      translations,
      confidenceScore,
      extractedActions: processedActions,
    };
  }
}
