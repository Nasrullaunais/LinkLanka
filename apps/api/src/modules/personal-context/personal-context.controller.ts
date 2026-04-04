import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../../core/identity/guards/jwt-auth.guard';
import { PersonalContextService } from './personal-context.service';
import { CreatePersonalContextDto } from './dto/create-personal-context.dto';
import { UpdatePersonalContextDto } from './dto/update-personal-context.dto';

interface AuthRequest {
  user: { sub: string; email: string };
}

@Controller('personal-context')
@UseGuards(JwtAuthGuard)
export class PersonalContextController {
  constructor(
    private readonly personalContextService: PersonalContextService,
  ) {}

  // ── List all entries for the authenticated user ──────────────────────────
  @Get()
  async findAll(@Request() req: AuthRequest) {
    return this.personalContextService.findAllByUser(req.user.sub);
  }

  // ── Get current count and maximum allowed ────────────────────────────────
  @Get('count')
  async getCount(@Request() req: AuthRequest) {
    const summary = await this.personalContextService.getCountSummary(
      req.user.sub,
    );

    return {
      // Backward compatible fields.
      count: summary.totalCount,
      max: summary.totalMax,
      // Explicit fields for the per-language UX.
      totalCount: summary.totalCount,
      totalMax: summary.totalMax,
      perLanguage: summary.perLanguage,
    };
  }

  // ── Add a new dictionary entry ───────────────────────────────────────────
  @Post()
  async create(
    @Request() req: AuthRequest,
    @Body() dto: CreatePersonalContextDto,
  ) {
    const userId = req.user.sub;
    const dialectType = this.personalContextService.normalizeDialectType(
      dto.dialectType,
    );

    const dialectCount =
      await this.personalContextService.countByUserAndDialect(
        userId,
        dialectType,
      );

    if (dialectCount >= this.personalContextService.maxEntriesPerLanguage) {
      throw new BadRequestException(
        `You have reached the maximum of ${this.personalContextService.maxEntriesPerLanguage} ${dialectType} dictionary entries. Delete an existing ${dialectType} entry before adding a new one.`,
      );
    }

    // Check for duplicate word in the same language bucket.
    const existing = await this.personalContextService.findByUserAndWord(
      userId,
      dto.slangWord,
      dialectType,
    );

    if (existing) {
      throw new ConflictException(
        `You already have a ${dialectType} dictionary entry for "${dto.slangWord}". Edit the existing entry instead.`,
      );
    }

    return this.personalContextService.addSlang(
      userId,
      dto.slangWord,
      dto.standardMeaning,
      dialectType,
    );
  }

  // ── Update an existing entry (meaning and/or dialect only) ───────────────
  @Patch(':id')
  async update(
    @Request() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePersonalContextDto,
  ) {
    const userId = req.user.sub;
    const existingEntry = await this.personalContextService.findOneByUser(
      id,
      userId,
    );

    if (!existingEntry) {
      throw new NotFoundException(
        'Dictionary entry not found or does not belong to you.',
      );
    }

    const currentDialect = this.personalContextService.normalizeDialectType(
      existingEntry.dialectType,
    );

    const nextDialect =
      dto.dialectType !== undefined
        ? this.personalContextService.normalizeDialectType(dto.dialectType)
        : currentDialect;

    if (nextDialect !== currentDialect) {
      const targetDialectCount =
        await this.personalContextService.countByUserAndDialect(
          userId,
          nextDialect,
        );

      if (
        targetDialectCount >= this.personalContextService.maxEntriesPerLanguage
      ) {
        throw new BadRequestException(
          `You have reached the maximum of ${this.personalContextService.maxEntriesPerLanguage} ${nextDialect} dictionary entries. Delete an existing ${nextDialect} entry before moving this one.`,
        );
      }

      const duplicateInTargetDialect =
        await this.personalContextService.findByUserAndWord(
          userId,
          existingEntry.slangWord,
          nextDialect,
        );

      if (duplicateInTargetDialect && duplicateInTargetDialect.id !== id) {
        throw new ConflictException(
          `You already have a ${nextDialect} dictionary entry for "${existingEntry.slangWord}".`,
        );
      }
    }

    return this.personalContextService.updateEntry(id, userId, {
      ...dto,
      dialectType: dto.dialectType !== undefined ? nextDialect : undefined,
    });
  }

  // ── Delete an entry ──────────────────────────────────────────────────────
  @Delete(':id')
  async remove(
    @Request() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.personalContextService.deleteEntry(id, req.user.sub);
    return { deleted: true };
  }
}
