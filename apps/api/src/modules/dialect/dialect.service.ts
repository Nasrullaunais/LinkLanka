import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { z } from 'zod';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RefineMode = 'professional' | 'singlish' | 'tanglish';
export type DialectTargetLanguage = 'english' | 'singlish' | 'tanglish';
export type DialectDetectedLanguage =
  | 'english'
  | 'singlish'
  | 'tanglish'
  | 'mixed';
export type DialectDetectedTone = 'professional' | 'casual' | 'neutral';
export type DialectTargetTone = 'professional' | 'casual';

const RefineSchema = z.object({
  refinedText: z
    .string()
    .describe('The transformed text according to the requested mode'),
});

const SuggestDialectSchema = z.object({
  detectedLanguage: z.enum(['english', 'singlish', 'tanglish', 'mixed']),
  detectedTone: z.enum(['professional', 'casual', 'neutral']),
  confidence: z.number().min(0).max(100),
  suggestedTargetLanguages: z
    .array(z.enum(['english', 'singlish', 'tanglish']))
    .min(1)
    .max(3),
  suggestedTones: z
    .array(z.enum(['professional', 'casual']))
    .min(1)
    .max(2),
  reason: z.string().optional(),
});

type SuggestDialectResult = z.infer<typeof SuggestDialectSchema>;

interface LanguageHeuristicProfile {
  detectedLanguage: DialectDetectedLanguage;
  languageConfidence: number;
  languageRanking: DialectTargetLanguage[];
  singlishScore: number;
  tanglishScore: number;
}

interface ToneHeuristicProfile {
  detectedTone: DialectDetectedTone;
  toneConfidence: number;
  toneRanking: DialectTargetTone[];
}

interface SuggestionHeuristicProfile {
  language: LanguageHeuristicProfile;
  tone: ToneHeuristicProfile;
  reason: string;
}

const LANGUAGE_BASE_ORDER: DialectTargetLanguage[] = [
  'english',
  'singlish',
  'tanglish',
];
const TONE_BASE_ORDER: DialectTargetTone[] = ['professional', 'casual'];

const SINGLISH_PATTERNS: Array<{ re: RegExp; weight: number }> = [
  { re: /\bmachan\b/gi, weight: 3 },
  { re: /\baney\b/gi, weight: 3 },
  { re: /\baiyo\b/gi, weight: 3 },
  { re: /\bmokada\b/gi, weight: 3 },
  { re: /\bkiyala\b/gi, weight: 2 },
  { re: /\bhari\b/gi, weight: 2 },
  { re: /\bwadak\b/gi, weight: 2 },
  { re: /\bapi\b/gi, weight: 1 },
  { re: /\bonna\b/gi, weight: 1 },
  { re: /\bnangi\b|\bmalli\b/gi, weight: 1 },
];

const TANGLISH_PATTERNS: Array<{ re: RegExp; weight: number }> = [
  { re: /\benna\b/gi, weight: 3 },
  { re: /\bsollu\b/gi, weight: 3 },
  { re: /\bvaa\b/gi, weight: 3 },
  { re: /\bpoda\b/gi, weight: 3 },
  { re: /\bnalla\b/gi, weight: 2 },
  { re: /\bseri\b/gi, weight: 2 },
  { re: /\bpa\b/gi, weight: 1 },
  { re: /\bda\b/gi, weight: 1 },
  { re: /\bmachi\b/gi, weight: 1 },
  { re: /\bamma\b|\banna\b/gi, weight: 1 },
];

const PROFESSIONAL_PATTERNS: Array<{ re: RegExp; weight: number }> = [
  { re: /\bregards\b/gi, weight: 3 },
  { re: /\bkindly\b/gi, weight: 3 },
  { re: /\bdeadline\b/gi, weight: 2 },
  { re: /\bmeeting\b/gi, weight: 2 },
  { re: /\bschedule\b/gi, weight: 2 },
  { re: /\battached\b/gi, weight: 2 },
  { re: /\bplease\b/gi, weight: 1 },
  { re: /\bupdate\b/gi, weight: 1 },
  { re: /\bproposal\b|\breport\b|\bclient\b/gi, weight: 1 },
];

const CASUAL_PATTERNS: Array<{ re: RegExp; weight: number }> = [
  { re: /\bmachan\b|\bmachi\b|\bbro\b/gi, weight: 3 },
  { re: /\bhaha\b|\blol\b|\blmao\b/gi, weight: 2 },
  { re: /\bpls\b|\bthx\b|\bty\b/gi, weight: 2 },
  { re: /\bhey\b|\byo\b/gi, weight: 1 },
  { re: /\bu\b|\bur\b|\btho\b|\bgonna\b/gi, weight: 1 },
];

