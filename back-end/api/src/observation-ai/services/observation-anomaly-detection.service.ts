import { Injectable } from '@nestjs/common';
import { ObservationEntity } from 'src/observation/entities/observation.entity';
import {
  ObservationAnomalyOutcomeEnum,
  ObservationAnomalySeverityEnum,
  ObservationMlContributingSignal,
} from '../entities/observation-anomaly-assessment.entity';
import { AnomalyFeatureBuilderService, ObservationAnomalyFeatureSet } from './anomaly-feature-builder.service';
import { AnomalyModelRegistryService } from './anomaly-model-registry.service';
import { NumberUtils } from 'src/shared/utils/number.utils';
import { AnomalyBaselineModelService, BaselineModelScore } from './anomaly-baseline-model.service';

export interface ObservationAnomalyDetectionResult {
  stationId: string;
  elementId: number;
  level: number;
  interval: number;
  sourceId: number;
  datetime: string;
  modelId: string;
  modelFamily: string;
  modelVersion: string;
  confidenceScore: number;
  anomalyScore: number;
  severity: ObservationAnomalySeverityEnum;
  outcome: ObservationAnomalyOutcomeEnum;
  reasons: string[];
  featureSnapshot: Record<string, number | string | null>;
  contributingSignals: ObservationMlContributingSignal[];
}

@Injectable()
export class ObservationAnomalyDetectionService {
  private readonly minimumHistoryCount = 5;

