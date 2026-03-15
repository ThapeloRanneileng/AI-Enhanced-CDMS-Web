import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { ObservationEntity } from 'src/observation/entities/observation.entity';
import { ObservationAnomalyAssessmentEntity, ObservationAnomalyAssessmentTypeEnum } from '../entities/observation-anomaly-assessment.entity';
import { ObservationAnomalyDetectionResult, ObservationAnomalyDetectionService } from './observation-anomaly-detection.service';

@Injectable()
export class ObservationAnomalyAssessmentService {
  private readonly logger = new Logger(ObservationAnomalyAssessmentService.name);

  constructor(
    @InjectRepository(ObservationEntity) private observationRepo: Repository<ObservationEntity>,
    @InjectRepository(ObservationAnomalyAssessmentEntity) private anomalyAssessmentRepo: Repository<ObservationAnomalyAssessmentEntity>,
    private observationAnomalyDetectionService: ObservationAnomalyDetectionService,
    private eventEmitter: EventEmitter2,
  ) { }

  public async assessObservation(
    observation: ObservationEntity,
    assessmentType: ObservationAnomalyAssessmentTypeEnum,
    userId: number | null = null,
  ): Promise<ObservationAnomalyAssessmentEntity> {
    const detectionResult: ObservationAnomalyDetectionResult = await this.observationAnomalyDetectionService.detectObservationAnomaly(observation);
    const assessment = this.anomalyAssessmentRepo.create({
      stationId: observation.stationId,
      elementId: observation.elementId,
      level: observation.level,
      datetime: observation.datetime,
      interval: observation.interval,
      sourceId: observation.sourceId,
      assessmentType,
      modelId: detectionResult.modelId,
      modelVersion: detectionResult.modelVersion,
      anomalyScore: detectionResult.anomalyScore,
      severity: detectionResult.severity,
      outcome: detectionResult.outcome,
      reasons: detectionResult.reasons,
      featureSnapshot: detectionResult.featureSnapshot,
      createdByUserId: userId,
    });

    const savedAssessment = await this.anomalyAssessmentRepo.save(assessment);
    this.eventEmitter.emit('observations.ai-quality-controlled');

    return savedAssessment;
  }

  public async assessObservationByKey(
    key: Pick<ObservationEntity, "stationId" | "elementId" | "level" | "datetime" | "interval" | "sourceId">,
    assessmentType: ObservationAnomalyAssessmentTypeEnum,
    userId: number | null = null,
  ): Promise<ObservationAnomalyAssessmentEntity | null> {
    const observation = await this.observationRepo.findOneBy(key);

    if (!observation) {
      this.logger.warn(`Skipping anomaly assessment. Observation not found for ${key.stationId}/${key.elementId}/${key.datetime.toISOString()}`);
      return null;
    }

    return this.assessObservation(observation, assessmentType, userId);
  }
}
