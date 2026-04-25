import * as path from 'path';

import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import * as XLSX from 'xlsx';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { z } from 'zod';

import { Message, MessageContentType } from '../chat/entities/message.entity';
import { S3StorageService } from '../../core/common/storage/s3-storage.service';
import {
  convertExcelToCsv,
  isExcelMimeType,
} from '../../core/common/converters/excel-to-csv.converter';

// ── Zod schemas ──────────────────────────────────────────────────────────────

const SummaryBulletSchema = z.object({
  text: z.string(),
  page: z.number().nullable(),
});

const SummaryResponseSchema = z.object({
  bullets: z.array(SummaryBulletSchema).length(3),
});

const QAResponseSchema = z.object({
  answer: z.string(),
  citations: z.array(
    z.object({
      page: z.number(),
      excerpt: z.string(),
    }),
  ),
});

// ── Exported types ───────────────────────────────────────────────────────────

export type SummaryBullet = z.infer<typeof SummaryBulletSchema>;
export type SummaryResponse = z.infer<typeof SummaryResponseSchema>;
export type QAResponse = z.infer<typeof QAResponseSchema>;

export interface QAChatTurn {
  role: 'user' | 'ai';
  text: string;
}

export type PreferredQALanguage = 'english' | 'singlish' | 'tanglish';

function resolvePreferredQALanguage(
  preferredLanguage: PreferredQALanguage | undefined,
  detectedLanguage: Message['detectedLanguage'],
): PreferredQALanguage {
  if (preferredLanguage) {
    return preferredLanguage;
  }

  if (
    detectedLanguage === 'english' ||
    detectedLanguage === 'singlish' ||
    detectedLanguage === 'tanglish'
  ) {
    return detectedLanguage;
  }

  return 'english';
}

