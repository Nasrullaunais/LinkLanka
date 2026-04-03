import { ConfigService } from '@nestjs/config';

import {
  TranslationService,
  type SupportedLanguage,
  type Translations,
} from './translation.service';
import { S3StorageService } from '../../core/common/storage/s3-storage.service';

const mockInvoke = jest.fn();
const mockWithStructuredOutput = jest.fn(() => ({
  invoke: mockInvoke,
}));

jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    withStructuredOutput: mockWithStructuredOutput,
  })),
}));

describe('TranslationService', () => {
  const baseTranslations: Translations = {
    english: 'Hello from LinkLanka',
    singlish: 'Ado machan kohomada',
    tanglish: 'Machan epdi iruka',
  };

  let uploadBufferMock: jest.Mock;

  beforeEach(() => {
    mockInvoke.mockReset();
    mockWithStructuredOutput.mockClear();

    uploadBufferMock = jest
      .fn()
      .mockImplementation(
        ({ fileName }: { fileName: string }): { key: string; url: string } => ({
          key: `linklanka/tts/${fileName}`,
          url: `https://amzn-leo-bucket.s3.amazonaws.com/linklanka/tts/${fileName}`,
        }),
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createService(ttsMaxConcurrency?: string): TranslationService {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('fake-gemini-key'),
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'TTS_MAX_CONCURRENCY') return ttsMaxConcurrency;
        if (key === 'BASE_URL') return 'http://localhost:3000';
        return undefined;
      }),
    } as unknown as ConfigService;

    const s3StorageService = {
      uploadBuffer: uploadBufferMock,
    } as unknown as S3StorageService;

    return new TranslationService(configService, s3StorageService);
  }

  it('keeps partial successes when one language generation fails', async () => {
    const service = createService('2');

    const generateSpeechSpy = jest
      .spyOn(
        service as unknown as { generateSpeechWav: unknown },
        'generateSpeechWav' as never,
      )
      .mockImplementation(
        (params: { language: SupportedLanguage }): Promise<Buffer> => {
          if (params.language === 'tanglish') {
            throw new Error('simulated provider failure');
          }
          return Promise.resolve(Buffer.from('pcm-bytes'));
        },
      );

    const output = await service.generateTranslatedAudioFiles({
      translations: baseTranslations,
      detectedLanguage: 'unknown',
      originalTone: 'neutral',
    });

    expect(generateSpeechSpy).toHaveBeenCalledTimes(3);
    expect(Object.keys(output).sort()).toEqual(['english', 'singlish']);
    expect(output.english).toContain(
      'https://amzn-leo-bucket.s3.amazonaws.com/linklanka/tts/tts-english-',
    );
    expect(output.singlish).toContain(
      'https://amzn-leo-bucket.s3.amazonaws.com/linklanka/tts/tts-singlish-',
    );
    expect(output.tanglish).toBeUndefined();
    expect(uploadBufferMock).toHaveBeenCalledTimes(2);
  });

  it('honors TTS_MAX_CONCURRENCY cap while processing jobs', async () => {
    const service = createService('2');

    let active = 0;
    let maxActive = 0;

    const generateSpeechSpy = jest
      .spyOn(
        service as unknown as { generateSpeechWav: unknown },
        'generateSpeechWav' as never,
      )
      .mockImplementation(async (): Promise<Buffer> => {
        active += 1;
        if (active > maxActive) maxActive = active;

        await new Promise((resolve) => setTimeout(resolve, 25));

        active -= 1;
        return Buffer.from('pcm-bytes');
      });

    await service.generateTranslatedAudioFiles({
      translations: baseTranslations,
      detectedLanguage: 'unknown',
      originalTone: 'neutral',
    });

    expect(generateSpeechSpy).toHaveBeenCalledTimes(3);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThan(1);
  });

  it('falls back to safe default concurrency when env value is invalid', async () => {
    const service = createService('invalid');

    let active = 0;
    let maxActive = 0;

    jest
      .spyOn(
        service as unknown as { generateSpeechWav: unknown },
        'generateSpeechWav' as never,
      )
      .mockImplementation(async (): Promise<Buffer> => {
        active += 1;
        if (active > maxActive) maxActive = active;

        await new Promise((resolve) => setTimeout(resolve, 25));

        active -= 1;
        return Buffer.from('pcm-bytes');
      });

    await service.generateTranslatedAudioFiles({
      translations: baseTranslations,
      detectedLanguage: 'unknown',
      originalTone: 'neutral',
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(maxActive).toBeGreaterThan(1);
  });

  it('normalizes "Ado" to "Adei" in tanglish translation output', async () => {
    const service = createService();

    mockInvoke.mockResolvedValueOnce({
      transcription: 'Ado epdi iruka?',
      translations: {
        english: 'Dude, how are you?',
        singlish: 'Ado kohomada?',
        tanglish: 'Ado epdi iruka?',
      },
      detectedLanguage: 'singlish',
      originalTone: 'casual',
      confidenceScore: 92,
      extractedActions: [],
    });

    const result = await service.translateIntent({
      rawText: 'Ado epdi iruka?',
      chatHistory: [],
      userDictionary: '',
    });

    expect(result.translations.tanglish).toBe('Adei epdi iruka?');
  });
});
