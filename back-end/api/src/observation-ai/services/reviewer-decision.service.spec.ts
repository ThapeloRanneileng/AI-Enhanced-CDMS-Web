import { ReviewerDecisionService } from './reviewer-decision.service';
import { ReviewerDecisionEntity } from '../entities/reviewer-decision.entity';
import { ReviewerDecisionDto } from '../dtos/reviewer-decision.dto';

describe('ReviewerDecisionService', () => {
  let service: ReviewerDecisionService;
  let mockRepo: { create: jest.Mock; save: jest.Mock };
  let mockDataSource: { query: jest.Mock };

  const sampleDto: ReviewerDecisionDto = {
    stationId: 'STA001',
    elementId: 101,
    datetime: '2026-01-15T12:00:00.000Z',
    level: 0,
    interval: 1440,
    sourceId: 1,
    assessmentId: 42,
    decision: 'approved',
    correctedValue: null,
    reasonCode: undefined,
    reasonNote: 'All checks passed',
  };

  beforeEach(() => {
    mockRepo = { create: jest.fn(), save: jest.fn() };
    mockDataSource = { query: jest.fn() };
    service = new ReviewerDecisionService(mockRepo as any, mockDataSource as any);
  });

  describe('save()', () => {
    it('persists a reviewer decision and returns the saved entity', async () => {
      const partial: Partial<ReviewerDecisionEntity> = {
        stationId: 'STA001',
        elementId: 101,
        decision: 'approved',
        reviewedByUserId: 5,
      };
      const saved: ReviewerDecisionEntity = {
        id: 'uuid-1234',
        reviewedAt: new Date('2026-01-15T12:00:00Z'),
        createdAt: new Date('2026-01-15T12:00:00Z'),
        datetime: new Date('2026-01-15T12:00:00Z'),
        level: 0,
        interval: 1440,
        sourceId: 1,
        assessmentId: 42,
        correctedValue: null,
        reasonCode: null,
        reasonNote: 'All checks passed',
        ...partial,
      } as ReviewerDecisionEntity;

      mockRepo.create.mockReturnValue(partial);
      mockRepo.save.mockResolvedValue(saved);

      const result = await service.save(sampleDto, 5);

      expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        stationId: 'STA001',
        elementId: 101,
        decision: 'approved',
        reviewedByUserId: 5,
        assessmentId: 42,
        reasonNote: 'All checks passed',
        correctedValue: null,
      }));
      expect(mockRepo.save).toHaveBeenCalledWith(partial);
      expect(result.id).toBe('uuid-1234');
      expect(result.decision).toBe('approved');
    });

    it('trims stationId whitespace before saving', async () => {
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({} as ReviewerDecisionEntity);

      await service.save({ ...sampleDto, stationId: '  STA001  ' }, 1);

      expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({ stationId: 'STA001' }));
    });

    it('sets correctedValue to null when not provided', async () => {
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({} as ReviewerDecisionEntity);

      await service.save({ ...sampleDto, correctedValue: undefined }, 1);

      expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({ correctedValue: null }));
    });

    it('sets assessmentId to null when not provided', async () => {
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({} as ReviewerDecisionEntity);

      await service.save({ ...sampleDto, assessmentId: undefined }, 1);

      expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({ assessmentId: null }));
    });

    it('parses datetime string to Date', async () => {
      mockRepo.create.mockReturnValue({});
      mockRepo.save.mockResolvedValue({} as ReviewerDecisionEntity);

      await service.save(sampleDto, 1);

      const call = mockRepo.create.mock.calls[0][0];
      expect(call.datetime).toBeInstanceOf(Date);
      expect(call.datetime.toISOString()).toBe('2026-01-15T12:00:00.000Z');
    });
  });

  describe('findLabelledExamples()', () => {
    it('returns rows with featureSnapshot from joined assessment', async () => {
      const rows = [
        { stationId: 'STA001', decision: 'approved', featureSnapshot: { temp_z_score: 1.2 } },
        { stationId: 'STA002', decision: 'overridden', featureSnapshot: { temp_z_score: 3.4 } },
      ];
      mockDataSource.query.mockResolvedValue(rows);

      const result = await service.findLabelledExamples(100);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('LEFT JOIN observation_anomaly_assessments'),
        [100],
      );
      expect(result).toHaveLength(2);
      expect(result[0].featureSnapshot).toEqual({ temp_z_score: 1.2 });
    });

    it('filters rows to only those with a featureSnapshot', async () => {
      mockDataSource.query.mockResolvedValue([]);

      await service.findLabelledExamples(50);

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE oaa.feature_snapshot IS NOT NULL'),
        [50],
      );
    });

    it('uses default limit of 1000 when not specified', async () => {
      mockDataSource.query.mockResolvedValue([]);

      await service.findLabelledExamples();

      expect(mockDataSource.query).toHaveBeenCalledWith(expect.any(String), [1000]);
    });

    it('orders results by reviewed_at descending', async () => {
      mockDataSource.query.mockResolvedValue([]);

      await service.findLabelledExamples();

      expect(mockDataSource.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY rd.reviewed_at DESC'),
        expect.any(Array),
      );
    });
  });

  describe('getDecisionStats()', () => {
    it('returns correct counts for all three decision categories', async () => {
      mockDataSource.query.mockResolvedValue([
        { decision: 'approved', count: '30' },
        { decision: 'overridden', count: '15' },
        { decision: 'escalated', count: '5' },
      ]);

      const stats = await service.getDecisionStats();

      expect(stats).toEqual({ approved: 30, overridden: 15, escalated: 5, total: 50 });
    });

    it('returns zeros for all categories on empty table', async () => {
      mockDataSource.query.mockResolvedValue([]);

      const stats = await service.getDecisionStats();

      expect(stats).toEqual({ approved: 0, overridden: 0, escalated: 0, total: 0 });
    });

    it('handles partial categories gracefully', async () => {
      mockDataSource.query.mockResolvedValue([
        { decision: 'approved', count: '10' },
      ]);

      const stats = await service.getDecisionStats();

      expect(stats).toEqual({ approved: 10, overridden: 0, escalated: 0, total: 10 });
    });

    it('computes total as the sum of all three categories', async () => {
      mockDataSource.query.mockResolvedValue([
        { decision: 'approved', count: '100' },
        { decision: 'overridden', count: '50' },
        { decision: 'escalated', count: '25' },
      ]);

      const stats = await service.getDecisionStats();

      expect(stats.total).toBe(175);
    });
  });
});