function getQALanguageInstruction(language: PreferredQALanguage): string {
  switch (language) {
    case 'english':
      return `- You are speaking in STANDARD ENGLISH. Use grammatically correct, natural English. Do NOT use any Singlish or Tanglish words or particles.`;

    case 'singlish':
      return `- You are speaking in SRI LANKAN SINGLISH — this is SINHALA words written in English characters, code-mixed with English.
- This is NOT Singaporean English. It is Sri Lankan Sinhala-English code-mixing.
- Use Singlish words naturally.
- Mix English and Sinhala freely in the same sentence.
- reflect the tone of the user.
- Example sentence style: "me docuemnt eka semester 2 time table eka. "`;

    case 'tanglish':
      return `- You are speaking in SRI LANKAN TANGLISH — this is TAMIL words written in English characters, code-mixed with English.
- Use Tanglish words naturally.
- Mix English and Tamil freely in the same sentence.
- reflect the tone of the user.
- Example sentence style: "indha document la ungalda project description irukki"`;
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class DocumentAiService {
  private readonly model: ChatGoogleGenerativeAI;
  private readonly logger = new Logger(DocumentAiService.name);

  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    private readonly configService: ConfigService,
    private readonly s3StorageService: S3StorageService,
  ) {
    this.model = new ChatGoogleGenerativeAI({
      apiKey: this.configService.getOrThrow<string>('GEMINI_API_KEY'),
      model: 'gemini-3-flash-preview',
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async getDocumentMessage(messageId: string): Promise<Message> {
    const message = await this.messageRepo.findOne({
      where: { id: messageId },
    });
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    if (message.contentType !== MessageContentType.DOCUMENT) {
      throw new BadRequestException('Message is not a document');
    }
    return message;
  }

  /** Resolve the stored message raw content to a document URL. */
  private resolveDocumentUrl(rawContent: string): string {
    const trimmed = rawContent.trim();

    try {
      const parsed = JSON.parse(trimmed) as { url?: unknown };
      if (typeof parsed.url === 'string' && parsed.url.trim()) {
        return parsed.url.trim();
      }
    } catch {
      // Document messages are usually stored as plain URL strings.
    }

    return trimmed;
  }

  /** Guess the MIME type from the file extension. */
  private guessMime(fileReference: string): string {
    let extSource = fileReference;

    try {
      extSource = new URL(fileReference).pathname;
    } catch {
      // Keep raw string for non-URL references.
    }

    const ext = path.extname(extSource).toLowerCase();
    const map: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.doc': 'application/msword',
      '.docx':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt': 'text/plain',
      '.xlsx':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.xls': 'application/vnd.ms-excel',
    };
    return map[ext] ?? 'application/octet-stream';
  }

  private convertExcelToCsv(fileBuffer: Buffer): string {
    try {
      return convertExcelToCsv(fileBuffer);
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException('corrupted or unsupported format');
    }
  }

  // ── CSV export (spreadsheet preview) ─────────────────────────────────────

  async getCsvContent(messageId: string): Promise<{
    csv: string;
    sheetNames: string[];
  }> {
    const message = await this.getDocumentMessage(messageId);
    const documentUrl = this.resolveDocumentUrl(message.rawContent);
    const fileBuffer =
      await this.s3StorageService.downloadBufferFromUrl(documentUrl);

    const mime = this.guessMime(documentUrl);
    if (!isExcelMimeType(mime)) {
      throw new BadRequestException(
        'CSV export is only available for spreadsheet files',
      );
    }

    const csv = this.convertExcelToCsv(fileBuffer);

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException('Failed to parse spreadsheet');
    }

    return {
      csv,
      sheetNames: workbook.SheetNames.slice(0, 10),
    };
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  async getSummary(messageId: string): Promise<SummaryBullet[]> {
    const message = await this.getDocumentMessage(messageId);

    // Reject Excel/spreadsheet files — summaries require text content
    const mime = this.guessMime(this.resolveDocumentUrl(message.rawContent));
    if (
      mime ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mime === 'application/vnd.ms-excel'
    ) {
      throw new BadRequestException(
        'Summaries are not available for spreadsheet files. Use Q&A to ask questions about specific data.',
      );
    }

    // Return cached summary if available
    if (
      Array.isArray(message.summary) &&
      (message.summary as SummaryBullet[]).length > 0
    ) {
      return message.summary as SummaryBullet[];
    }

    // We need the transcription (OCR text) to summarize
    const textToSummarize = message.transcription;
    if (!textToSummarize || textToSummarize.trim().length === 0) {
      throw new BadRequestException(
        'No text content available for this document. The OCR may have failed.',
      );
    }

    const structuredModel = this.model.withStructuredOutput(
      SummaryResponseSchema,
    );

    const systemMessage = new SystemMessage(
      `You are a document summarization assistant. Summarize the provided document text into exactly 3 concise, informative bullet points.
For each bullet point, include the page number where the key information is found. If the document text does not contain page markers, set page to null.
Each bullet should capture a distinct key point — avoid redundancy. Keep each bullet under 40 words.`,
    );

    const humanMessage = new HumanMessage(
      `Summarize this document:\n\n${textToSummarize}`,
    );

    const result = await structuredModel.invoke([systemMessage, humanMessage]);

    // Cache in the database
    message.summary = result.bullets;
    await this.messageRepo.save(message);

    return result.bullets;
  }

  // ── Document Q&A ─────────────────────────────────────────────────────────

  async askQuestion(
    messageId: string,
    userQuestion: string,
    chatHistory: QAChatTurn[],
    preferredLanguage?: PreferredQALanguage,
  ): Promise<QAResponse> {
    const message = await this.getDocumentMessage(messageId);
    const effectiveLanguage = resolvePreferredQALanguage(
      preferredLanguage,
      message.detectedLanguage,
    );

    const documentUrl = this.resolveDocumentUrl(message.rawContent);
    const fileBuffer =
      await this.s3StorageService.downloadBufferFromUrl(documentUrl);

    const structuredModel = this.model.withStructuredOutput(QAResponseSchema);

    const languageInstruction = getQALanguageInstruction(effectiveLanguage);

    const systemMessage = new SystemMessage(
      `You are a document assistant. Answer the user's questions about their attached document.

When answering:
- Base your answer ONLY on the document content.
- Cite page numbers (or estimate position) and include short excerpts.
- If the information is not in the document, say so clearly and return empty citations.

╔══════════════════════════════════════════════════════════════╗
║  OUTPUT LANGUAGE: ${effectiveLanguage.toUpperCase()}
║  ═══════════════════════════════════════════════════════════
║  This is a HARD CONSTRAINT. Your entire answer MUST be
║  in ${effectiveLanguage}. This overrides everything else.
║
║  DO NOT match the user's input language.
║  DO NOT switch languages mid-response.
║  DO NOT mix languages.
║  Even if the user writes in another language,
║  you STILL answer in ${effectiveLanguage}.
║
║  LANGUAGE DEFINITION:
${languageInstruction.split('\n').map((l) => `║  ${l}`).join('\n')}
║
║  VIOLATING THIS RULE IS A CRITICAL ERROR.
╚══════════════════════════════════════════════════════════════╝`,
    );

    // Build conversation history
    const historyMessages: Array<HumanMessage | AIMessage> = chatHistory.map(
      (turn) =>
        turn.role === 'user'
          ? new HumanMessage(turn.text)
          : new AIMessage(turn.text),
    );

    // Determine content type and build the final human message
    const mimeType = this.guessMime(documentUrl);
    const isExcelMime = isExcelMimeType(mimeType);

    let finalHumanMessage: HumanMessage;

    if (isExcelMime) {
      // Excel → convert to CSV and send as plain text
      const csvText = this.convertExcelToCsv(fileBuffer);

      // Apply length guards
      const MAX_CSV_LENGTH = 100000;
      const WARN_CSV_LENGTH = 50000;
      let processedCsv = csvText;
      if (csvText.length > MAX_CSV_LENGTH) {
        processedCsv =
          csvText.substring(0, MAX_CSV_LENGTH) +
          '\n\n[Note: CSV truncated at 100,000 characters. Ask about specific sections if needed.]';
      } else if (csvText.length > WARN_CSV_LENGTH) {
        this.logger.warn(
          `Excel CSV is ${csvText.length} chars, may be large for Gemini`,
        );
      }

      finalHumanMessage = new HumanMessage({
        content: [
          {
            type: 'text',
            text: `Document CSV content:\n\n${processedCsv}\n\nUser question: ${userQuestion}\n\n[Reply in ${effectiveLanguage} only — do not match my language]`,
          },
        ],
      });
    } else {
      // Non-Excel → read as base64 and send as multipart media
      const base64String = fileBuffer.toString('base64');
      finalHumanMessage = new HumanMessage({
        content: [
          { type: 'text', text: userQuestion },
          { type: 'media', mimeType, data: base64String },
          {
            type: 'text',
            text: `[Reply in ${effectiveLanguage} only — do not match my language]`,
          },
        ],
      });
    }

    return structuredModel.invoke([
      systemMessage,
      ...historyMessages,
      finalHumanMessage,
    ]);
  }
}
