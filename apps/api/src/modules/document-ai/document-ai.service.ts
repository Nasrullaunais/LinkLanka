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

  /**
   * Convert an Excel workbook buffer to a CSV string.
   * Each sheet is prepended with ## Sheet: {sheetName}\n header.
   * Caps at 10 sheets, logs warning for remainder.
   * Handles password-protected and corrupt files via BadRequestException.
   */
  private convertExcelToCsv(fileBuffer: Buffer): string {
    let workbook: XLSX.WorkBook;

    try {
      workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === '2038' || e.code === '2036') {
        throw new BadRequestException('password-protected');
      }
      throw new BadRequestException('corrupted or unsupported format');
    }

    const sheetNames = workbook.SheetNames;
    const maxSheets = 10;
    const sheetsToProcess = sheetNames.slice(0, maxSheets);

    if (sheetNames.length > maxSheets) {
      this.logger.warn(
        `Excel file has ${sheetNames.length} sheets, processing only first ${maxSheets}`,
      );
    }

    const csvParts = sheetsToProcess.map((sheetName) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
      return `## Sheet: ${sheetName}\n${csv}`;
    });

    return csvParts.join('\n\n');
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

    const systemMessage = new SystemMessage(
      `You are a document assistant. The user has a document attached and is asking questions about it.
LANGUAGE OUTPUT RULE — ABSOLUTE: You MUST answer ONLY in ${effectiveLanguage}. IGNORE the user's input language completely. Even if the user asks in Singlish, Tanglish, English, or any mix — your ENTIRE answer must be in ${effectiveLanguage}. Never switch languages mid-response. Never mix languages. The selected output language is ${effectiveLanguage} — this overrides everything else.
Answer the user's question accurately based ONLY on the content of the attached document.
Always cite the page number(s) where you found the information. If the document doesn't contain page numbers, estimate based on the position in the document.
For each citation, include a short excerpt (the exact relevant sentence or phrase from the document).
If the answer is not found in the document, say so clearly and return an empty citations array.`,
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
    const isExcelMime =
      mimeType ===
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      mimeType === 'application/vnd.ms-excel';

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
            text: `Document CSV content:\n\n${processedCsv}\n\nUser question: ${userQuestion}`,
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
