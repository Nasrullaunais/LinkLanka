import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';

import { S3StorageService } from '../../core/common/storage/s3-storage.service';

// These must stay as value-import for their mock modules (not entity-related)
// so bun processes them before the entity chain loads.
import * as XLSX from 'xlsx';

// Use var so the variable is hoisted (initialized as undefined) before
// jest.mock factory runs. The closure captures the mutable binding.
var mockInvoke: jest.Mock;

// ─── Module-level mocks ───────────────────────────────────────────────
// jest.mock calls are NOT hoisted by bun (unlike real Jest), so they
// execute in source order. The require() at the bottom runs AFTER all
// mocks are registered, so transitive imports resolve through mocks.

jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    withStructuredOutput: jest.fn(() => ({ invoke: mockInvoke })),
  })),
}));

jest.mock('xlsx', () => ({
  read: jest.fn(),
  utils: {
    sheet_to_csv: jest.fn(),
  },
}));

jest.mock('../chat/entities/message.entity', () => ({
  MessageContentType: {
    TEXT: 'TEXT',
    AUDIO: 'AUDIO',
    IMAGE: 'IMAGE',
    DOCUMENT: 'DOCUMENT',
  },
  Message: class {},
}));

jest.mock('../translation/translation.service', () => ({}));

// Load DocumentAiService via require() (NOT import) so the mocks above
// are registered before bun resolves the transitive dependency chain:
//   document-ai.service.ts → message.entity.ts → translation.service.ts
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DocumentAiService } = require('./document-ai.service');

// ─── Local types ──────────────────────────────────────────────────────

enum MockContentType {
  TEXT = 'TEXT',
  AUDIO = 'AUDIO',
  IMAGE = 'IMAGE',
  DOCUMENT = 'DOCUMENT',
}

interface MockMessage {
  id: string;
  contentType: MockContentType;
  rawContent: string;
  summary: { text: string; page: number | null }[] | null;
  transcription: string | null;
  detectedLanguage: string | null;
}

// ─── Tests ────────────────────────────────────────────────────────────

