import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { Repository } from 'typeorm';

import { PersonalContextService } from './personal-context.service';
import { PersonalContext } from './entities/personal-context.entity';

type MockRepo = Record<
  keyof Pick<
    Repository<PersonalContext>,
    'find' | 'findOne' | 'count' | 'create' | 'save' | 'remove'
  >,
  jest.Mock
> & {
  createQueryBuilder: jest.Mock;
};

describe('PersonalContextService', () => {
  let service: PersonalContextService;
  let repo: MockRepo;

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalContextService,
        {
          provide: getRepositoryToken(PersonalContext),
          useValue: repo,
        },
      ],
    }).compile();

    service = module.get(PersonalContextService);
  });

  it('returns grouped count summary with 50-per-language and 150-total caps', async () => {
    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { dialectType: 'singlish', count: '12' },
        { dialectType: 'english', count: '8' },
        { dialectType: null, count: '4' },
      ]),
    };

    repo.createQueryBuilder.mockReturnValue(queryBuilder);

    const summary = await service.getCountSummary('user-1');

    expect(summary.totalCount).toBe(24);
    expect(summary.totalMax).toBe(150);
    expect(summary.perLanguage.singlish.count).toBe(12);
    expect(summary.perLanguage.english.count).toBe(12);
    expect(summary.perLanguage.tanglish.count).toBe(0);
    expect(summary.perLanguage.english.remaining).toBe(38);
    expect(summary.perLanguage.singlish.max).toBe(50);
  });

  it('findByUserAndWord scopes duplicates by language bucket', async () => {
    repo.find.mockResolvedValue([
      {
        id: '1',
        userId: 'user-1',
        slangWord: 'machan',
        standardMeaning: 'friend',
        dialectType: 'english',
      },
      {
        id: '2',
        userId: 'user-1',
        slangWord: 'machan',
        standardMeaning: 'pal',
        dialectType: 'singlish',
      },
    ]);

    const singlishMatch = await service.findByUserAndWord(
      'user-1',
      'machan',
      'singlish',
    );
    const tanglishMatch = await service.findByUserAndWord(
      'user-1',
      'machan',
      'tanglish',
    );

    expect(singlishMatch?.id).toBe('2');
    expect(tanglishMatch).toBeNull();
  });

  it('compiles dictionary prompt in labeled language sections', async () => {
    repo.find.mockResolvedValue([
      {
        id: '1',
        userId: 'user-1',
        slangWord: 'machan',
        standardMeaning: 'friend',
        dialectType: 'singlish',
        createdAt: new Date('2026-01-01'),
      },
      {
        id: '2',
        userId: 'user-1',
        slangWord: 'deadline',
        standardMeaning: 'due date',
        dialectType: 'english',
        createdAt: new Date('2026-01-02'),
      },
      {
        id: '3',
        userId: 'user-1',
        slangWord: 'machi',
        standardMeaning: 'brother',
        dialectType: 'tanglish',
        createdAt: new Date('2026-01-03'),
      },
    ]);

    const dictionary = await service.getUserDictionary('user-1');

    expect(dictionary).toContain("User's custom dictionary by language:");
    expect(dictionary).toContain('Singlish:');
    expect(dictionary).toContain('English:');
    expect(dictionary).toContain('Tanglish:');
    expect(dictionary).toContain("'machan' means 'friend'.");
    expect(dictionary).toContain("'deadline' means 'due date'.");
    expect(dictionary).toContain("'machi' means 'brother'.");
  });
});
