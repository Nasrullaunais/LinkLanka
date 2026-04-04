import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import { PersonalContextController } from './personal-context.controller';
import type { PersonalContextService } from './personal-context.service';

describe('PersonalContextController', () => {
  const mockService = {
    getCountSummary: jest.fn(),
    normalizeDialectType: jest.fn(),
    countByUserAndDialect: jest.fn(),
    findByUserAndWord: jest.fn(),
    addSlang: jest.fn(),
    findOneByUser: jest.fn(),
    updateEntry: jest.fn(),
    findAllByUser: jest.fn(),
    deleteEntry: jest.fn(),
    maxEntriesPerLanguage: 50,
  } as unknown as PersonalContextService;

  let controller: PersonalContextController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PersonalContextController(mockService);
  });

  it('returns per-language count payload and backward-compatible total fields', async () => {
    const summary = {
      totalCount: 72,
      totalMax: 150,
      perLanguage: {
        singlish: { count: 22, max: 50, remaining: 28 },
        english: { count: 25, max: 50, remaining: 25 },
        tanglish: { count: 25, max: 50, remaining: 25 },
      },
    };

    (mockService.getCountSummary as jest.Mock).mockResolvedValue(summary);

    const result = await controller.getCount({
      user: { sub: 'user-1', email: 'x@y.com' },
    });

    expect(result.count).toBe(72);
    expect(result.max).toBe(150);
    expect(result.totalCount).toBe(72);
    expect(result.totalMax).toBe(150);
    expect(result.perLanguage.singlish.count).toBe(22);
  });

  it('blocks create when selected language bucket is full', async () => {
    (mockService.normalizeDialectType as jest.Mock).mockReturnValue('singlish');
    (mockService.countByUserAndDialect as jest.Mock).mockResolvedValue(50);

    await expect(
      controller.create(
        { user: { sub: 'user-1', email: 'x@y.com' } },
        {
          slangWord: 'machan',
          standardMeaning: 'friend',
          dialectType: 'singlish',
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks create for duplicate words in the same language only', async () => {
    (mockService.normalizeDialectType as jest.Mock).mockReturnValue('english');
    (mockService.countByUserAndDialect as jest.Mock).mockResolvedValue(10);
    (mockService.findByUserAndWord as jest.Mock).mockResolvedValue({
      id: 'e1',
    });

    await expect(
      controller.create(
        { user: { sub: 'user-1', email: 'x@y.com' } },
        {
          slangWord: 'deadline',
          standardMeaning: 'due date',
          dialectType: 'english',
        },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('blocks moving an entry to a full target language bucket during update', async () => {
    (mockService.findOneByUser as jest.Mock).mockResolvedValue({
      id: 'entry-1',
      slangWord: 'machan',
      dialectType: 'english',
    });
    (mockService.normalizeDialectType as jest.Mock)
      .mockReturnValueOnce('english')
      .mockReturnValueOnce('singlish');
    (mockService.countByUserAndDialect as jest.Mock).mockResolvedValue(50);

    await expect(
      controller.update(
        { user: { sub: 'user-1', email: 'x@y.com' } },
        'entry-1',
        { dialectType: 'singlish' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws not found when updating a missing entry', async () => {
    (mockService.findOneByUser as jest.Mock).mockResolvedValue(null);

    await expect(
      controller.update(
        { user: { sub: 'user-1', email: 'x@y.com' } },
        'entry-404',
        { standardMeaning: 'updated' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
