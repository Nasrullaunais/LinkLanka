import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import axios from 'axios';
import { z } from 'zod';

const EVENT_TIMEZONE = 'Asia/Colombo';

function getIsoLikeInTimezone(
  date: Date,
  timeZone: string,
): {
  date: string;
  dateTimeWithOffset: string;
} {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  const part = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? '';

  const year = part('year');
  const month = part('month');
  const day = part('day');
  const hour = part('hour');
  const minute = part('minute');
  const second = part('second');

  return {
    date: `${year}-${month}-${day}`,
    // Sri Lanka has a fixed +05:30 offset (no DST).
    dateTimeWithOffset: `${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`,
  };
}

export const ExtractedActionSchema = z.object({
  type: z.enum(['MEETING', 'REMINDER']),
  title: z
    .string()
    .describe(
      'A concise title summarizing the action, e.g. "Kuppiya session" or "Send database schema"',
    ),
  timestamp: z
    .string()
    .datetime()
    .describe('ISO 8601 datetime of when the meeting/reminder is scheduled'),
  description: z
    .string()
    .optional()
    .describe('Optional extra details like location, Zoom link, or context'),
});

export type ExtractedAction = z.infer<typeof ExtractedActionSchema>;

export const TranslationSchema = z.object({
  transcription: z.string(),
  translations: z.object({
    singlish: z.string(),
    tanglish: z.string(),
    english: z.string(),
  }),
  detectedLanguage: z.enum([
    'english',
    'singlish',
    'tanglish',
    'mixed',
    'unknown',
  ]).default('unknown'),
  originalTone: z.string().default('neutral'),
  confidenceScore: z.number().min(0).max(100),
  extractedActions: z
    .array(ExtractedActionSchema)
    .optional()
    .describe(
      'Structured actions extracted from the message — meetings, deadlines, reminders',
    ),
});

export type TranslationResult = z.infer<typeof TranslationSchema>;

export interface Translations {
  singlish: string;
  tanglish: string;
  english: string;
}

export type SupportedLanguage = keyof Translations;
export type DetectedLanguage = SupportedLanguage | 'mixed' | 'unknown';

export interface TranslatedAudioUrls {
  singlish?: string;
  tanglish?: string;
  english?: string;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface TranslateIntentPayload {
  rawText?: string;
  audioBase64?: string;
  audioMimeType?: string;
  localFilePath?: string;
  fileMimeType?: string;
  nativeDialect?: string;
  targetLanguages?: string[];
  chatHistory: ChatTurn[];
  userDictionary: string;
  /** IANA timezone name of the sender's device, e.g. "Asia/Colombo" */
  timezone?: string;
}

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private readonly model: ChatGoogleGenerativeAI;
  private readonly ttsModel = 'gemini-2.5-flash-preview-tts';
  private readonly geminiApiKey: string;
  private readonly uploadsDir = join(process.cwd(), 'uploads');

  constructor(private readonly configService: ConfigService) {
    this.geminiApiKey = this.configService.getOrThrow<string>('GEMINI_API_KEY');

    this.model = new ChatGoogleGenerativeAI({
      apiKey: this.geminiApiKey,
      model: 'gemini-3-flash-preview',
    });
  }

