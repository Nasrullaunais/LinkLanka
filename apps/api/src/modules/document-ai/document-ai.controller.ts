import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { IsString, IsArray, IsOptional, ValidateNested, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../core/identity/guards/jwt-auth.guard';
import {
  DocumentAiService,
  SummaryBullet,
  QAResponse,
  QAChatTurn,
} from './document-ai.service';

class QAChatTurnDto {
  @IsIn(['user', 'ai'])
  role: 'user' | 'ai';

  @IsString()
  text: string;
}

class DocumentQADto {
  @IsString()
  userQuestion: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => QAChatTurnDto)
  chatHistory?: QAChatTurnDto[];
}

@Controller('document-ai')
@UseGuards(JwtAuthGuard)
export class DocumentAiController {
  constructor(private readonly documentAiService: DocumentAiService) {}

  /**
   * GET /document-ai/:messageId/summary
   *
   * Returns a cached (or freshly generated) 3-bullet summary for a DOCUMENT message.
   */
  @Get(':messageId/summary')
  async getSummary(
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<{ bullets: SummaryBullet[] }> {
    const bullets = await this.documentAiService.getSummary(messageId);
    return { bullets };
  }

  /**
   * POST /document-ai/:messageId/qa
   *
   * Ask a question about a document. The full file is sent to Gemini alongside
   * the conversation history. Answers include page-level citations.
   */
  @Post(':messageId/qa')
  async askQuestion(
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Body() body: DocumentQADto,
  ): Promise<QAResponse> {
    return this.documentAiService.askQuestion(
      messageId,
      body.userQuestion,
      body.chatHistory ?? [],
    );
  }
}
