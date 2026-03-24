import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { ObservationEntity } from 'src/observation/entities/observation.entity';
import { ObservationAnomalyAssessmentEntity, ObservationAnomalyAssessmentTypeEnum } from '../entities/observation-anomaly-assessment.entity';
import { ObservationAnomalyDetectionResult, ObservationAnomalyDetectionService } from './observation-anomaly-detection.service';
import { ObservationGenerativeReviewAssistanceService } from './observation-generative-review-assistance.service';

@Injectable()
export class ObservationAnomalyAssessmentService {
  private readonly logger = new Logger(ObservationAnomalyAssessmentService.name);

  constructor(
    @InjectRepository(ObservationEntity) private observationRepo: Repository<ObservationEntity>,
    @InjectRepository(ObservationAnomalyAssessmentEntity) private anomalyAssessmentRepo: Repository<ObservationAnomalyAssessmentEntity>,
    private observationAnomalyDetectionService: ObservationAnomalyDetectionService,
    private observationGenerativeReviewAssistanceService: ObservationGenerativeReviewAssistanceService,
    private eventEmitter: EventEmitter2,
  ) { }

  public async assessObservation(
    observation: ObservationEntity,
    assessmentType: ObservationAnomalyAssessmentTypeEnum,
    userId: number | null = null,
  ): Promise<ObservationAnomalyAssessmentEntity> {
    const detectionResult: ObservationAnomalyDetectionResult = await this.observationAnomalyDetectionService.detectObservationAnomaly(observation);
    const generativeExplanation = this.observationGenerativeReviewAssistanceService.generateExplanation(observation, detectionResult);
    const assessment = this.anomalyAssessmentRepo.create({
      stationId: observation.stationId,
      elementId: observation.elementId,
      level: observation.level,
      datetime: observation.datetime,
      interval: observation.interval,
      sourceId: observation.sourceId,
      assessmentType,
      modelId: detectionResult.modelId,
      modelFamily: detectionResult.modelFamily,
      modelVersion: detectionResult.modelVersion,
      anomalyScore: detectionResult.anomalyScore,
      confidenceScore: detectionResult.confidenceScore,
      severity: detectionResult.severity,
      outcome: detectionResult.outcome,
      reasons: detectionResult.reasons,
      featureSnapshot: detectionResult.featureSnapshot,
      contributingSignals: detectionResult.contributingSignals,
      generativeExplanation,
      createdByUserId: userId,
    });

    const savedAssessment = await this.anomalyAssessmentRepo.save(assessment);
    this.logger.log(`Saved anomaly assessment row ${savedAssessment.id} for ${savedAssessment.stationId}/${savedAssessment.elementId}/${savedAssessment.datetime.toISOString()}`);
    this.eventEmitter.emit('observations.ml-anomaly-assessed');
    this.eventEmitter.emit('observations.ai-quality-controlled');

    return savedAssessment;
  }

  public async assessObservationByKey(
    key: Pick<ObservationEntity, "stationId" | "elementId" | "level" | "datetime" | "interval" | "sourceId">,
    assessmentType: ObservationAnomalyAssessmentTypeEnum,
    userId: number | null = null,
  ): Promise<ObservationAnomalyAssessmentEntity | null> {
    this.logger.debug(`Attempting anomaly assessment lookup for key ${JSON.stringify({
      ...key,
      datetime: key.datetime.toISOString(),
    })}`);
    const observation = await this.observationRepo.findOneBy(key);

    if (!observation) {
      const nearbyObservations = await this.observationRepo.find({
        where: {
          stationId: key.stationId,
          elementId: key.elementId,
          level: key.level,
          interval: key.interval,
          sourceId: key.sourceId,
        },
        order: {
          datetime: 'DESC',
        },
        take: 3,
      });
      const nearbyObservationDiagnostics = nearbyObservations.map((candidate) => ({
        datetime: candidate.datetime.toISOString(),
        deltaMsFromEventKey: candidate.datetime.getTime() - key.datetime.getTime(),
      }));

      this.logger.warn(`Skipping anomaly assessment. Observation not found for ${key.stationId}/${key.elementId}/${key.datetime.toISOString()}`);
      this.logger.warn(`Anomaly lookup diagnostics: ${JSON.stringify({
        stationId: key.stationId,
        elementId: key.elementId,
        level: key.level,
        interval: key.interval,
        sourceId: key.sourceId,
        requestedDatetimeIso: key.datetime.toISOString(),
        requestedDatetimeEpochMs: key.datetime.getTime(),
        nearbyObservations: nearbyObservationDiagnostics,
      })}`);
      return null;
    }

    this.logger.debug(`Observation found for anomaly assessment key with datetime ${observation.datetime.toISOString()}`);
    return this.assessObservation(observation, assessmentType, userId);
  }
}