  async translateIntent(
    payload: TranslateIntentPayload,
  ): Promise<TranslationResult> {
    const { chatHistory } = payload;
    const sriLankaNow = getIsoLikeInTimezone(new Date(), EVENT_TIMEZONE);

    const structuredModel = this.model.withStructuredOutput(TranslationSchema);

    const historyMessages: Array<HumanMessage | AIMessage> = chatHistory.map(
      (turn: ChatTurn) =>
        turn.role === 'user'
          ? new HumanMessage(turn.content)
          : new AIMessage(turn.content),
    );

    const systemMessage = new SystemMessage(
      `You are a Sri Lankan linguistic AI Mediator. Analyze the conversation history.
Translate the ENTIRE content of the final human message (which may be in Singlish, Tanglish, or English).
IMPORTANT: The final message may contain multiple lines. Treat the WHOLE message as a single unit — do NOT focus on only the last line or sentence. Every line must be reflected in both the transcription and the translations.
You MUST ALWAYS output translations in ALL THREE of these formats:
- "singlish": The Sinhala written in English code-mixed colloquial form used in Sri Lanka.
- "tanglish": The Tamil written in English code-mixed colloquial form used in Sri Lanka.
- "english": Standard, grammatically correct English.
Also output a "transcription" field: for audio input this is the full verbatim transcript; for text input this is the COMPLETE original text exactly as written, preserving all lines and formatting.
Also output a "detectedLanguage" field with one of: "english", "singlish", "tanglish", "mixed", "unknown".
Also output an "originalTone" field as a short phrase describing the speaker's tone (examples: "calm", "urgent", "excited", "serious", "neutral").
LANGUAGE DETECTION RULES:
- Return "mixed" when the message meaningfully combines two or more language styles (for example: English + Singlish, English + Tanglish, or Tanglish + Singlish) in the same utterance.
- Return a single language only when one style is clearly dominant and other-language words are incidental.
- If the language cannot be confidently identified, return "unknown".
Calculate a confidence score (0-100). If the phrase is too ambiguous even with context, lower the score.
CRITICAL CONTEXT: The user has provided a custom dictionary for their specific slang. You MUST prioritize these definitions if they appear in the text: ${payload.userDictionary}
Always use terms which commonly used and easily understood by users. dont use neche terms used by only a small group of people. If the input contains terms that are not commonly used, replace them with more common alternatives in the translations, but keep the original term in the transcription.

ACTION EXTRACTION — In addition to translating, analyze the intent of the message.
If it contains a clear, actionable request for a meeting, deadline, study session (kuppiya), or reminder, extract structured data into the "extractedActions" array.
Rules:
- CRITICAL: Only extract actions when there is an EXPLICIT, UNAMBIGUOUS intent stated in clear speech. NEVER hallucinate or infer actions that were not explicitly spoken.
- If the audio quality is poor, unclear, or you are not 90%+ confident about the spoken content, do NOT extract any actions — return an empty array.
- Do NOT extract actions from background noise, mumbling, or unclear speech.
- "type" is MEETING for group events, study sessions, calls, hangouts. REMINDER for personal tasks, deadlines, todos.
- "title" should be concise and descriptive in English (e.g. "Database kuppiya session").
- "timestamp" must be a valid ISO 8601 datetime. Use today's date (${new Date().toISOString().split('T')[0]}) and current time (${new Date().toISOString()}) as reference for relative phrases like "tomorrow", "tonight", "next Monday", "day after tomorrow".
IMPORTANT TIMEZONE RULE: This app uses Sri Lanka time only (${EVENT_TIMEZONE}) for event intent.
- "timestamp" must be a valid ISO 8601 datetime in UTC with Z suffix.
- Resolve relative phrases like "tomorrow", "tonight", "next Monday", "day after tomorrow" using Sri Lanka local context only.
- Sri Lanka reference date: ${sriLankaNow.date}
- Sri Lanka reference time: ${sriLankaNow.dateTimeWithOffset}
- After resolving the local Sri Lanka date/time, convert that local moment to UTC ISO datetime with Z.
  CRITICAL: You MUST use the EXACT time and date mentioned in the message. Do NOT approximate, round, or infer a different time. If the message says "4:00 PM", the timestamp MUST have 16:00. If the message says "day after tomorrow", add exactly 2 days to today's date. If the message says "tomorrow", add exactly 1 day. NEVER hallucinate or guess a time that is not explicitly stated.
- "description" is optional — include location, Zoom link, or other context if mentioned.
- If there are NO actionable items, omit "extractedActions" entirely or return an empty array.
Examples of messages WITH actions (assuming Sri Lanka date is ${sriLankaNow.date}):
- "Machan, let's have a kuppiya tomorrow at 8 PM on Zoom" → MEETING, timestamp must be tomorrow at exactly 20:00
- "Remind me to send the database schema tonight" → REMINDER
- "DB assignment deadline is next Friday 11:59 PM" → REMINDER
- "Let's meet day after tomorrow at 4 PM" → MEETING, timestamp must be day-after-tomorrow at exactly 16:00
Examples of messages WITHOUT actions:
- "Ado how was the exam?" → no actions
- "Nice bro, thanks" → no actions`,
    );

    const cleanAudioBase64: string | undefined = payload.audioBase64
      ? (payload.audioBase64.includes(',')
          ? payload.audioBase64.split(',')[1]
          : payload.audioBase64
        ).replace(/\s/g, '')
      : undefined;

    let finalHumanMessage: HumanMessage;

    if (payload.localFilePath) {
      const base64String = await fs.promises.readFile(payload.localFilePath, {
        encoding: 'base64',
      });
      const isAudioFile = (payload.fileMimeType ?? '').startsWith('audio/');
      const promptText = isAudioFile
        ? 'Transcribe this audio in its native dialect, then translate the intent. ' +
          'CRITICAL SILENCE / INAUDIBILITY RULES (you MUST follow these strictly):\n' +
          '1. If the audio is silent, near-silent, contains only background noise, breathing, wind, or static — ' +
          'set "transcription" to "" (empty string), "confidenceScore" to 0, and "extractedActions" to [].\n' +
          '2. Do NOT invent, guess, or hallucinate words, sentences, meetings, reminders, or calendar events that are not CLEARLY and UNMISTAKABLY spoken in the audio.\n' +
          '3. If you are less than 80% confident that you can hear real, intelligible human speech, treat it as inaudible: transcription="", confidenceScore=0.\n' +
          '4. NEVER extract actions (meetings, reminders, deadlines) unless the speech is clearly audible AND explicitly mentions a specific event or task. Random background noise is NOT speech.\n' +
          '5. It is ALWAYS better to return an empty transcription than to hallucinate content that was not actually said.'
        : 'Read this media. If it is an image/document, extract the text (OCR). Then translate the intent.' +
          (payload.rawText ? ' User context: ' + payload.rawText : '');
      finalHumanMessage = new HumanMessage({
        content: [
          {
            type: 'text',
            text: promptText,
          },
          {
            type: 'media',
            mimeType: payload.fileMimeType ?? 'image/jpeg',
            data: base64String,
          },
        ],
      });
    } else if (cleanAudioBase64) {
      finalHumanMessage = new HumanMessage({
        content: [
          {
            type: 'text',
            text: 'Transcribe this audio in its native dialect, then translate it.',
          },
          {
            type: 'media',
            mimeType: payload.audioMimeType || 'audio/webm',
            data: cleanAudioBase64,
          },
        ],
      });
    } else {
      finalHumanMessage = new HumanMessage(payload.rawText ?? '');
    }

    const result = await structuredModel.invoke([
      systemMessage,
      ...historyMessages,
      finalHumanMessage,
    ]);

    return {
      ...result,
      detectedLanguage: result.detectedLanguage ?? 'unknown',
      originalTone: result.originalTone ?? 'neutral',
    };
  }

