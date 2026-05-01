import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditService } from './audit.service';
import { AuditLogEntity } from './entities/audit-log.entity';

const mockRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('AuditService', () => {
  let service: AuditService;
  let repo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLogEntity), useFactory: mockRepo },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    repo = module.get(getRepositoryToken(AuditLogEntity));
  });

  describe('log()', () => {
    it('creates and saves audit entry', async () => {
      const dto = { userId: 1, userEmail: 'a@b.com', action: 'LOGIN', resourceType: 'session' };
      const entity = { ...dto, id: 'uuid-1' } as AuditLogEntity;
      repo.create.mockReturnValue(entity);
      repo.save.mockResolvedValue(entity);

      await service.log(dto);

      expect(repo.create).toHaveBeenCalledWith(dto);
      expect(repo.save).toHaveBeenCalledWith(entity);
    });

    it('does NOT throw when database save fails', async () => {
      repo.create.mockReturnValue({});
      repo.save.mockRejectedValue(new Error('DB down'));

      await expect(
        service.log({ userId: 1, userEmail: 'x@y.com', action: 'LOGIN', resourceType: 'session' }),
      ).resolves.not.toThrow();
    });
  });

  describe('getRecentLogs()', () => {
    it('returns entries ordered newest first', async () => {
      const entries = [
        { id: '2', createdAt: new Date('2026-04-29T10:00:00Z') },
        { id: '1', createdAt: new Date('2026-04-29T09:00:00Z') },
      ] as AuditLogEntity[];
      repo.find.mockResolvedValue(entries);

      const result = await service.getRecentLogs(200);

      expect(repo.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' }, take: 200 });
      expect(result).toBe(entries);
    });
  });

  describe('getUserActivity()', () => {
    it('filters by userId', async () => {
      const entries = [{ id: '1', userId: 5 }] as AuditLogEntity[];
      repo.find.mockResolvedValue(entries);

      const result = await service.getUserActivity(5, 50);

      expect(repo.find).toHaveBeenCalledWith({ where: { userId: 5 }, order: { createdAt: 'DESC' }, take: 50 });
      expect(result).toBe(entries);
    });
  });

  describe('getActionSummary()', () => {
    it('counts each action type correctly', async () => {
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { action: 'LOGIN', count: '5' },
          { action: 'CREATE', count: '12' },
        ]),
      };
      repo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getActionSummary();

      expect(result).toEqual({ LOGIN: 5, CREATE: 12 });
    });
  });
});
