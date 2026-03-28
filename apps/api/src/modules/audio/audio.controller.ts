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
import {
  DetectedLanguage,
  ExtractedAction,
  TranslatedAudioUrls,
} from '../translation/translation.service';

/** What the mobile client POSTs to /audio/process */
interface ProcessAudioDto {
  groupId: unknown;
  audioBase64: unknown;
  audioMimeType?: unknown;
  /** IANA timezone name of the sender's device, e.g. "Asia/Colombo" */
  timezone?: unknown;
  /** Audio track duration in milliseconds */
  durationMs?: unknown;
}

/** Shape returned to the caller on success (Phase 1 — immediate response) */
interface ProcessAudioResult {
  success: true;
  messageId: string;
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
   * Two-phase pipeline:
   *   Phase 1 (synchronous — returned to caller):
   *     1. Validate payload & group membership.
   *     2. Save base64 audio buffer to disk.
   *     3. Persist the raw message to the database (no transcription yet).
   *     4. Broadcast `newMessage` to the Socket.IO room (with translations: null).
   *     5. Return { success, messageId } immediately.
   *
   *   Phase 2 (async — fire-and-forget):
   *     6. Run Gemini transcription + translation.
   *     7. Audibility gate — if inaudible, broadcast `translationFailed`.
   *     8. Persist transcription/translations to the database.
   *     9. Broadcast `messageTranslated` to the Socket.IO room.
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

    // ── 4. Persist raw message (Phase 1 — no transcription/translation) ──
    const durationMs =
      typeof body.durationMs === 'number' ? body.durationMs : 0;
    const rawContent =
      durationMs > 0 ? JSON.stringify({ url: fileUrl, durationMs }) : fileUrl;

    const message = await this.chatService.saveMessage(
      userId,
      groupId,
      MessageContentType.AUDIO,
      rawContent,
      null, // transcription — filled in Phase 2
      null, // translations — filled in Phase 2
      null, // confidenceScore — filled in Phase 2
      null, // extractedActions — filled in Phase 2
    );

    this.logger.log(
      `[processAudio] Message persisted (Phase 1): messageId=${message.id}, groupId=${groupId}`,
    );

    // ── 5. Broadcast raw message immediately ──────────────────────────────
    this.chatGateway.broadcastNewMessage(groupId, {
      messageId: message.id,
      senderId: userId,
      contentType: MessageContentType.AUDIO,
      fileUrl: rawContent, // We send the JSON text or url so clients parsing it works
      transcription: null,
      originalText: null,
      translations: null,
      confidenceScore: null,
      extractedActions: null,
    });

    // ── 6. Kick off Phase 2 asynchronously ────────────────────────────────
    const timezone =
      typeof body.timezone === 'string' && body.timezone.trim()
        ? body.timezone.trim()
        : undefined;

    this.transcribeAndBroadcast(
      message.id,
      userId,
      groupId,
      fileUrl,
      rawMime,
      timezone,
    ).catch((err) =>
      this.logger.error(
        `[processAudio Phase 2] messageId=${message.id} failed: ${String(err)}`,
      ),
    );