  async generateTranslatedAudioFiles(params: {
    translations: Translations;
    detectedLanguage: DetectedLanguage;
    originalTone: string;
  }): Promise<TranslatedAudioUrls> {
    const targets = this.getTargetLanguages(params.detectedLanguage);
    if (targets.length === 0) return {};

    await fs.promises.mkdir(this.uploadsDir, { recursive: true });

    const output: TranslatedAudioUrls = {};
    for (const language of targets) {
      const text = params.translations[language]?.trim();
      if (!text) continue;

      try {
        const wavAudio = await this.generateSpeechWav({
          transcript: text,
          language,
          tone: params.originalTone,
        });

        const fileName = `tts-${language}-${randomUUID()}.wav`;
        await fs.promises.writeFile(join(this.uploadsDir, fileName), wavAudio);
        output[language] = `${this.getBaseUrl()}/uploads/${fileName}`;
      } catch (error) {
        this.logger.warn(
          `[generateTranslatedAudioFiles] Failed for ${language}: ${String(error)}`,
        );
      }
    }

    return output;
  }

  private getTargetLanguages(detectedLanguage: DetectedLanguage): SupportedLanguage[] {
    switch (detectedLanguage) {
      case 'singlish':
        return ['english', 'tanglish'];
      case 'tanglish':
        return ['english', 'singlish'];
      case 'english':
        return ['singlish', 'tanglish'];
      case 'mixed':
      case 'unknown':
      default:
        return ['english', 'singlish', 'tanglish'];
    }
  }

