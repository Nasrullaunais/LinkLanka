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

  function createService(options?: {
    ttsMaxConcurrency?: string;
    mandatoryEnglishRetries?: string;
    dominantLanguageLowConfidenceThreshold?: string;
  }): TranslationService {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('fake-gemini-key'),
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'TTS_MAX_CONCURRENCY') return options?.ttsMaxConcurrency;
        if (key === 'TTS_MANDATORY_ENGLISH_RETRIES') {
          return options?.mandatoryEnglishRetries;
        }
        if (key === 'DOMINANT_LANGUAGE_LOW_CONFIDENCE_THRESHOLD') {
          return options?.dominantLanguageLowConfidenceThreshold;
        }
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
    const service = createService({ ttsMaxConcurrency: '2' });

    const generateSpeechSpy = jest
      .spyOn(service as any, 'generateSpeechWav')
      .mockImplementation((params: unknown): Promise<Buffer> => {
        const language = (params as { language?: SupportedLanguage }).language;
        if (language === 'tanglish') {
          throw new Error('simulated provider failure');
        }
        return Promise.resolve(Buffer.from('pcm-bytes'));
      });

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
    const service = createService({ ttsMaxConcurrency: '2' });

    let active = 0;
    let maxActive = 0;

    const generateSpeechSpy = jest
      .spyOn(service as any, 'generateSpeechWav')
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
    const service = createService({ ttsMaxConcurrency: 'invalid' });

    let active = 0;
    let maxActive = 0;

    jest
      .spyOn(service as any, 'generateSpeechWav')
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

  it('arbitrates to singlish when singlish cues dominate with english words', async () => {
    const service = createService();

    mockInvoke.mockResolvedValueOnce({
      transcription: 'Machan can we do this now hari, api yamu',
      translations: {
        english: 'Machan, can we do this now? Let us go.',
        singlish: 'Machan dan meka karamu hari, api yamu',
        tanglish: 'Machi ippo idha pannalama, seri polaam',
      },
      detectedLanguage: 'mixed',
      originalTone: 'casual',
      confidenceScore: 91,
      extractedActions: [],
    });

    const result = await service.translateIntent({
      rawText: 'Machan can we do this now hari, api yamu',
      chatHistory: [],
      userDictionary: '',
    });

    expect(result.detectedLanguage).toBe('singlish');
  });

  it('falls back to mixed when detection confidence is low', async () => {
    const service = createService();

    mockInvoke.mockResolvedValueOnce({
      transcription: 'Machan lets meet tomorrow hari',
      translations: {
        english: 'Machan, let us meet tomorrow.',
        singlish: 'Machan heta hambemu hari',
        tanglish: 'Machi nalaikku sandhippom seri',
      },
      detectedLanguage: 'singlish',
      originalTone: 'neutral',
      confidenceScore: 42,
      extractedActions: [],
    });

    const result = await service.translateIntent({
      rawText: 'Machan lets meet tomorrow hari',
      chatHistory: [],
      userDictionary: '',
    });

    expect(result.detectedLanguage).toBe('mixed');
  });

  it('routes singlish dominant audio generation to english and tanglish only', async () => {
    const service = createService({ ttsMaxConcurrency: '1' });

    const generateSpeechSpy = jest
      .spyOn(service as any, 'generateSpeechWav')
      .mockResolvedValue(Buffer.from('pcm-bytes'));

    const output = await service.generateTranslatedAudioFiles({
      translations: baseTranslations,
      detectedLanguage: 'singlish',
      originalTone: 'neutral',
    });

    expect(Object.keys(output).sort()).toEqual(['english', 'tanglish']);

    const requestedLanguages = generateSpeechSpy.mock.calls
      .map((call) => (call[0] as { language: SupportedLanguage }).language)
      .sort();

    expect(requestedLanguages).toEqual(['english', 'tanglish']);
  });

  it('retries english generation when english is mandatory', async () => {
    const service = createService({
      ttsMaxConcurrency: '1',
      mandatoryEnglishRetries: '2',
    });

    let englishAttempts = 0;

    const generateSpeechSpy = jest
      .spyOn(service as any, 'generateSpeechWav')
      .mockImplementation((params: unknown): Promise<Buffer> => {
        const language = (params as { language?: SupportedLanguage }).language;
        if (language === 'english') {
          englishAttempts += 1;
          if (englishAttempts === 1) {
            throw new Error('temporary tts failure');
          }
        }

        return Promise.resolve(Buffer.from('pcm-bytes'));
      });

    const output = await service.generateTranslatedAudioFiles({
      translations: baseTranslations,
      detectedLanguage: 'tanglish',
      originalTone: 'neutral',
    });

    expect(englishAttempts).toBe(2);
    expect(output.english).toBeDefined();
    expect(output.singlish).toBeDefined();
    expect(output.tanglish).toBeUndefined();
    expect(generateSpeechSpy).toHaveBeenCalled();
  });
});
