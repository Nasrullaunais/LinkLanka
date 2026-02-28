import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { z } from 'zod';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RefineMode = 'professional' | 'singlish' | 'tanglish';

const RefineSchema = z.object({
  refinedText: z
    .string()
    .describe('The transformed text according to the requested mode'),
});

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class DialectService {
  private readonly model: ChatGoogleGenerativeAI;

  constructor(private readonly configService: ConfigService) {
    this.model = new ChatGoogleGenerativeAI({
      apiKey: this.configService.getOrThrow<string>('GEMINI_API_KEY'),
      model: 'gemini-3-flash-preview',
    });
  }

  async refineText(
    rawText: string,
    mode: RefineMode,
  ): Promise<{ refinedText: string }> {
    const structuredModel = this.model.withStructuredOutput(RefineSchema);

    const modeInstructions: Record<RefineMode, string> = {
      professional: `Transform the input into polished, professional English.
Rules:
- Interpret the underlying INTENT and TONE — do not translate word-for-word.
- Output should be grammatically correct, formal, and suitable for a workplace or academic setting.
- Remove slang, swear words, and colloquial expressions.
- Use full sentences. Never shorten or abbreviate.
- The output should sound like it was written by a native English speaker in a professional context.`,

      singlish: `Transform the input into casual Sri Lankan Singlish (Sinhala words written in English characters, code-mixed with English).
Rules:
- Use common Singlish words: machan, aney, aiyo, mokada, wadak, kiyapu, api, etc.
- Keep the message casual, friendly and conversational — the way Sri Lankan university students would message each other.
- Mix English and Sinhala freely in the same sentence.
- Do NOT use overly formal language.`,

      tanglish: `Transform the input into casual Sri Lankan Tanglish (Tamil words written in English characters, code-mixed with English).
Rules:
- Use common Tanglish words: da, pa, enna, sollu, vaa, poda, nalla, etc.
- Keep the message casual, friendly and conversational — the way Sri Lankan Tamil-speaking students would message each other.
- Mix English and Tamil freely in the same sentence.
- Do NOT use overly formal language.`,
    };

    const systemMessage = new SystemMessage(
      `You are a Sri Lankan linguistic AI Mediator. Your ONLY task is to rewrite the given text according to the specified style.
${modeInstructions[mode]}
Output ONLY the transformed text. Do not add explanations or commentary.`,
    );

    const result = await structuredModel.invoke([
      systemMessage,
      new HumanMessage(rawText),
    ]);

    return { refinedText: result.refinedText };
  }
}
