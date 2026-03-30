import * as fs from 'fs';

import { ConfigService } from '@nestjs/config';

import {
  TranslationService,
  type SupportedLanguage,
  type Translations,
} from './translation.service';

const mockInvoke = jest.fn();
const mockWithStructuredOutput = jest.fn(() => ({
  invoke: mockInvoke,
}));

jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    withStructuredOutput: mockWithStructuredOutput,
  })),
}));

describe('TranslationService.generateTranslatedAudioFiles', () => {
  const baseTranslations: Translations = {
    english: 'Hello from LinkLanka',
    singlish: 'Ado machan kohomada',
    tanglish: 'Machan epdi iruka',
  };

  let mkdirSpy: jest.SpiedFunction<typeof fs.promises.mkdir>;
  let writeFileSpy: jest.SpiedFunction<typeof fs.promises.writeFile>;

  beforeEach(() => {
    mockInvoke.mockReset();
    mockWithStructuredOutput.mockClear();

    mkdirSpy = jest
      .spyOn(fs.promises, 'mkdir')
      .mockResolvedValue(undefined as unknown as string);
    writeFileSpy = jest
      .spyOn(fs.promises, 'writeFile')
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    mkdirSpy.mockRestore();
    writeFileSpy.mockRestore();
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

    return new TranslationService(configService);
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
    expect(output.english).toContain('/uploads/tts-english-');
    expect(output.singlish).toContain('/uploads/tts-singlish-');
    expect(output.tanglish).toBeUndefined();
    expect(writeFileSpy).toHaveBeenCalledTimes(2);
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
});
