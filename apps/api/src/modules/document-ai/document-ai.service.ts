import * as fs from 'fs';
import * as path from 'path';

import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class DocumentAiService {
  private readonly model: ChatGoogleGenerativeAI;

  constructor(
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    private readonly configService: ConfigService,
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

  /** Resolve the server file URL stored in rawContent to a local disk path. */
  private resolveLocalPath(fileUrl: string): string {
    const fileName = fileUrl.split('/').pop()!;
    return path.join(process.cwd(), 'uploads', fileName);
  }

  /** Guess the MIME type from the file extension. */
  private guessMime(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
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
    };
    return map[ext] ?? 'application/octet-stream';
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  async getSummary(messageId: string): Promise<SummaryBullet[]> {
    const message = await this.getDocumentMessage(messageId);

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
  ): Promise<QAResponse> {
    const message = await this.getDocumentMessage(messageId);

    const localPath = this.resolveLocalPath(message.rawContent);

    // Read the file as base64 to send as multipart media to Gemini
    const base64String = await fs.promises.readFile(localPath, {
      encoding: 'base64',
    });
    const mimeType = this.guessMime(localPath);

    const structuredModel = this.model.withStructuredOutput(QAResponseSchema);

    const systemMessage = new SystemMessage(
      `You are a document assistant. The user has a document attached and is asking questions about it.
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

    // Final human message: text question + the document as media
    const finalHumanMessage = new HumanMessage({
      content: [
        { type: 'text', text: userQuestion },
        { type: 'media', mimeType, data: base64String },
      ],
    });

    return structuredModel.invoke([
      systemMessage,
      ...historyMessages,
      finalHumanMessage,
    ]);
  }
}
