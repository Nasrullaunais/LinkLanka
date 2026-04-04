import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PersonalContext } from './entities/personal-context.entity';
import {
  DEFAULT_PERSONAL_CONTEXT_DIALECT,
  PERSONAL_CONTEXT_DIALECT_LABELS,
  PERSONAL_CONTEXT_DIALECTS,
  type PersonalContextDialect,
} from './personal-context.constants';

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_ENTRIES_PER_LANGUAGE = 50;
const MAX_DICTIONARY_CHARS = 9000;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const MAX_TOTAL_ENTRIES =
  MAX_ENTRIES_PER_LANGUAGE * PERSONAL_CONTEXT_DIALECTS.length;

export interface PersonalContextLanguageCount {
  count: number;
  max: number;
  remaining: number;
}

export interface PersonalContextCountSummary {
  totalCount: number;
  totalMax: number;
  perLanguage: Record<PersonalContextDialect, PersonalContextLanguageCount>;
}

interface CacheEntry {
  value: string;
  expiry: number;
}

@Injectable()
export class PersonalContextService {
  /** In-memory cache for compiled dictionary strings, keyed by userId. */
  private readonly dictionaryCache = new Map<string, CacheEntry>();

  constructor(
    @InjectRepository(PersonalContext)
    private readonly personalContextRepository: Repository<PersonalContext>,
  ) {}

  // ── Dialect helpers ─────────────────────────────────────────────────────

  get defaultDialect(): PersonalContextDialect {
    return DEFAULT_PERSONAL_CONTEXT_DIALECT;
  }

  get supportedDialects(): readonly PersonalContextDialect[] {
    return PERSONAL_CONTEXT_DIALECTS;
  }

  normalizeDialectType(
    value: string | null | undefined,
  ): PersonalContextDialect {
    if (!value) return this.defaultDialect;
    const normalized = value.toLowerCase();
    if (
      PERSONAL_CONTEXT_DIALECTS.includes(normalized as PersonalContextDialect)
    ) {
      return normalized as PersonalContextDialect;
    }
    return this.defaultDialect;
  }

  // ── Read operations ──────────────────────────────────────────────────────

