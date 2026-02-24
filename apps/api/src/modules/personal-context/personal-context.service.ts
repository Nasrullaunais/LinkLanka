import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PersonalContext } from './entities/personal-context.entity';

@Injectable()
export class PersonalContextService {
  constructor(
    @InjectRepository(PersonalContext)
    private readonly personalContextRepository: Repository<PersonalContext>,
  ) {}

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

    return this.personalContextRepository.save(slangEntry);
  }

  async getUserDictionary(userId: string): Promise<string> {
    const slangEntries: PersonalContext[] =
      await this.personalContextRepository.find({
        where: { userId },
        order: { createdAt: 'ASC' },
      });

    if (slangEntries.length === 0) {
      return '';
    }

    const compiledEntries: string = slangEntries
      .map(
        (entry: PersonalContext) =>
          `'${entry.slangWord}' means '${entry.standardMeaning}'.`,
      )
      .join(' ');

    return `User's custom dictionary: ${compiledEntries}`;
  }
}
