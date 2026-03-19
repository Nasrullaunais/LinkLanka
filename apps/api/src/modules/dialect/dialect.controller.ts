import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { JwtAuthGuard } from '../../core/identity/guards/jwt-auth.guard';
import { DialectService } from './dialect.service';
import { RefineTextDto } from './dto/refine-text.dto';
import { RefineTextV2Dto } from './dto/refine-text-v2.dto';
import { SuggestDialectOptionsDto } from './dto/suggest-dialect-options.dto';

// ── Controller ────────────────────────────────────────────────────────────────

@Controller('dialect')
export class DialectController {
  private readonly logger = new Logger(DialectController.name);

  constructor(private readonly dialectService: DialectService) {}

  /**
   * POST /dialect/refine
   *
   * Accepts `{ text: string, mode: 'professional' | 'singlish' | 'tanglish' }`
   * and returns `{ refinedText: string }`.
   *
   * Rate-limited to 5 requests per 10 seconds per user (JWT-bound IP)
   * to limit Gemini API spend.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 10000 } })
  @Post('refine')
  @HttpCode(HttpStatus.OK)
  async refineText(@Body() dto: RefineTextDto) {
    const text = dto.text.trim();
    this.logger.log(`Refining text [mode=${dto.mode}] length=${text.length}`);
    return this.dialectService.refineText(text, dto.mode);
  }

  /**
   * POST /dialect/suggest
   *
   * Detects source language/tone and returns ranked target suggestions
   * for language + tone selection.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 8, ttl: 10000 } })
  @Post('suggest')
  @HttpCode(HttpStatus.OK)
  suggest(@Body() dto: SuggestDialectOptionsDto) {
    const text = dto.text.trim();
    this.logger.log(`Suggesting dialect options length=${text.length}`);
    return this.dialectService.suggestDialectOptions(text);
  }

  /**
   * POST /dialect/refine-v2
   *
   * Accepts explicit target language + target tone and returns a rewritten
   * message in the requested style.
   */
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 10000 } })
  @Post('refine-v2')
  @HttpCode(HttpStatus.OK)
  refineTextV2(@Body() dto: RefineTextV2Dto) {
    const text = dto.text.trim();
    this.logger.log(
      `Refining text v2 [language=${dto.targetLanguage}] [tone=${dto.targetTone}] length=${text.length}`,
    );
    return this.dialectService.refineTextV2(
      text,
      dto.targetLanguage,
      dto.targetTone,
    );
  }
}
