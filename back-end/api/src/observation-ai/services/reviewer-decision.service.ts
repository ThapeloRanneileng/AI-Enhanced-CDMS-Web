import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ReviewerDecisionEntity } from '../entities/reviewer-decision.entity';
import { ReviewerDecisionDto } from '../dtos/reviewer-decision.dto';

@Injectable()
export class ReviewerDecisionService {
  constructor(
    @InjectRepository(ReviewerDecisionEntity)
    private readonly repo: Repository<ReviewerDecisionEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async save(dto: ReviewerDecisionDto, userId: number): Promise<ReviewerDecisionEntity> {
    const entity = this.repo.create({
      stationId: dto.stationId.trim(),
      elementId: dto.elementId,
      datetime: new Date(dto.datetime),
      level: dto.level,
      interval: dto.interval,
      sourceId: dto.sourceId,
      assessmentId: dto.assessmentId ?? null,
      decision: dto.decision,
      correctedValue: dto.correctedValue ?? null,
      reasonCode: dto.reasonCode ?? null,
      reasonNote: dto.reasonNote ?? null,
      reviewedByUserId: userId,
    });
    return this.repo.save(entity);
  }

  async findLabelledExamples(limit: number = 1000): Promise<Record<string, any>[]> {
    return this.dataSource.query(`
      SELECT
        rd.id,
        rd.station_id        AS "stationId",
        rd.element_id        AS "elementId",
        rd.date_time         AS "datetime",
        rd.level,
        rd.interval,
        rd.source_id         AS "sourceId",
        rd.decision,
        rd.corrected_value   AS "correctedValue",
        rd.reviewed_at       AS "reviewedAt",
        oaa.feature_snapshot AS "featureSnapshot",
        oaa.anomaly_score    AS "anomalyScore",
        oaa.confidence_score AS "confidenceScore",
        oaa.severity,
        oaa.outcome
      FROM reviewer_decisions rd
      LEFT JOIN observation_anomaly_assessments oaa ON oaa.id = rd.assessment_id
      WHERE oaa.feature_snapshot IS NOT NULL
      ORDER BY rd.reviewed_at DESC
      LIMIT $1
    `, [limit]);
  }

  async getDecisionStats(): Promise<{ approved: number; overridden: number; escalated: number; total: number }> {
    const rows: Array<{ decision: string; count: string }> = await this.dataSource.query(`
      SELECT decision, COUNT(*) AS count
      FROM reviewer_decisions
      GROUP BY decision
    `);
    const map = Object.fromEntries(rows.map(r => [r.decision, Number(r.count)]));
    const approved = map['approved'] ?? 0;
    const overridden = map['overridden'] ?? 0;
    const escalated = map['escalated'] ?? 0;
    return { approved, overridden, escalated, total: approved + overridden + escalated };
  }
}
