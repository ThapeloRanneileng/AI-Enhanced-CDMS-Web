import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Equal, FindManyOptions, FindOperator, FindOptionsWhere, In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { ObservationAnomalyAssessmentEntity } from '../entities/observation-anomaly-assessment.entity';
import { ViewObservationAnomalyAssessmentDto } from '../dtos/view-observation-anomaly-assessment.dto';
import { ViewObservationAnomalyAssessmentQueryDto } from '../dtos/view-observation-anomaly-assessment-query.dto';
import { ObservationEntity } from 'src/observation/entities/observation.entity';
import { QCStatusEnum } from 'src/observation/enums/qc-status.enum';
import { FlagEnum } from 'src/observation/enums/flag.enum';

@Injectable()
export class ObservationAnomalyAssessmentsQueryService {
  private readonly logger = new Logger(ObservationAnomalyAssessmentsQueryService.name);

  constructor(
    @InjectRepository(ObservationAnomalyAssessmentEntity) private anomalyAssessmentRepo: Repository<ObservationAnomalyAssessmentEntity>,
    @InjectRepository(ObservationEntity) private observationRepo: Repository<ObservationEntity>,
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

    this.logger.debug(`Observation anomaly assessment find query: ${JSON.stringify({
      stationIds: queryDto.stationIds,
      elementIds: queryDto.elementIds,
      level: queryDto.level,
      intervals: queryDto.intervals,
      sourceIds: queryDto.sourceIds,
      fromDate: queryDto.fromDate ?? null,
      toDate: queryDto.toDate ?? null,
      parsedFromDate: queryDto.fromDate ? new Date(queryDto.fromDate).toISOString() : null,
      parsedToDate: queryDto.toDate ? new Date(queryDto.toDate).toISOString() : null,
      page: queryDto.page,
      pageSize: queryDto.pageSize,
    })}`);

    const entities = await this.anomalyAssessmentRepo.find(findOptions);
    if (entities.length === 0 && queryDto.stationIds?.length === 1 && queryDto.elementIds?.length === 1 && queryDto.intervals?.length === 1 && queryDto.sourceIds?.length === 1 && queryDto.fromDate && queryDto.toDate && queryDto.fromDate === queryDto.toDate) {
      const nearbyAssessments = await this.anomalyAssessmentRepo.find({
        where: {
          stationId: queryDto.stationIds[0],
          elementId: queryDto.elementIds[0],
          level: queryDto.level,
          interval: queryDto.intervals[0],
          sourceId: queryDto.sourceIds[0],
        },
        order: {
          createdAt: 'DESC',
        },
        take: 3,
      });
      const requestedDate = new Date(queryDto.fromDate);

      this.logger.warn(`No anomaly assessment rows found for exact datetime lookup ${requestedDate.toISOString()}`);
      this.logger.warn(`Anomaly assessment query diagnostics: ${JSON.stringify({
        stationId: queryDto.stationIds[0],
        elementId: queryDto.elementIds[0],
        level: queryDto.level,
        interval: queryDto.intervals[0],
        sourceId: queryDto.sourceIds[0],
        requestedDatetimeIso: requestedDate.toISOString(),
        requestedDatetimeEpochMs: requestedDate.getTime(),
        nearbyAssessments: nearbyAssessments.map((assessment) => ({
          id: assessment.id,
          datetime: assessment.datetime.toISOString(),
          createdAt: assessment.createdAt.toISOString(),
          deltaMsFromRequested: assessment.datetime.getTime() - requestedDate.getTime(),
        })),
      })}`);
    }

    return Promise.all(entities.map(async (entity) => {
      const observation = await this.observationRepo.findOneBy({
        stationId: entity.stationId,
        elementId: entity.elementId,
        level: entity.level,
        datetime: entity.datetime,
        interval: entity.interval,
        sourceId: entity.sourceId,
      });
      const failedChecks = this.extractFailedChecks(observation);
      const finalDecision = this.buildFinalDecision(observation);

      return {
        id: entity.id,
        stationId: entity.stationId,
        elementId: entity.elementId,
        level: entity.level,
        datetime: entity.datetime.toISOString(),
        interval: entity.interval,
        sourceId: entity.sourceId,
        assessmentType: entity.assessmentType,
        modelId: entity.modelId,
        modelName: entity.modelFamily,
        modelFamily: entity.modelFamily,
        modelVersion: entity.modelVersion,
        anomalyScore: entity.anomalyScore,
        confidenceScore: entity.confidenceScore,
        confidence: entity.confidenceScore,
        finalDecision: entity.outcome,
        explanation: entity.generativeExplanation?.summary ?? null,
        severity: entity.severity,
        outcome: entity.outcome,
        reasons: entity.reasons ?? [],
        featureSnapshot: entity.featureSnapshot,
        contributingSignals: entity.contributingSignals ?? [],
        generativeExplanation: entity.generativeExplanation,
        reviewQueue: {
          ruleBasedQc: observation?.qcStatus ?? null,
          failedChecks,
          aiScore: entity.anomalyScore,
          aiConfidence: entity.confidenceScore,
          aiExplanation: entity.generativeExplanation?.summary ?? null,
          finalDecision,
        },
        rawObservationData: observation ? {
          value: observation.value,
          flag: observation.flag,
          qcStatus: observation.qcStatus,
          comment: observation.comment,
          deleted: observation.deleted,
        } : null,
        ruleBasedQcResults: observation ? {
          status: observation.qcStatus,
          failedChecks,
          qcTestLog: observation.qcTestLog ?? [],
        } : null,
        mlAnomalyOutputs: {
          modelId: entity.modelId,
          modelName: entity.modelFamily,
          modelFamily: entity.modelFamily,
          modelVersion: entity.modelVersion,
          anomalyStatus: entity.outcome,
          anomalyScore: entity.anomalyScore,
          confidenceScore: entity.confidenceScore,
          confidence: entity.confidenceScore,
          finalDecision: entity.outcome,
          explanation: entity.generativeExplanation?.summary ?? null,
          severity: entity.severity,
          contributingSignals: entity.contributingSignals ?? [],
          featureSnapshot: entity.featureSnapshot,
        },
        reviewerControls: observation ? {
          finalDecision,
          reviewerComment: observation.comment,
          availableActions: [
            'accept_observation',
            'mark_suspect',
            'fail_observation',
            'add_reviewer_comment',
          ],
        } : null,
        createdByUserId: entity.createdByUserId,
        createdAt: entity.createdAt.toISOString(),
      };
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

  private extractFailedChecks(observation: ObservationEntity | null): string[] {
    if (!observation?.qcTestLog) {
      return [];
    }

    return observation.qcTestLog
      .filter((item) => item.qcStatus === QCStatusEnum.FAILED)
      .map((item) => `QC Test ${item.qcTestId}`);
  }

  private buildFinalDecision(observation: ObservationEntity | null): string {
    if (!observation) {
      return 'pending_reviewer_decision';
    }

    if (observation.deleted) {
      return 'deleted';
    }

    if (observation.flag === FlagEnum.DUBIOUS) {
      return 'marked_dubious';
    }

    if (observation.qcStatus === QCStatusEnum.PASSED) {
      return 'accepted';
    }

    if (observation.qcStatus === QCStatusEnum.FAILED) {
      return 'pending_reviewer_decision';
    }

    if (observation.flag) {
      return `flagged_${observation.flag}`;
    }

    return 'pending_reviewer_decision';
  }
}