const SINGLISH_FORBIDDEN_IN_TANGLISH = [
  'machan',
  'aney',
  'aiyo',
  'mokada',
  'kiyala',
  'wadak',
  'hari',
  'api',
];

const TANGLISH_FORBIDDEN_IN_SINGLISH = [
  'enna',
  'sollu',
  'vaa',
  'poda',
  'nalla',
  'seri',
  'machi',
];

const CODEMIX_FORBIDDEN_IN_ENGLISH = [
  ...SINGLISH_FORBIDDEN_IN_TANGLISH,
  ...TANGLISH_FORBIDDEN_IN_SINGLISH,
  'da',
  'pa',
];

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

  async suggestDialectOptions(rawText: string): Promise<SuggestDialectResult> {
    const text = rawText.trim();
    const heuristic = this.buildHeuristicProfile(text);
    const fallback = this.getFallbackSuggestions(heuristic);

    if (text.length < 3) {
      return fallback;
    }

    try {
      const structuredModel =
        this.model.withStructuredOutput(SuggestDialectSchema);
      const result = await structuredModel.invoke([
        new SystemMessage(
          `You are a Sri Lankan messaging assistant.
Detect the source language and tone of the user's text, then suggest target rewrite options.

Language labels:
- english: mostly standard English
- singlish: Sinhala words written in English, often code-mixed with English
- tanglish: Tamil words written in English, often code-mixed with English
- mixed: no clear dominant language mix

Tone labels:
- professional: formal, structured, workplace/academic
- casual: relaxed, chat-like, colloquial
- neutral: neither strongly professional nor strongly casual

Return only structured JSON via the provided schema.
Rules:
- confidence is 0-100.
- suggestedTargetLanguages must include distinct values only and be ordered best-first.
- suggestedTones must include distinct values only and be ordered best-first.
- Keep reason brief and practical.`,
        ),
        new HumanMessage(text),
      ]);

      return this.normalizeSuggestions(result, fallback, heuristic);
    } catch {
      return fallback;
    }
  }

  async refineTextV2(
    rawText: string,
    targetLanguage: DialectTargetLanguage,
    targetTone: DialectTargetTone,
  ): Promise<{ refinedText: string }> {
    const structuredModel = this.model.withStructuredOutput(RefineSchema);
    const languageInstruction = this.getLanguageInstruction(targetLanguage);
    const toneInstruction =
      targetTone === 'professional'
        ? `Use a polished, precise, respectful tone suitable for workplace or academic communication. Keep it clear and grammatically strong.`
        : `Use a relaxed, natural, friendly chat tone. Keep it concise, conversational, and easy to read.`;

    const result = await structuredModel.invoke([
      new SystemMessage(
        `You are a Sri Lankan linguistic AI Mediator.
Rewrite the input according to the requested target language and target tone.

Target language instruction:
${languageInstruction}

Target tone instruction:
${toneInstruction}

Rules:
- Preserve the original intent and key details.
- Do not add new facts.
- Keep the output as a single clean message.
- STRICT LANGUAGE COMPLIANCE is mandatory.
- If targetLanguage is english: output must be only natural standard English. Do NOT include Singlish/Tanglish particles or transliterated dialect words.
- If targetLanguage is singlish: use Sinhala-English romanized style. Do NOT include Tamil discourse particles or Tanglish-specific words.
- If targetLanguage is tanglish: use Tamil-English romanized style. Do NOT include Sinhala discourse particles or Singlish-specific words.
- Never explain rules, never add labels, never add bullet points.
- Output ONLY the transformed text.`,
      ),
      new HumanMessage(rawText),
    ]);

    let refinedText = result.refinedText.trim();
    if (!this.isOutputCompliant(refinedText, targetLanguage)) {
      const correction = await structuredModel.invoke([
        new SystemMessage(
          `You are a strict rewrite validator.
Your job is to rewrite text so it fully complies with the target language rules.
Output MUST be a single message string only.

Target language: ${targetLanguage}
Target tone: ${targetTone}

Hard constraints:
- english: standard English only, no Singlish/Tanglish particles.
- singlish: Sinhala-English romanized only, no Tanglish particles.
- tanglish: Tamil-English romanized only, no Singlish particles.
- Keep original intent, keep brevity, no extra commentary.`,
        ),
        new HumanMessage(
          `Original input:\n${rawText}\n\nNon-compliant draft:\n${refinedText}`,
        ),
      ]);

      refinedText = correction.refinedText.trim();
    }

    return { refinedText };
  }

  private getLanguageInstruction(
    targetLanguage: DialectTargetLanguage,
  ): string {
    if (targetLanguage === 'english') {
      return `Use standard, natural English. Avoid code-mix terms unless absolutely necessary for meaning.`;
    }

    if (targetLanguage === 'singlish') {
      return `Use Sri Lankan Singlish (Sinhala words in English characters) naturally mixed with English. Prefer commonly understood, everyday terms.`;
    }

    return `Use Sri Lankan Tanglish (Tamil words in English characters) naturally mixed with English. Prefer commonly understood, everyday terms.`;
  }

  private getFallbackSuggestions(
    heuristic: SuggestionHeuristicProfile,
  ): SuggestDialectResult {
    const confidence = Math.round(
      heuristic.language.languageConfidence * 0.7 +
        heuristic.tone.toneConfidence * 0.3,
    );

    return {
      detectedLanguage: heuristic.language.detectedLanguage,
      detectedTone: heuristic.tone.detectedTone,
      confidence: Math.max(50, Math.min(92, confidence)),
      suggestedTargetLanguages: heuristic.language.languageRanking,
      suggestedTones: heuristic.tone.toneRanking,
      reason: heuristic.reason,
    };
  }

  private normalizeSuggestions(
    result: SuggestDialectResult,
    fallback: SuggestDialectResult,
    heuristic: SuggestionHeuristicProfile,
  ): SuggestDialectResult {
    const languageOrder = this.mergeLanguageRanking(
      result.suggestedTargetLanguages,
      fallback.suggestedTargetLanguages,
      heuristic.language.languageRanking,
    );
    const toneOrder = this.mergeToneRanking(
      result.suggestedTones,
      fallback.suggestedTones,
      heuristic.tone.toneRanking,
    );

    const languageOverrideConfidence = heuristic.language.languageConfidence;
    const toneOverrideConfidence = heuristic.tone.toneConfidence;

    const detectedLanguage =
      languageOverrideConfidence >= 70
        ? heuristic.language.detectedLanguage
        : (result.detectedLanguage ?? fallback.detectedLanguage);
    const detectedTone =
      toneOverrideConfidence >= 72
        ? heuristic.tone.detectedTone
        : (result.detectedTone ?? fallback.detectedTone);

    const blendedConfidence = Math.round(
      (result.confidence ?? fallback.confidence) * 0.65 +
        (heuristic.language.languageConfidence * 0.7 +
          heuristic.tone.toneConfidence * 0.3) *
          0.35,
    );

    const reason = result.reason?.trim();
    const heuristicReason = heuristic.reason;

    const mergedReason = reason
      ? `${reason} ${heuristicReason}`.trim()
      : heuristicReason;

    return {
      detectedLanguage,
      detectedTone,
      confidence: Math.max(0, Math.min(100, blendedConfidence)),
      suggestedTargetLanguages: languageOrder,
      suggestedTones: toneOrder,
      reason: mergedReason,
    };
  }

  private buildHeuristicProfile(text: string): SuggestionHeuristicProfile {
    const normalized = text.toLowerCase();
    const wordCount = (normalized.match(/[a-z']+/g) ?? []).length;

    const singlishScore = this.scoreByPatterns(normalized, SINGLISH_PATTERNS);
    const tanglishScore = this.scoreByPatterns(normalized, TANGLISH_PATTERNS);

    let detectedLanguage: DialectDetectedLanguage = 'english';
    let languageRanking: DialectTargetLanguage[] = [
      'english',
      'singlish',
      'tanglish',
    ];

    const combinedCodeMix = singlishScore + tanglishScore;
    const dominantGap = Math.abs(singlishScore - tanglishScore);

    if (
      singlishScore >= 2 &&
      tanglishScore >= 2 &&
      dominantGap <= Math.max(2, Math.floor(combinedCodeMix * 0.35))
    ) {
      detectedLanguage = 'mixed';
      if (singlishScore >= tanglishScore) {
        languageRanking = ['english', 'singlish', 'tanglish'];
      } else {
        languageRanking = ['english', 'tanglish', 'singlish'];
      }
    } else if (singlishScore >= tanglishScore * 1.35 && singlishScore >= 2) {
      detectedLanguage = 'singlish';
      languageRanking = ['english', 'tanglish', 'singlish'];
    } else if (tanglishScore >= singlishScore * 1.35 && tanglishScore >= 2) {
      detectedLanguage = 'tanglish';
      languageRanking = ['english', 'singlish', 'tanglish'];
    }

    const languageConfidence = Math.min(
      94,
      52 +
        combinedCodeMix * 5 +
        Math.min(
          10,
          Math.round((combinedCodeMix / Math.max(1, wordCount)) * 100),
        ),
    );

    const professionalScore = this.scoreByPatterns(
      normalized,
      PROFESSIONAL_PATTERNS,
    );
    const casualScore = this.scoreByPatterns(normalized, CASUAL_PATTERNS);

    let detectedTone: DialectDetectedTone = 'neutral';
    let toneRanking: DialectTargetTone[] = ['casual', 'professional'];
    if (professionalScore >= casualScore + 2) {
      detectedTone = 'professional';
      toneRanking = ['professional', 'casual'];
    } else if (casualScore >= professionalScore + 1) {
      detectedTone = 'casual';
      toneRanking = ['casual', 'professional'];
    }

    const toneConfidence = Math.min(
      92,
      detectedTone === 'neutral'
        ? 58
        : 62 + Math.max(professionalScore, casualScore) * 6,
    );

    return {
      language: {
        detectedLanguage,
        languageConfidence,
        languageRanking,
        singlishScore,
        tanglishScore,
      },
      tone: {
        detectedTone,
        toneConfidence,
        toneRanking,
      },
      reason:
        detectedLanguage === 'mixed'
          ? 'Detected code-mixed Singlish/Tanglish usage and prioritized balanced targets.'
          : 'Suggestions tuned using Sri Lankan language and tone cues.',
    };
  }

  private scoreByPatterns(
    text: string,
    patterns: Array<{ re: RegExp; weight: number }>,
  ): number {
    let score = 0;
    for (const { re, weight } of patterns) {
      const matches = text.match(re);
      if (matches) score += matches.length * weight;
    }
    return score;
  }

  private mergeLanguageRanking(
    model: DialectTargetLanguage[],
    fallback: DialectTargetLanguage[],
    heuristic: DialectTargetLanguage[],
  ): DialectTargetLanguage[] {
    const modelWeight = this.rankWeights(model);
    const fallbackWeight = this.rankWeights(fallback);
    const heuristicWeight = this.rankWeights(heuristic);

    const scored = [...LANGUAGE_BASE_ORDER]
      .map((lang) => ({
        lang,
        score:
          (modelWeight.get(lang) ?? 0) * 0.45 +
          (heuristicWeight.get(lang) ?? 0) * 0.4 +
          (fallbackWeight.get(lang) ?? 0) * 0.15,
      }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.lang);

    return this.ensureDistinct(scored, LANGUAGE_BASE_ORDER);
  }

  private mergeToneRanking(
    model: DialectTargetTone[],
    fallback: DialectTargetTone[],
    heuristic: DialectTargetTone[],
  ): DialectTargetTone[] {
    const modelWeight = this.rankWeights(model);
    const fallbackWeight = this.rankWeights(fallback);
    const heuristicWeight = this.rankWeights(heuristic);

    const scored = [...TONE_BASE_ORDER]
      .map((tone) => ({
        tone,
        score:
          (modelWeight.get(tone) ?? 0) * 0.45 +
          (heuristicWeight.get(tone) ?? 0) * 0.4 +
          (fallbackWeight.get(tone) ?? 0) * 0.15,
      }))
      .sort((a, b) => b.score - a.score)
      .map((item) => item.tone);

    return this.ensureDistinct(scored, TONE_BASE_ORDER);
  }

  private rankWeights<T extends string>(items: T[]): Map<T, number> {
    const map = new Map<T, number>();
    const max = items.length;
    items.forEach((item, index) => {
      if (!map.has(item)) map.set(item, max - index);
    });
    return map;
  }

  private ensureDistinct<T extends string>(primary: T[], defaults: T[]): T[] {
    const seen = new Set<T>();
    const out: T[] = [];

    for (const item of primary) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
    for (const item of defaults) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }

    return out;
  }

  private isOutputCompliant(
    output: string,
    targetLanguage: DialectTargetLanguage,
  ): boolean {
    const lower = output.toLowerCase();

    if (targetLanguage === 'english') {
      return !this.containsAnyToken(lower, CODEMIX_FORBIDDEN_IN_ENGLISH);
    }

    if (targetLanguage === 'singlish') {
      return !this.containsAnyToken(lower, TANGLISH_FORBIDDEN_IN_SINGLISH);
    }

    return !this.containsAnyToken(lower, SINGLISH_FORBIDDEN_IN_TANGLISH);
  }

  private containsAnyToken(text: string, tokens: string[]): boolean {
    for (const token of tokens) {
      const re = new RegExp(`\\b${token}\\b`, 'i');
      if (re.test(text)) return true;
    }
    return false;
  }
}
