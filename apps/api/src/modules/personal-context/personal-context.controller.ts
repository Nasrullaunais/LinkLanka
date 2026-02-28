import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
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
    const count = await this.personalContextService.countByUser(req.user.sub);
    return { count, max: this.personalContextService.maxEntriesPerUser };
  }

  // ── Add a new dictionary entry ───────────────────────────────────────────
  @Post()
  async create(
    @Request() req: AuthRequest,
    @Body() dto: CreatePersonalContextDto,
  ) {
    const userId = req.user.sub;

    // Check word limit
    const count = await this.personalContextService.countByUser(userId);
    if (count >= this.personalContextService.maxEntriesPerUser) {
      throw new BadRequestException(
        `You have reached the maximum of ${this.personalContextService.maxEntriesPerUser} dictionary entries. Delete an existing entry before adding a new one.`,
      );
    }

    // Check for duplicate word
    const existing = await this.personalContextService.findByUserAndWord(
      userId,
      dto.slangWord,
    );
    if (existing) {
      throw new ConflictException(
        `You already have a dictionary entry for "${dto.slangWord}". Edit the existing entry instead.`,
      );
    }

    return this.personalContextService.addSlang(
      userId,
      dto.slangWord,
      dto.standardMeaning,
      dto.dialectType,
    );
  }

  // ── Update an existing entry (meaning and/or dialect only) ───────────────
  @Patch(':id')
  async update(
    @Request() req: AuthRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePersonalContextDto,
  ) {
    return this.personalContextService.updateEntry(id, req.user.sub, dto);
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