    // ── 7. Return immediately ─────────────────────────────────────────────
    return {
      success: true,
      messageId: message.id,
    };
  }

  /**
   * Phase 2 of audio processing: runs Gemini transcription + translation,
   * checks audibility, persists results, and broadcasts the update.
   */
  private async transcribeAndBroadcast(
    messageId: string,
    userId: string,
    groupId: string,
    fileUrl: string,
    rawMime: string,
    timezone?: string,
  ): Promise<void> {
    // Gemini only accepts 'audio/mp4' for AAC / M4A content.
    const geminiMime = rawMime === 'audio/m4a' ? 'audio/mp4' : rawMime;
    const savedFileName = fileUrl.split('/').pop()!;
    const localFilePath = path.join(process.cwd(), 'uploads', savedFileName);

    // ── Fetch user personalization dictionary ─────────────────────────────
    const userDictionary =
      await this.personalContextService.getUserDictionary(userId);

    // ── Gemini transcription + translation ────────────────────────────────
    this.logger.log(
      `[transcribeAndBroadcast] Running Gemini transcription for messageId=${messageId}`,
    );

    const result = await this.translationService.translateIntent({
      localFilePath,
      fileMimeType: geminiMime,
      chatHistory: [],
      userDictionary,
      timezone,
    });

    const {
      transcription,
      translations,
      detectedLanguage,
      originalTone,
      confidenceScore,
      extractedActions,
    } = result;

    // ── Audibility gate ───────────────────────────────────────────────────
    const appearsInaudible =
      (confidenceScore !== null && confidenceScore <= 25) ||
      !transcription ||
      transcription.trim().length === 0;

    if (appearsInaudible) {
      this.logger.warn(
        `[transcribeAndBroadcast] Inaudible audio: messageId=${messageId}, confidenceScore=${confidenceScore}`,
      );

      const inaudibleScore = confidenceScore ?? 0;

      // Persist as inaudible instead of bailing
      await this.chatService.updateMessageWithTranslation(messageId, {
        transcription: null,
        translations: null,
        detectedLanguage: null,
        originalTone: null,
        translatedAudioUrls: null,
        confidenceScore: inaudibleScore,
        extractedActions: null,
      });

      this.chatGateway.broadcastTranslationUpdate(
        groupId,
        userId,
        {
          messageId,
          transcription: null,
          translations: null,
          detectedLanguage: null,
          originalTone: null,
          translatedAudioUrls: null,
          confidenceScore: inaudibleScore,
          extractedActions: null,
        },
        'Sent an audio message',
      );
      return;
    }

    let translatedAudioUrls: TranslatedAudioUrls | null = null;
    try {
      translatedAudioUrls =
        await this.translationService.generateTranslatedAudioFiles({
          translations,
          detectedLanguage: (detectedLanguage ?? 'unknown') as DetectedLanguage,
          originalTone: originalTone ?? 'neutral',
        });
    } catch (error) {
      this.logger.warn(
        `[transcribeAndBroadcast] TTS generation failed for messageId=${messageId}: ${String(error)}`,
      );
    }

    // ── Process extracted actions ─────────────────────────────────────────
    let processedActions: ExtractedAction[] | null = null;
    if (
      extractedActions &&
      extractedActions.length > 0 &&
      confidenceScore >= 60
    ) {
      processedActions = this.actionService.processActions(
        messageId,
        userId,
        groupId,
        extractedActions,
      );
    } else if (extractedActions && extractedActions.length > 0) {
      this.logger.warn(
        `[transcribeAndBroadcast] Discarding ${extractedActions.length} extracted action(s) due to low confidence (${confidenceScore}) for messageId=${messageId}`,
      );
    }

    // ── Persist transcription + translations ──────────────────────────────
    await this.chatService.updateMessageWithTranslation(messageId, {
      transcription,
      translations,
      detectedLanguage: (detectedLanguage ?? 'unknown') as DetectedLanguage,
      originalTone: originalTone ?? 'neutral',
      translatedAudioUrls,
      confidenceScore,
      extractedActions: processedActions,
    });

    this.logger.log(
      `[transcribeAndBroadcast] Translation persisted (Phase 2): messageId=${messageId}`,
    );

    // ── Broadcast translation update ──────────────────────────────────────
    this.chatGateway.broadcastTranslationUpdate(
      groupId,
      userId,
      {
        messageId,
        transcription,
        translations,
        detectedLanguage: (detectedLanguage ?? 'unknown') as DetectedLanguage,
        originalTone: originalTone ?? 'neutral',
        translatedAudioUrls,
        confidenceScore,
        extractedActions: processedActions,
      },
      transcription ?? '',
    );
  }
}
