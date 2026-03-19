import { ConfigService } from '@nestjs/config';

import { DialectService } from './dialect.service';

const mockInvoke = jest.fn();
const mockWithStructuredOutput = jest.fn(() => ({
  invoke: mockInvoke,
}));

jest.mock('@langchain/google-genai', () => ({
  ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    withStructuredOutput: mockWithStructuredOutput,
  })),
}));

describe('DialectService', () => {
  let service: DialectService;

  beforeEach(() => {
    mockInvoke.mockReset();
    mockWithStructuredOutput.mockClear();

    const configService = {
      getOrThrow: jest.fn().mockReturnValue('fake-gemini-key'),
    } as unknown as ConfigService;

    service = new DialectService(configService);
  });

  it('returns mixed-language fallback suggestions for code-mixed Singlish/Tanglish text when model fails', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('model unavailable'));

    const result = await service.suggestDialectOptions(
      'Machan enna da mokada poda nalla, api yamu',
    );

    expect(result.detectedLanguage).toBe('mixed');
    expect(result.suggestedTargetLanguages[0]).toBe('english');
    expect(result.suggestedTargetLanguages).toEqual(
      expect.arrayContaining(['singlish', 'tanglish']),
    );
    expect(result.reason?.toLowerCase()).toContain('code-mixed');
  });

  it('normalizes noisy model suggestions and keeps language list distinct', async () => {
    mockInvoke.mockResolvedValueOnce({
      detectedLanguage: 'english',
      detectedTone: 'neutral',
      confidence: 38,
      suggestedTargetLanguages: ['tanglish', 'tanglish', 'english'],
      suggestedTones: ['professional', 'professional'],
      reason: 'Model guess',
    });

    const result = await service.suggestDialectOptions(
      'Machan aney mokada hari kiyala update pls',
    );

    expect(new Set(result.suggestedTargetLanguages).size).toBe(3);
    expect(result.suggestedTargetLanguages).toEqual(
      expect.arrayContaining(['english', 'singlish', 'tanglish']),
    );
    expect(new Set(result.suggestedTones).size).toBe(2);
    expect(result.reason).toContain('Model guess');
  });

  it('returns fast fallback for very short input without invoking the model', async () => {
    const result = await service.suggestDialectOptions('yo');

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result.suggestedTargetLanguages).toEqual([
      'english',
      'singlish',
      'tanglish',
    ]);
  });

  it('refineTextV2 returns transformed text from model output', async () => {
    mockInvoke.mockResolvedValueOnce({
      refinedText: 'Please share the update by 4 PM.',
    });

    const result = await service.refineTextV2(
      'pls send update by 4',
      'english',
      'professional',
    );

    expect(result.refinedText).toBe('Please share the update by 4 PM.');
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    const calls = mockInvoke.mock.calls as unknown[][];
    const invokePayload = calls[0]?.[0] as Array<{
      content: unknown;
    }>;
    expect(Array.isArray(invokePayload)).toBe(true);
    expect(String(invokePayload[0].content)).toContain(
      'Rewrite the input according to the requested target language and target tone.',
    );
    expect(String(invokePayload[0].content)).toContain(
      'Target language instruction:',
    );
    expect(String(invokePayload[0].content)).toContain(
      'Target tone instruction:',
    );
  });

  it('refineTextV2 enforces strict compliance with corrective rewrite when output is mixed', async () => {
    mockInvoke
      .mockResolvedValueOnce({
        refinedText: 'Machan, please review this report by 4 PM.',
      })
      .mockResolvedValueOnce({
        refinedText: 'Please review this report by 4 PM.',
      });

    const result = await service.refineTextV2(
      'machan meka balanna',
      'english',
      'professional',
    );

    expect(result.refinedText).toBe('Please review this report by 4 PM.');
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});