  private async generateSpeechWav(params: {
    transcript: string;
    language: SupportedLanguage;
    tone: string;
  }): Promise<Buffer> {
    const prompt = this.buildTtsPrompt(params);

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.ttsModel}:generateContent`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Achird',
              },
            },
          },
        },
        model: this.ttsModel,
      },
      {
        headers: {
          'x-goog-api-key': this.geminiApiKey,
          'Content-Type': 'application/json',
        },
        timeout: 45_000,
      },
    );

    const encoded = this.extractInlineAudioBase64(response.data);
    if (!encoded) {
      throw new Error('Gemini TTS response did not include inline audio data');
    }

    const pcm = Buffer.from(encoded, 'base64');
    return this.pcm16ToWav(pcm, 24_000, 1);
  }

  private extractInlineAudioBase64(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;

    const candidates = (payload as { candidates?: unknown[] }).candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return null;

    for (const candidate of candidates) {
      const parts =
        (candidate as {
          content?: { parts?: Array<{ inlineData?: { data?: string } }> };
        }).content?.parts ?? [];

      for (const part of parts) {
        const data = part.inlineData?.data;
        if (typeof data === 'string' && data.length > 0) {
          return data;
        }
      }
    }

    return null;
  }

  private buildTtsPrompt(params: {
    transcript: string;
    language: SupportedLanguage;
    tone: string;
  }): string {
    const accentHint =
      params.language === 'tanglish'
        ? 'Sri Lankan Tamil-influenced accent'
        : params.language === 'singlish'
          ? 'Sri Lankan Sinhala-influenced accent'
          : 'clear Sri Lankan English accent';

    return [
      '# AUDIO PROFILE: LinkLanka Voice Talent',
      '## "Chat Voice Translation"',
      '',
      '## THE SCENE: A friendly chat voice note played inside a messaging app.',
      '',
      '### DIRECTOR\'S NOTES',
      `Style: ${params.tone || 'neutral'}`,
      'Pacing: Natural conversational pacing with clear diction.',
      `Accent: ${accentHint}`,
      'Pronunciation: If transliterated Sri Lankan words appear, pronounce them naturally as used in Sri Lanka.',
      '',
      '#### TRANSCRIPT',
      params.transcript,
    ].join('\n');
  }

  private getBaseUrl(): string {
    const baseUrl = this.configService.get<string>('BASE_URL');
    return (baseUrl && baseUrl.trim()) || 'http://localhost:3000';
  }

  private pcm16ToWav(
    pcmData: Buffer,
    sampleRate: number,
    channels: number,
  ): Buffer {
    const bitsPerSample = 16;
    const byteRate = (sampleRate * channels * bitsPerSample) / 8;
    const blockAlign = (channels * bitsPerSample) / 8;
    const wavHeader = Buffer.alloc(44);

    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + pcmData.length, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(channels, 22);
    wavHeader.writeUInt32LE(sampleRate, 24);
    wavHeader.writeUInt32LE(byteRate, 28);
    wavHeader.writeUInt16LE(blockAlign, 32);
    wavHeader.writeUInt16LE(bitsPerSample, 34);
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(pcmData.length, 40);

    return Buffer.concat([wavHeader, pcmData]);
  }
}
