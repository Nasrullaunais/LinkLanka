import * as fs from 'fs';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { z } from 'zod';

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
}

@Injectable()
export class TranslationService {
  private readonly model: ChatGoogleGenerativeAI;

  constructor(private readonly configService: ConfigService) {
    this.model = new ChatGoogleGenerativeAI({
      apiKey: this.configService.getOrThrow<string>('GEMINI_API_KEY'),
      model: 'gemini-3-flash-preview',
    });
  }

  async translateIntent(
    payload: TranslateIntentPayload,
  ): Promise<TranslationResult> {
    const { chatHistory } = payload;

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
Calculate a confidence score (0-100). If the phrase is too ambiguous even with context, lower the score.
CRITICAL CONTEXT: The user has provided a custom dictionary for their specific slang. You MUST prioritize these definitions if they appear in the text: ${payload.userDictionary}
Always use terms which commonly used and easily understood by users. dont use neche terms used by only a small group of people. If the input contains terms that are not commonly used, replace them with more common alternatives in the translations, but keep the original term in the transcription.

ACTION EXTRACTION — In addition to translating, analyze the intent of the message.
If it contains a clear, actionable request for a meeting, deadline, study session (kuppiya), or reminder, extract structured data into the "extractedActions" array.
Rules:
- Only extract when there is a CLEAR intent — do not hallucinate actions from casual conversation.
- "type" is MEETING for group events, study sessions, calls, hangouts. REMINDER for personal tasks, deadlines, todos.
- "title" should be concise and descriptive in English (e.g. "Database kuppiya session").
- "timestamp" must be a valid ISO 8601 datetime. Use today's date (${new Date().toISOString().split('T')[0]}) and current time (${new Date().toISOString()}) as reference for relative phrases like "tomorrow", "tonight", "next Monday", "day after tomorrow".
  CRITICAL: You MUST use the EXACT time and date mentioned in the message. Do NOT approximate, round, or infer a different time. If the message says "4:00 PM", the timestamp MUST have 16:00. If the message says "day after tomorrow", add exactly 2 days to today's date. If the message says "tomorrow", add exactly 1 day. NEVER hallucinate or guess a time that is not explicitly stated.
- "description" is optional — include location, Zoom link, or other context if mentioned.
- If there are NO actionable items, omit "extractedActions" entirely or return an empty array.
Examples of messages WITH actions (assuming today is ${new Date().toISOString().split('T')[0]}):
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
          'IMPORTANT: If the audio is completely silent, inaudible, too quiet, or contains no recognizable speech, ' +
          'you MUST set the "transcription" field to an empty string "" and "confidenceScore" to 0. ' +
          'Do NOT hallucinate words or guess content from inaudible recordings.'
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

    return structuredModel.invoke([
      systemMessage,
      ...historyMessages,
      finalHumanMessage,
    ]);
  }
}
