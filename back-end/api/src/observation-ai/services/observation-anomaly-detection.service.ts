import { Injectable } from '@nestjs/common';
import { ObservationEntity } from 'src/observation/entities/observation.entity';
import { ObservationAnomalyOutcomeEnum, ObservationAnomalySeverityEnum } from '../entities/observation-anomaly-assessment.entity';
import { AnomalyFeatureBuilderService, ObservationAnomalyFeatureSet } from './anomaly-feature-builder.service';
import { AnomalyModelRegistryService } from './anomaly-model-registry.service';

export interface ObservationAnomalyDetectionResult {
  stationId: string;
  elementId: number;
  level: number;
  interval: number;
  sourceId: number;
  datetime: string;
  modelId: string;
  modelVersion: string;
  anomalyScore: number;
  severity: ObservationAnomalySeverityEnum;
  outcome: ObservationAnomalyOutcomeEnum;
  reasons: string[];
  featureSnapshot: Record<string, number | string | null>;
}

@Injectable()
export class ObservationAnomalyDetectionService {
  constructor(
    private featureBuilderService: AnomalyFeatureBuilderService,
    private modelRegistryService: AnomalyModelRegistryService,
  ) { }

  public async detectObservationAnomaly(observation: ObservationEntity): Promise<ObservationAnomalyDetectionResult> {
    const featureSet: ObservationAnomalyFeatureSet = await this.featureBuilderService.buildFeatures(observation);
    const model = this.modelRegistryService.resolveModel(observation);

    // Skeleton inference. Replace with actual model loading and scoring.
    return {
      stationId: observation.stationId,
      elementId: observation.elementId,
      level: observation.level,
      interval: observation.interval,
      sourceId: observation.sourceId,
      datetime: observation.datetime.toISOString(),
      modelId: model.modelId,
      modelVersion: model.modelVersion,
      anomalyScore: 0,
      severity: ObservationAnomalySeverityEnum.LOW,
      outcome: ObservationAnomalyOutcomeEnum.NOT_APPLICABLE,
      reasons: ['Model inference not implemented yet'],
      featureSnapshot: featureSet.features,
    };
  }
}