  async findAllByUser(userId: string): Promise<PersonalContext[]> {
    const entries = await this.personalContextRepository.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });

    for (const entry of entries) {
      entry.dialectType = this.normalizeDialectType(entry.dialectType);
    }

    return entries;
  }

  async findOneByUser(
    id: string,
    userId: string,
  ): Promise<PersonalContext | null> {
    return this.personalContextRepository.findOne({
      where: { id, userId },
    });
  }

  async findByUserAndWord(
    userId: string,
    slangWord: string,
    dialectType: PersonalContextDialect,
  ): Promise<PersonalContext | null> {
    const entries = await this.personalContextRepository.find({
      where: { userId, slangWord },
      order: { createdAt: 'ASC' },
    });

    return (
      entries.find(
        (entry) => this.normalizeDialectType(entry.dialectType) === dialectType,
      ) ?? null
    );
  }

  async countByUser(userId: string): Promise<number> {
    return this.personalContextRepository.count({ where: { userId } });
  }

  async countByUserAndDialect(
    userId: string,
    dialectType: PersonalContextDialect,
  ): Promise<number> {
    const summary = await this.getCountSummary(userId);
    return summary.perLanguage[dialectType].count;
  }

  async getCountSummary(userId: string): Promise<PersonalContextCountSummary> {
    const perLanguage: Record<
      PersonalContextDialect,
      PersonalContextLanguageCount
    > = {
      singlish: {
        count: 0,
        max: MAX_ENTRIES_PER_LANGUAGE,
        remaining: MAX_ENTRIES_PER_LANGUAGE,
      },
      english: {
        count: 0,
        max: MAX_ENTRIES_PER_LANGUAGE,
        remaining: MAX_ENTRIES_PER_LANGUAGE,
      },
      tanglish: {
        count: 0,
        max: MAX_ENTRIES_PER_LANGUAGE,
        remaining: MAX_ENTRIES_PER_LANGUAGE,
      },
    };

    const rawCounts = await this.personalContextRepository
      .createQueryBuilder('pc')
      .select('pc.dialectType', 'dialectType')
      .addSelect('COUNT(*)', 'count')
      .where('pc.userId = :userId', { userId })
      .groupBy('pc.dialectType')
      .getRawMany<{ dialectType: string | null; count: string }>();

    for (const row of rawCounts) {
      const dialect = this.normalizeDialectType(row.dialectType);
      perLanguage[dialect].count += Number(row.count);
    }

    let totalCount = 0;
    for (const dialect of PERSONAL_CONTEXT_DIALECTS) {
      const count = perLanguage[dialect].count;
      totalCount += count;
      perLanguage[dialect].remaining = Math.max(
        0,
        MAX_ENTRIES_PER_LANGUAGE - count,
      );
    }

    return {
      totalCount,
      totalMax: MAX_TOTAL_ENTRIES,
      perLanguage,
    };
  }

  get maxEntriesPerLanguage(): number {
    return MAX_ENTRIES_PER_LANGUAGE;
  }

  get maxTotalEntries(): number {
    return MAX_TOTAL_ENTRIES;
  }

  // ── Write operations ─────────────────────────────────────────────────────

  async addSlang(
    userId: string,
    slangWord: string,
    standardMeaning: string,
    dialectType: PersonalContextDialect,
  ): Promise<PersonalContext> {
    const slangEntry: PersonalContext = this.personalContextRepository.create({
      userId,
      slangWord,
      standardMeaning,
      dialectType,
    });

    const saved = await this.personalContextRepository.save(slangEntry);
    this.invalidateCache(userId);
    return saved;
  }

  async updateEntry(
    id: string,
    userId: string,
    dto: { standardMeaning?: string; dialectType?: PersonalContextDialect },
  ): Promise<PersonalContext> {
    const entry = await this.findOneByUser(id, userId);
    if (!entry) {
      throw new NotFoundException(
        'Dictionary entry not found or does not belong to you.',
      );
    }

    if (dto.standardMeaning !== undefined) {
      entry.standardMeaning = dto.standardMeaning;
    }
    if (dto.dialectType !== undefined) {
      entry.dialectType = dto.dialectType;
    }

    const updated = await this.personalContextRepository.save(entry);
    this.invalidateCache(userId);
    return updated;
  }

  async deleteEntry(id: string, userId: string): Promise<void> {
    const entry = await this.findOneByUser(id, userId);
    if (!entry) {
      throw new NotFoundException(
        'Dictionary entry not found or does not belong to you.',
      );
    }

    await this.personalContextRepository.remove(entry);
    this.invalidateCache(userId);
  }

  // ── Dictionary compilation (used by translation pipeline) ────────────────

  async getUserDictionary(userId: string): Promise<string> {
    // Check cache first
    const cached = this.dictionaryCache.get(userId);
    if (cached && cached.expiry > Date.now()) {
      return cached.value;
    }

    const slangEntries: PersonalContext[] = await this.findAllByUser(userId);

    if (slangEntries.length === 0) {
      const emptyResult = '';
      this.setCache(userId, emptyResult);
      return emptyResult;
    }

    const grouped: Record<PersonalContextDialect, PersonalContext[]> = {
      singlish: [],
      english: [],
      tanglish: [],
    };

    for (const entry of slangEntries) {
      grouped[this.normalizeDialectType(entry.dialectType)].push(entry);
    }

    // Build categorized dictionary sections while respecting hard char limits.
    const chunks: string[] = ["User's custom dictionary by language:"];
    let compiledLength = chunks[0].length;

    for (const dialect of PERSONAL_CONTEXT_DIALECTS) {
      const items = grouped[dialect];
      if (items.length === 0) continue;

      const lines: string[] = [];
      let sectionLength = 0;

      for (const entry of items) {
        const line = `- '${entry.slangWord}' means '${entry.standardMeaning}'.\n`;
        if (
          compiledLength + sectionLength + line.length >
          MAX_DICTIONARY_CHARS
        ) {
          break;
        }
        lines.push(line);
        sectionLength += line.length;
      }

      if (lines.length === 0) {
        continue;
      }

      const header = `\n${PERSONAL_CONTEXT_DIALECT_LABELS[dialect]}:\n`;
      if (
        compiledLength + header.length + sectionLength >
        MAX_DICTIONARY_CHARS
      ) {
        break;
      }

      chunks.push(header);
      chunks.push(...lines);
      compiledLength += header.length + sectionLength;
    }

    const result = chunks.join('').trim();
    this.setCache(userId, result);
    return result;
  }

  // ── Cache helpers ────────────────────────────────────────────────────────

  private setCache(userId: string, value: string): void {
    this.dictionaryCache.set(userId, {
      value,
      expiry: Date.now() + CACHE_TTL_MS,
    });
  }

  private invalidateCache(userId: string): void {
    this.dictionaryCache.delete(userId);
  }
}