describe('DocumentAiService', () => {
  let mockRead: jest.Mock;
  let mockSheetToCsv: jest.Mock;
  let mockMessageRepo: jest.Mocked<Partial<Repository<MockMessage>>>;
  let mockS3StorageService: jest.Mocked<Partial<S3StorageService>>;
  let mockConfigService: jest.Mocked<Partial<ConfigService>>;

  function createService(): DocumentAiService {
    return new DocumentAiService(
      mockMessageRepo as Repository<MockMessage>,
      mockConfigService as ConfigService,
      mockS3StorageService as S3StorageService,
    );
  }

  beforeEach(() => {
    mockInvoke = jest.fn();
    mockRead = (XLSX as any).read as jest.Mock;
    mockSheetToCsv = (XLSX as any).utils.sheet_to_csv as jest.Mock;
    mockRead.mockReset();
    mockSheetToCsv.mockReset();

    mockMessageRepo = {
      findOne: jest.fn(),
      save: jest.fn(),
    };

    mockS3StorageService = {
      downloadBufferFromUrl: jest.fn(),
    };

    mockConfigService = {
      getOrThrow: jest.fn().mockReturnValue('fake-gemini-key'),
    } as unknown as jest.Mocked<Partial<ConfigService>>;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('convertExcelToCsv', () => {
    it('returns CSV with ## Sheet: header for single-sheet workbook', () => {
      mockRead.mockReturnValueOnce({
        SheetNames: ['Sheet1'],
        Sheets: { Sheet1: {} },
      });
      mockSheetToCsv.mockReturnValueOnce('a,b\n1,2');

      const service = createService();
      const result = (service as any).convertExcelToCsv(Buffer.from('x'));

      expect(result).toBe('## Sheet: Sheet1\na,b\n1,2');
      expect(mockSheetToCsv).toHaveBeenCalledTimes(1);
    });

    it('concatenates CSVs for multi-sheet workbook', () => {
      mockRead.mockReturnValueOnce({
        SheetNames: ['Sheet1', 'Sheet2'],
        Sheets: { Sheet1: {}, Sheet2: {} },
      });
      mockSheetToCsv
        .mockReturnValueOnce('a,b\n1,2')
        .mockReturnValueOnce('c,d\n3,4');

      const service = createService();
      const result = (service as any).convertExcelToCsv(Buffer.from('x'));

      expect(result).toBe(
        '## Sheet: Sheet1\na,b\n1,2\n\n## Sheet: Sheet2\nc,d\n3,4',
      );
      expect(mockSheetToCsv).toHaveBeenCalledTimes(2);
    });

    it('caps at 10 sheets and logs warning for remainder', () => {
      const sheetNames = Array.from({ length: 12 }, (_, i) => `Sheet${i + 1}`);
      const sheets: Record<string, object> = {};
      sheetNames.forEach((name) => {
        sheets[name] = {};
      });
      mockRead.mockReturnValueOnce({ SheetNames: sheetNames, Sheets: sheets });
      mockSheetToCsv.mockReturnValue('x');

      const service = createService();
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => {});

      const result = (service as any).convertExcelToCsv(Buffer.from('x'));

      const sheetCount = (result.match(/## Sheet:/g) || []).length;
      expect(sheetCount).toBe(10);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('12 sheets'),
      );

      warnSpy.mockRestore();
    });

    it('throws BadRequestException for password-protected file', () => {
      mockRead.mockImplementationOnce(() => {
        const err = new Error('password');
        (err as any).code = '2038';
        throw err;
      });

      const service = createService();
      expect(() =>
        (service as any).convertExcelToCsv(Buffer.from('x')),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException for corrupt file', () => {
      mockRead.mockImplementationOnce(() => {
        const err = new Error('corrupt');
        (err as any).code = '2036';
        throw err;
      });

      const service = createService();
      expect(() =>
        (service as any).convertExcelToCsv(Buffer.from('x')),
      ).toThrow(BadRequestException);
    });
  });

  describe('askQuestion', () => {
    const xlMessage: MockMessage = {
      id: 'msg-xl',
      contentType: MockContentType.DOCUMENT,
      rawContent: 'https://example.com/report.xlsx',
      summary: null,
      transcription: null,
      detectedLanguage: 'english',
    };

    const pdfMessage: MockMessage = {
      id: 'msg-pdf',
      contentType: MockContentType.DOCUMENT,
      rawContent: 'https://example.com/doc.pdf',
      summary: null,
      transcription: null,
      detectedLanguage: 'english',
    };

    beforeEach(() => {
      mockRead.mockReturnValue({
        SheetNames: ['Data'],
        Sheets: { Data: {} },
      });
      mockSheetToCsv.mockReturnValue('col1,col2\nv1,v2');
      mockInvoke.mockResolvedValue({
        answer: 'Some answer',
        citations: [{ page: 1, excerpt: 'relevant text' }],
      });
    });

    it('sends CSV as text content for Excel files', async () => {
      mockMessageRepo.findOne!.mockResolvedValue(xlMessage);
      mockS3StorageService.downloadBufferFromUrl!.mockResolvedValue(
        Buffer.from('excel-bytes'),
      );

      const service = createService();
      await service.askQuestion('msg-xl', 'What is this?', []);

      const messages = mockInvoke.mock.calls[0][0];
      const humanMessage = messages[messages.length - 1];
      const content = (humanMessage as any).content;
      expect(Array.isArray(content)).toBe(true);
      expect(content[0].type).toBe('text');
      expect(content[0].text).toContain('Document CSV content:');
      expect(content[0].text).toContain('## Sheet: Data');
      expect(content[0].text).toContain('User question: What is this?');
    });

    it('sends base64 media for non-Excel files', async () => {
      mockMessageRepo.findOne!.mockResolvedValue(pdfMessage);
      mockS3StorageService.downloadBufferFromUrl!.mockResolvedValue(
        Buffer.from('pdf-bytes'),
      );

      const service = createService();
      await service.askQuestion('msg-pdf', 'What is this?', []);

      const messages = mockInvoke.mock.calls[0][0];
      const humanMessage = messages[messages.length - 1];
      const content = (humanMessage as any).content;
      expect(Array.isArray(content)).toBe(true);
      expect(content.length).toBe(2);
      expect(content[0].type).toBe('text');
      expect(content[0].text).toBe('What is this?');
      expect(content[1].type).toBe('media');
      expect(content[1].mimeType).toBe('application/pdf');
      expect(typeof content[1].data).toBe('string');
      expect(content[1].data.length).toBeGreaterThan(0);
    });

    it('truncates CSV at 100K chars and appends note', async () => {
      const longCsv = 'col\n' + 'x\n'.repeat(60000);
      mockSheetToCsv.mockReset();
      mockSheetToCsv.mockReturnValue(longCsv);

      mockMessageRepo.findOne!.mockResolvedValue(xlMessage);
      mockS3StorageService.downloadBufferFromUrl!.mockResolvedValue(
        Buffer.from('excel-bytes'),
      );

      const service = createService();
      await service.askQuestion('msg-xl', 'What?', []);

      const messages = mockInvoke.mock.calls[0][0];
      const humanMessage = messages[messages.length - 1];
      const text = (humanMessage as any).content[0].text;

      expect(text).toContain(
        '[Note: CSV truncated at 100,000 characters',
      );
    });

    it('logs warning for CSV over 50K chars (no truncation)', async () => {
      const mediumCsv = 'col\n' + 'x\n'.repeat(30000);
      mockSheetToCsv.mockReset();
      mockSheetToCsv.mockReturnValue(mediumCsv);

      mockMessageRepo.findOne!.mockResolvedValue(xlMessage);
      mockS3StorageService.downloadBufferFromUrl!.mockResolvedValue(
        Buffer.from('excel-bytes'),
      );

      const service = createService();
      const warnSpy = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => {});
      await service.askQuestion('msg-xl', 'What?', []);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/Excel CSV is \d+ chars/),
      );
      warnSpy.mockRestore();
    });

    it('throws BadRequestException when message is not a document', async () => {
      mockMessageRepo.findOne!.mockResolvedValue({
        id: 'msg-text',
        contentType: MockContentType.TEXT,
        rawContent: 'hello',
      });

      const service = createService();
      await expect(
        service.askQuestion('msg-text', 'What?', []),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getSummary', () => {
    it('throws BadRequestException for Excel files', async () => {
      const xlMessage: MockMessage = {
        id: 'msg-xl',
        contentType: MockContentType.DOCUMENT,
        rawContent: 'https://example.com/data.xlsx',
        summary: null,
        transcription: 'some text',
      };
      mockMessageRepo.findOne!.mockResolvedValue(xlMessage);

      const service = createService();
      await expect(service.getSummary('msg-xl')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException for .xls files', async () => {
      const xlsMessage: MockMessage = {
        id: 'msg-xls',
        contentType: MockContentType.DOCUMENT,
        rawContent: 'https://example.com/old-spreadsheet.xls',
        summary: null,
        transcription: 'some text',
      };
      mockMessageRepo.findOne!.mockResolvedValue(xlsMessage);

      const service = createService();
      await expect(service.getSummary('msg-xls')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('proceeds normally for PDF files', async () => {
      const pdfMessage: MockMessage = {
        id: 'msg-pdf',
        contentType: MockContentType.DOCUMENT,
        rawContent: 'https://example.com/doc.pdf',
        summary: null,
        transcription: 'PDF text content for testing',
      };
      mockMessageRepo.findOne!.mockResolvedValue(pdfMessage);
      mockInvoke.mockResolvedValueOnce({
        bullets: [
          { text: 'First point about the doc', page: 1 },
          { text: 'Second important finding', page: 2 },
          { text: 'Third key takeaway', page: null },
        ],
      });
      (mockMessageRepo.save as jest.Mock).mockResolvedValue(pdfMessage);

      const service = createService();
      const result = await service.getSummary('msg-pdf');

      expect(result).toEqual([
        { text: 'First point about the doc', page: 1 },
        { text: 'Second important finding', page: 2 },
        { text: 'Third key takeaway', page: null },
      ]);
      expect(pdfMessage.summary).toEqual(result);
      expect(mockMessageRepo.save).toHaveBeenCalled();
    });
  });

  describe('system prompt language enforcement', () => {
    it('contains LANGUAGE OUTPUT RULE with effectiveLanguage', async () => {
      const message: MockMessage = {
        id: 'msg-1',
        contentType: MockContentType.DOCUMENT,
        rawContent: 'https://example.com/doc.pdf',
        summary: null,
        transcription: null,
        detectedLanguage: 'tanglish',
      };
      mockMessageRepo.findOne!.mockResolvedValue(message);
      mockS3StorageService.downloadBufferFromUrl!.mockResolvedValue(
        Buffer.from('content'),
      );
      mockInvoke.mockResolvedValue({ answer: 'test', citations: [] });

      const service = createService();
      await service.askQuestion('msg-1', 'Question?', []);

      const messages = mockInvoke.mock.calls[0][0];
      const systemMsg = messages[0];
      expect((systemMsg as any).content).toContain('LANGUAGE OUTPUT RULE');
      expect((systemMsg as any).content).toContain('answer ONLY in tanglish');
    });
  });

  describe('resolvePreferredQALanguage', () => {
    it('uses preferredLanguage when provided', async () => {
      const message: MockMessage = {
        id: 'msg-1',
        contentType: MockContentType.DOCUMENT,
        rawContent: 'https://example.com/doc.pdf',
        summary: null,
        transcription: null,
        detectedLanguage: 'english',
      };
      mockMessageRepo.findOne!.mockResolvedValue(message);
      mockS3StorageService.downloadBufferFromUrl!.mockResolvedValue(
        Buffer.from('content'),
      );
      mockInvoke.mockResolvedValue({ answer: 'test', citations: [] });

      const service = createService();
      await service.askQuestion('msg-1', 'Question?', [], 'singlish');

      const messages = mockInvoke.mock.calls[0][0];
      const systemMsg = messages[0];
      expect((systemMsg as any).content).toContain(
        'answer ONLY in singlish',
      );
    });

    it('falls back to detectedLanguage when no preference', async () => {
      const message: MockMessage = {
        id: 'msg-1',
        contentType: MockContentType.DOCUMENT,
        rawContent: 'https://example.com/doc.pdf',
        summary: null,
        transcription: null,
        detectedLanguage: 'tanglish',
      };
      mockMessageRepo.findOne!.mockResolvedValue(message);
      mockS3StorageService.downloadBufferFromUrl!.mockResolvedValue(
        Buffer.from('content'),
      );
      mockInvoke.mockResolvedValue({ answer: 'test', citations: [] });

      const service = createService();
      await service.askQuestion('msg-1', 'Question?', []);

      const messages = mockInvoke.mock.calls[0][0];
      const systemMsg = messages[0];
      expect((systemMsg as any).content).toContain(
        'answer ONLY in tanglish',
      );
    });
  });
});
