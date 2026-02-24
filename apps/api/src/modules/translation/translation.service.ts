import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { z } from 'zod';

export const TranslationSchema = z.object({
  translations: z.record(z.string(), z.string()),
  confidenceScore: z.number().min(0).max(100),
});

type TranslationResult = z.infer<typeof TranslationSchema>;

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface TranslateIntentPayload {
  rawText: string;
  nativeDialect: string;
  targetLanguages: string[];
  chatHistory: ChatTurn[];
  userDictionary: string;
}

@Injectable()
export class TranslationService {
  private readonly model: ChatGoogleGenerativeAI;

  constructor(private readonly configService: ConfigService) {
    this.model = new ChatGoogleGenerativeAI({
      apiKey: this.configService.getOrThrow<string>('GEMINI_API_KEY'),
      model: 'gemini-3.0-flash',
    });
  }

  async translateIntent(
    payload: TranslateIntentPayload,
  ): Promise<TranslationResult> {
    const { rawText, nativeDialect, targetLanguages, chatHistory } = payload;

    const structuredModel = this.model.withStructuredOutput(TranslationSchema);

    const historyMessages: Array<HumanMessage | AIMessage> = chatHistory.map(
      (turn: ChatTurn) =>
        turn.role === 'user'
          ? new HumanMessage(turn.content)
          : new AIMessage(turn.content),
    );

    const targetLanguagesText: string = targetLanguages.join(', ');

    const systemMessage = new SystemMessage(
      `You are a Sri Lankan linguistic AI Mediator. Analyze the conversation history. 
      Extract the intent of the final message written in ${nativeDialect}.
       Output translations for these specific languages: ${targetLanguagesText}. 
       Calculate a confidence score (0-100). 
       If the phrase is too ambiguous even with context, lower the score.
       CRITICAL CONTEXT: The user has provided a custom dictionary for their specific slang. You MUST prioritize these definitions if they appear in the text: ${payload.userDictionary}`,
    );

    return structuredModel.invoke([
      systemMessage,
      ...historyMessages,
      new HumanMessage(rawText),
    ]);
  }
}