  constructor(
    private featureBuilderService: AnomalyFeatureBuilderService,
    private modelRegistryService: AnomalyModelRegistryService,
    private baselineModelService: AnomalyBaselineModelService,
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
        modelFamily: model.modelFamily,
        modelVersion: model.modelVersion,
        confidenceScore: 0,
        anomalyScore: 0,
        severity: ObservationAnomalySeverityEnum.LOW,
        outcome: ObservationAnomalyOutcomeEnum.NOT_APPLICABLE,
        reasons,
        featureSnapshot: featureSet.features,
        contributingSignals: [],
      };
    }

    const trainedModelScores = this.modelRegistryService.scoreWithRegisteredModels(observation, featureSet.features, this.baselineModelService);
    if (trainedModelScores.length > 0) {
      return this.buildTrainedModelResult(observation, featureSet, trainedModelScores);
    }

    const rollingHistoryCount = this.getNumericFeature(featureSet.features.rollingHistoryCount);
    const rollingZScore = this.getNumericFeature(featureSet.features.rollingZScore);
    const seasonalHistoryCount = this.getNumericFeature(featureSet.features.seasonalHistoryCount);
    const seasonalZScore = this.getNumericFeature(featureSet.features.seasonalZScore);

    const contributingSignals: ObservationMlContributingSignal[] = [];
    const usableScores: number[] = [];

    if (rollingHistoryCount !== null && rollingHistoryCount >= this.minimumHistoryCount && rollingZScore !== null) {
      const score = this.normalizeZScore(rollingZScore);
      usableScores.push(score);
      contributingSignals.push(this.buildSignal(
        'rolling_z_score',
        'rollingZScore',
        rollingZScore,
        0,
        score,
      ));
      reasons.push(`Rolling z-score ${NumberUtils.roundOff(rollingZScore, 2)} using ${rollingHistoryCount} prior observations`);
    }

    if (seasonalHistoryCount !== null && seasonalHistoryCount >= this.minimumHistoryCount && seasonalZScore !== null) {
      const score = this.normalizeZScore(seasonalZScore);
      usableScores.push(score);
      contributingSignals.push(this.buildSignal(
        'seasonal_z_score',
        'seasonalZScore',
        seasonalZScore,
        0,
        score,
      ));
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
        modelFamily: model.modelFamily,
        modelVersion: model.modelVersion,
        confidenceScore: 0.15,
        anomalyScore: 0,
        severity: ObservationAnomalySeverityEnum.LOW,
        outcome: ObservationAnomalyOutcomeEnum.NOT_APPLICABLE,
        reasons,
        featureSnapshot: featureSet.features,
        contributingSignals,
      };
    }

    const anomalyScore = this.computeEnsembleScore(usableScores);
    const confidenceScore = this.computeConfidenceScore(rollingHistoryCount, seasonalHistoryCount, contributingSignals);
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
      modelFamily: model.modelFamily,
      modelVersion: model.modelVersion,
      confidenceScore,
      anomalyScore,
      severity,
      outcome,
      reasons,
      featureSnapshot: featureSet.features,
      contributingSignals: contributingSignals.sort((left, right) => right.contributionScore - left.contributionScore),
    };
  }

  private getNumericFeature(featureValue: number | string | null | undefined): number | null {
    if (typeof featureValue === 'number' && Number.isFinite(featureValue)) {
      return featureValue;
    }

    return null;
  }

  private buildTrainedModelResult(
    observation: ObservationEntity,
    featureSet: ObservationAnomalyFeatureSet,
    modelScores: BaselineModelScore[],
  ): ObservationAnomalyDetectionResult {
    const anomalyScore = NumberUtils.roundOff(modelScores.reduce((sum, score) => sum + score.anomalyScore, 0) / modelScores.length, 4);
    const confidenceScore = NumberUtils.roundOff(modelScores.reduce((sum, score) => sum + score.confidence, 0) / modelScores.length, 4);
    const strongestScore = modelScores.reduce((strongest, score) => score.anomalyScore > strongest.anomalyScore ? score : strongest, modelScores[0]);
    const severity = this.mapSeverity(anomalyScore);
    const outcome = this.mapOutcome(severity);
    const contributingSignals = modelScores.map((score) => this.buildSignal(
      score.modelName,
      'trained_baseline_distance',
      score.anomalyScore,
      0,
      score.anomalyScore,
    ));

    return {
      stationId: observation.stationId,
      elementId: observation.elementId,
      level: observation.level,
      interval: observation.interval,
      sourceId: observation.sourceId,
      datetime: observation.datetime.toISOString(),
      modelId: strongestScore.modelId,
      modelFamily: 'trained_baseline_ensemble',
      modelVersion: strongestScore.modelVersion,
      confidenceScore,
      anomalyScore,
      severity,
      outcome,
      reasons: [
        ...modelScores.map((score) => score.explanation),
        `Final decision ${outcome} from ${modelScores.length} trained baseline model(s)`,
      ],
      featureSnapshot: featureSet.features,
      contributingSignals: contributingSignals.sort((left, right) => right.contributionScore - left.contributionScore),
    };
  }

  private normalizeZScore(zScore: number): number {
    if (!Number.isFinite(zScore)) {
      return 0;
    }

    return NumberUtils.roundOff(Math.min(Math.abs(zScore) / 6, 1), 4);
  }

  private computeEnsembleScore(scores: number[]): number {
    if (!scores.length) {
      return 0;
    }

    const weightedAverage = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const strongestSignal = Math.max(...scores);

    return NumberUtils.roundOff(Math.min((weightedAverage * 0.6) + (strongestSignal * 0.4), 1), 4);
  }

  private computeConfidenceScore(
    rollingHistoryCount: number | null,
    seasonalHistoryCount: number | null,
    contributingSignals: ObservationMlContributingSignal[],
  ): number {
    const rollingCoverage = rollingHistoryCount === null ? 0 : Math.min(rollingHistoryCount / 30, 1);
    const seasonalCoverage = seasonalHistoryCount === null ? 0 : Math.min(seasonalHistoryCount / 60, 1);
    const signalStrength = contributingSignals.length === 0
      ? 0
      : contributingSignals.reduce((sum, signal) => sum + signal.contributionScore, 0) / contributingSignals.length;

    return NumberUtils.roundOff(Math.min((rollingCoverage * 0.35) + (seasonalCoverage * 0.35) + (signalStrength * 0.3), 1), 4);
  }

  private buildSignal(
    signal: string,
    feature: string,
    observedValue: number,
    expectedValue: number | null,
    contributionScore: number,
  ): ObservationMlContributingSignal {
    return {
      signal,
      feature,
      observedValue: NumberUtils.roundOff(observedValue, 4),
      expectedValue,
      contributionScore: NumberUtils.roundOff(contributionScore, 4),
      direction: observedValue > 0 ? 'higher' : observedValue < 0 ? 'lower' : 'neutral',
    };
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
