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
}
