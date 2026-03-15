import { Injectable } from '@nestjs/common';
import { ObservationEntity } from 'src/observation/entities/observation.entity';
import { ObservationAnomalyOutcomeEnum, ObservationAnomalySeverityEnum } from '../entities/observation-anomaly-assessment.entity';
import { AnomalyFeatureBuilderService, ObservationAnomalyFeatureSet } from './anomaly-feature-builder.service';
import { AnomalyModelRegistryService } from './anomaly-model-registry.service';
import { NumberUtils } from 'src/shared/utils/number.utils';

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
  private readonly minimumHistoryCount = 5;

  constructor(
    private featureBuilderService: AnomalyFeatureBuilderService,
    private modelRegistryService: AnomalyModelRegistryService,
  ) { }

  public async detectObservationAnomaly(observation: ObservationEntity): Promise<ObservationAnomalyDetectionResult> {
    const featureSet: ObservationAnomalyFeatureSet = await this.featureBuilderService.buildFeatures(observation);
    const model = this.modelRegistryService.resolveModel(observation);
    const reasons: string[] = [];

    if (observation.value === null) {
      reasons.push('Observation value is null, anomaly scoring skipped');
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
        reasons,
        featureSnapshot: featureSet.features,
      };
    }

    const rollingHistoryCount = this.getNumericFeature(featureSet.features.rollingHistoryCount);
    const rollingZScore = this.getNumericFeature(featureSet.features.rollingZScore);
    const seasonalHistoryCount = this.getNumericFeature(featureSet.features.seasonalHistoryCount);
    const seasonalZScore = this.getNumericFeature(featureSet.features.seasonalZScore);

    const usableScores: number[] = [];

    if (rollingHistoryCount !== null && rollingHistoryCount >= this.minimumHistoryCount && rollingZScore !== null) {
      usableScores.push(Math.abs(rollingZScore));
      reasons.push(`Rolling z-score ${NumberUtils.roundOff(rollingZScore, 2)} using ${rollingHistoryCount} prior observations`);
    }

    if (seasonalHistoryCount !== null && seasonalHistoryCount >= this.minimumHistoryCount && seasonalZScore !== null) {
      usableScores.push(Math.abs(seasonalZScore));
      reasons.push(`Seasonal z-score ${NumberUtils.roundOff(seasonalZScore, 2)} using ${seasonalHistoryCount} same-month observations`);
    }

    if (usableScores.length === 0) {
      reasons.push('Insufficient historical data for rolling or seasonal baseline');
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
        reasons,
        featureSnapshot: featureSet.features,
      };
    }

    const strongestDeviation = Math.max(...usableScores);
    const anomalyScore = this.computeAnomalyScore(strongestDeviation);
    const severity = this.mapSeverity(anomalyScore);
    const outcome = this.mapOutcome(severity);

    if (outcome === ObservationAnomalyOutcomeEnum.PASSED) {
      reasons.push('Deviation is within the expected historical range');
    } else if (outcome === ObservationAnomalyOutcomeEnum.SUSPECT) {
      reasons.push('Deviation exceeds baseline enough to warrant review');
    } else if (outcome === ObservationAnomalyOutcomeEnum.FAILED) {
      reasons.push('Deviation is far outside the recent or seasonal baseline');
    }

    return {
      stationId: observation.stationId,
      elementId: observation.elementId,
      level: observation.level,
      interval: observation.interval,
      sourceId: observation.sourceId,
      datetime: observation.datetime.toISOString(),
      modelId: model.modelId,
      modelVersion: model.modelVersion,
      anomalyScore,
      severity,
      outcome,
      reasons,
      featureSnapshot: featureSet.features,
    };
  }

  private getNumericFeature(featureValue: number | string | null | undefined): number | null {
    if (typeof featureValue === 'number' && Number.isFinite(featureValue)) {
      return featureValue;
    }

    return null;
  }

  private computeAnomalyScore(absZScore: number): number {
    if (!Number.isFinite(absZScore) || absZScore <= 0) {
      return 0;
    }

    return NumberUtils.roundOff(Math.min(absZScore / 6, 1), 4);
  }

  private mapSeverity(anomalyScore: number): ObservationAnomalySeverityEnum {
    if (anomalyScore >= 0.8) {
      return ObservationAnomalySeverityEnum.HIGH;
    }

    if (anomalyScore >= 0.5) {
      return ObservationAnomalySeverityEnum.MEDIUM;
    }

    return ObservationAnomalySeverityEnum.LOW;
  }

  private mapOutcome(severity: ObservationAnomalySeverityEnum): ObservationAnomalyOutcomeEnum {
    switch (severity) {
      case ObservationAnomalySeverityEnum.HIGH:
        return ObservationAnomalyOutcomeEnum.FAILED;
      case ObservationAnomalySeverityEnum.MEDIUM:
        return ObservationAnomalyOutcomeEnum.SUSPECT;
      default:
        return ObservationAnomalyOutcomeEnum.PASSED;
    }
  }
}
