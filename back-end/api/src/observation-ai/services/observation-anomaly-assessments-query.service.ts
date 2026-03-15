import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Equal, FindManyOptions, FindOperator, FindOptionsWhere, In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { ObservationAnomalyAssessmentEntity } from '../entities/observation-anomaly-assessment.entity';
import { ViewObservationAnomalyAssessmentDto } from '../dtos/view-observation-anomaly-assessment.dto';
import { ViewObservationAnomalyAssessmentQueryDto } from '../dtos/view-observation-anomaly-assessment-query.dto';

@Injectable()
export class ObservationAnomalyAssessmentsQueryService {
  constructor(
    @InjectRepository(ObservationAnomalyAssessmentEntity) private anomalyAssessmentRepo: Repository<ObservationAnomalyAssessmentEntity>,
  ) { }

  public async find(queryDto: ViewObservationAnomalyAssessmentQueryDto): Promise<ViewObservationAnomalyAssessmentDto[]> {
    if (!(queryDto.page && queryDto.pageSize && queryDto.pageSize <= 1000)) {
      throw new BadRequestException('You must specify page and page size. Page size must be less than or equal to 1000');
    }

    const findOptions: FindManyOptions<ObservationAnomalyAssessmentEntity> = {
      order: {
        datetime: 'DESC',
        stationId: 'ASC',
        elementId: 'ASC',
        interval: 'ASC',
        level: 'ASC',
        sourceId: 'ASC',
        createdAt: 'DESC',
      },
      where: this.getFilter(queryDto),
      skip: (queryDto.page - 1) * queryDto.pageSize,
      take: queryDto.pageSize,
    };

    const entities = await this.anomalyAssessmentRepo.find(findOptions);
    return entities.map(entity => ({
      id: entity.id,
      stationId: entity.stationId,
      elementId: entity.elementId,
      level: entity.level,
      datetime: entity.datetime.toISOString(),
      interval: entity.interval,
      sourceId: entity.sourceId,
      assessmentType: entity.assessmentType,
      modelId: entity.modelId,
      modelVersion: entity.modelVersion,
      anomalyScore: entity.anomalyScore,
      severity: entity.severity,
      outcome: entity.outcome,
      reasons: entity.reasons ?? [],
      featureSnapshot: entity.featureSnapshot,
      createdByUserId: entity.createdByUserId,
      createdAt: entity.createdAt.toISOString(),
    }));
  }

  public count(queryDto: ViewObservationAnomalyAssessmentQueryDto): Promise<number> {
    return this.anomalyAssessmentRepo.countBy(this.getFilter(queryDto));
  }

  private getFilter(queryDto: ViewObservationAnomalyAssessmentQueryDto): FindOptionsWhere<ObservationAnomalyAssessmentEntity> {
    const whereOptions: FindOptionsWhere<ObservationAnomalyAssessmentEntity> = {};

    if (queryDto.stationIds) {
      whereOptions.stationId = queryDto.stationIds.length === 1 ? queryDto.stationIds[0] : In(queryDto.stationIds);
    }

    if (queryDto.elementIds) {
      whereOptions.elementId = queryDto.elementIds.length === 1 ? queryDto.elementIds[0] : In(queryDto.elementIds);
    }

    if (queryDto.level !== undefined) {
      whereOptions.level = queryDto.level;
    }

    if (queryDto.intervals) {
      whereOptions.interval = queryDto.intervals.length === 1 ? queryDto.intervals[0] : In(queryDto.intervals);
    }

    if (queryDto.sourceIds) {
      whereOptions.sourceId = queryDto.sourceIds.length === 1 ? queryDto.sourceIds[0] : In(queryDto.sourceIds);
    }

    const dateOperator = this.getDateFilter(queryDto);
    if (dateOperator) {
      whereOptions.datetime = dateOperator;
    }

    if (queryDto.assessmentTypes) {
      whereOptions.assessmentType = queryDto.assessmentTypes.length === 1 ? queryDto.assessmentTypes[0] : In(queryDto.assessmentTypes);
    }

    if (queryDto.severities) {
      whereOptions.severity = queryDto.severities.length === 1 ? queryDto.severities[0] : In(queryDto.severities);
    }

    if (queryDto.outcomes) {
      whereOptions.outcome = queryDto.outcomes.length === 1 ? queryDto.outcomes[0] : In(queryDto.outcomes);
    }

    if (queryDto.modelId) {
      whereOptions.modelId = queryDto.modelId;
    }

    if (queryDto.modelVersion) {
      whereOptions.modelVersion = queryDto.modelVersion;
    }

    return whereOptions;
  }

  private getDateFilter(queryDto: ViewObservationAnomalyAssessmentQueryDto): FindOperator<Date> | null {
    if (queryDto.fromDate && queryDto.toDate) {
      if (queryDto.fromDate === queryDto.toDate) {
        return Equal(new Date(queryDto.fromDate));
      }

      return Between(new Date(queryDto.fromDate), new Date(queryDto.toDate));
    }

    if (queryDto.fromDate) {
      return MoreThanOrEqual(new Date(queryDto.fromDate));
    }

    if (queryDto.toDate) {
      return LessThanOrEqual(new Date(queryDto.toDate));
    }

    return null;
  }
}
