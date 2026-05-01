import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { ObservationEntity } from 'src/observation/entities/observation.entity';
import { ObservationAnomalyAssessmentEntity, ObservationAnomalyAssessmentTypeEnum } from '../entities/observation-anomaly-assessment.entity';
import { ObservationAnomalyDetectionResult, ObservationAnomalyDetectionService } from './observation-anomaly-detection.service';
import { ObservationGenerativeReviewAssistanceService } from './observation-generative-review-assistance.service';
import { ObservationGroqExplanationService } from './observation-groq-explanation.service';

@Injectable()
export class ObservationAnomalyAssessmentService {
  private readonly logger = new Logger(ObservationAnomalyAssessmentService.name);

  constructor(
    @InjectRepository(ObservationEntity) private observationRepo: Repository<ObservationEntity>,
    @InjectRepository(ObservationAnomalyAssessmentEntity) private anomalyAssessmentRepo: Repository<ObservationAnomalyAssessmentEntity>,
    private observationAnomalyDetectionService: ObservationAnomalyDetectionService,
    private observationGenerativeReviewAssistanceService: ObservationGenerativeReviewAssistanceService,
    private observationGroqExplanationService: ObservationGroqExplanationService,
    private eventEmitter: EventEmitter2,
  ) { }

  public async assessObservation(
    observation: ObservationEntity,
    assessmentType: ObservationAnomalyAssessmentTypeEnum,
    userId: number | null = null,
  ): Promise<ObservationAnomalyAssessmentEntity> {
    const detectionResult: ObservationAnomalyDetectionResult = await this.observationAnomalyDetectionService.detectObservationAnomaly(observation);
    const templateExplanation = this.observationGenerativeReviewAssistanceService.generateExplanation(observation, detectionResult);
    const generativeExplanation = await this.observationGroqExplanationService.enrichExplanation(observation, detectionResult, templateExplanation);
    const stationId = observation.stationId.trim();
    const assessment = this.anomalyAssessmentRepo.create({
      stationId,
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
      featureSnapshot: {
        ...detectionResult.featureSnapshot,
        modelAgreementCount: detectionResult.contributingSignals.length,
        provider: 'backend_ml',
      },
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
    const normalizedKey = {
      ...key,
      stationId: key.stationId.trim(),
    };
    this.logger.debug(`Attempting anomaly assessment lookup for key ${JSON.stringify({
      ...normalizedKey,
      datetime: normalizedKey.datetime.toISOString(),
    })}`);
    const observation = await this.observationRepo.findOneBy(normalizedKey);

    if (!observation) {
      const nearbyObservations = await this.observationRepo.find({
        where: {
          stationId: normalizedKey.stationId,
          elementId: normalizedKey.elementId,
          level: normalizedKey.level,
          interval: normalizedKey.interval,
          sourceId: normalizedKey.sourceId,
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

      this.logger.warn(`Skipping anomaly assessment. Observation not found for ${normalizedKey.stationId}/${normalizedKey.elementId}/${normalizedKey.datetime.toISOString()}`);
      this.logger.warn(`Anomaly lookup diagnostics: ${JSON.stringify({
        stationId: normalizedKey.stationId,
        elementId: normalizedKey.elementId,
        level: normalizedKey.level,
        interval: normalizedKey.interval,
        sourceId: normalizedKey.sourceId,
        requestedDatetimeIso: normalizedKey.datetime.toISOString(),
        requestedDatetimeEpochMs: normalizedKey.datetime.getTime(),
        nearbyObservations: nearbyObservationDiagnostics,
      })}`);
      return null;
    }

    this.logger.debug(`Observation found for anomaly assessment key with datetime ${observation.datetime.toISOString()}`);
    return this.assessObservation(observation, assessmentType, userId);
  }
}
