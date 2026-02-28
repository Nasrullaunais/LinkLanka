import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PersonalContext } from './entities/personal-context.entity';

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_ENTRIES_PER_USER = 50;
const MAX_DICTIONARY_CHARS = 1500;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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

  // ── Read operations ──────────────────────────────────────────────────────

  async findAllByUser(userId: string): Promise<PersonalContext[]> {
    return this.personalContextRepository.find({
      where: { userId },
      order: { createdAt: 'ASC' },
    });
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
  ): Promise<PersonalContext | null> {
    return this.personalContextRepository.findOne({
      where: { userId, slangWord },
    });
  }

  async countByUser(userId: string): Promise<number> {
    return this.personalContextRepository.count({ where: { userId } });
  }

  get maxEntriesPerUser(): number {
    return MAX_ENTRIES_PER_USER;
  }

  // ── Write operations ─────────────────────────────────────────────────────

  async addSlang(
    userId: string,
    slangWord: string,
    standardMeaning: string,
    dialectType?: string,
  ): Promise<PersonalContext> {
    const slangEntry: PersonalContext = this.personalContextRepository.create({
      userId,
      slangWord,
      standardMeaning,
      dialectType: dialectType ?? null,
    });

    const saved = await this.personalContextRepository.save(slangEntry);
    this.invalidateCache(userId);
    return saved;
  }

  async updateEntry(
    id: string,
    userId: string,
    dto: { standardMeaning?: string; dialectType?: string | null },
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
      entry.dialectType = dto.dialectType ?? null;
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

    const slangEntries: PersonalContext[] =
      await this.personalContextRepository.find({
        where: { userId },
        order: { createdAt: 'ASC' },
      });

    if (slangEntries.length === 0) {
      const emptyResult = '';
      this.setCache(userId, emptyResult);
      return emptyResult;
    }

    // Build the dictionary string with a hard cap of MAX_DICTIONARY_CHARS.
    // Entries are added oldest-first; we stop before exceeding the limit.
    const prefix = "User's custom dictionary: ";
    let compiled = prefix;

    for (const entry of slangEntries) {
      const fragment = `'${entry.slangWord}' means '${entry.standardMeaning}'. `;
      if (compiled.length + fragment.length > MAX_DICTIONARY_CHARS) {
        break; // Adding this entry would exceed the limit
      }
      compiled += fragment;
    }

    const result = compiled.trim();
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
