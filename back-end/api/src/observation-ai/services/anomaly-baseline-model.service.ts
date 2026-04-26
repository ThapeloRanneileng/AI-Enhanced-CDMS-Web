import { Injectable } from '@nestjs/common';
import { NumberUtils } from 'src/shared/utils/number.utils';
import { AnomalyTrainingFeatureRow } from './anomaly-training-data-preparation.service';

export type BaselineModelFamily = 'isolation_forest' | 'one_class_svm';

export const ANOMALY_FEATURE_NAMES = [
  'value',
  'previousValue',
  'differenceFromPrevious',
  'rollingMean',
  'rollingStdDev',
  'rollingZScore',
  'month',
  'season',
  'hour',
] as const;

export type AnomalyFeatureName = typeof ANOMALY_FEATURE_NAMES[number];
export type AnomalyFeatureVector = Record<AnomalyFeatureName, number>;

export interface BaselineModelMetadata {
  modelName: BaselineModelFamily;
  modelVersion: string;
  supportedElementId: number;
  supportedInterval: number;
  supportedLevel: number;
  stationId: string;
  trainingRange: {
    from: string;
    to: string;
  };
  trainingDatasetKind: 'shared_observation' | 'proxy_public';
  trainingRows: number;
  featureNames: AnomalyFeatureName[];
}

export interface TrainedBaselineModel {
  modelId: string;
  metadata: BaselineModelMetadata;
  featureMeans: AnomalyFeatureVector;
  featureStdDevs: AnomalyFeatureVector;
  centroid: AnomalyFeatureVector;
  threshold: number;
}

export interface PersistedBaselineModelState {
  featureMeans: AnomalyFeatureVector;
  featureStdDevs: AnomalyFeatureVector;
  centroid: AnomalyFeatureVector;
  threshold: number;
}

export interface BaselineModelScore {
  modelId: string;
  modelName: BaselineModelFamily;
  modelVersion: string;
  anomalyScore: number;
  confidence: number;
  explanation: string;
}

@Injectable()
export class AnomalyBaselineModelService {
  public train(modelName: BaselineModelFamily, rows: AnomalyTrainingFeatureRow[], modelVersion: string): TrainedBaselineModel | null {
    if (rows.length < 8) {
      return null;
    }

    const vectors = rows.map((row) => this.toFeatureVector(row));
    const featureMeans = this.computeFeatureMeans(vectors);
    const featureStdDevs = this.computeFeatureStdDevs(vectors, featureMeans);
    const normalizedVectors = vectors.map((vector) => this.normalize(vector, featureMeans, featureStdDevs));
    const centroid = this.computeFeatureMeans(normalizedVectors);
    const distances = normalizedVectors.map((vector) => this.distance(vector, centroid));
    const threshold = this.quantile(distances, modelName === 'isolation_forest' ? 0.9 : 0.85);
    const firstRow = rows[0];
    const lastRow = rows[rows.length - 1];

    return {
      modelId: `${modelName}-${firstRow.stationId}-${firstRow.elementId}-${firstRow.interval}-${firstRow.level}`,
      metadata: {
        modelName,
        modelVersion,
        supportedElementId: firstRow.elementId,
        supportedInterval: firstRow.interval,
        supportedLevel: firstRow.level,
        stationId: firstRow.stationId,
        trainingRange: {
          from: firstRow.observationDatetime,
          to: lastRow.observationDatetime,
        },
        trainingDatasetKind: 'shared_observation',
        trainingRows: rows.length,
        featureNames: [...ANOMALY_FEATURE_NAMES],
      },
      featureMeans,
      featureStdDevs,
      centroid,
      threshold: threshold > 0 ? threshold : 1,
    };
  }

  public score(model: TrainedBaselineModel, features: Record<string, number | string | null>): BaselineModelScore {
    const vector = this.toFeatureVector(features);
    const normalizedVector = this.normalize(vector, model.featureMeans, model.featureStdDevs);
    const distance = this.distance(normalizedVector, model.centroid);
    const ratio = distance / model.threshold;
    const anomalyScore = model.metadata.modelName === 'isolation_forest'
      ? this.scoreIsolationForestProxy(ratio)
      : this.scoreOneClassSvmProxy(ratio);

    return {
      modelId: model.modelId,
      modelName: model.metadata.modelName,
      modelVersion: model.metadata.modelVersion,
      anomalyScore,
      confidence: NumberUtils.roundOff(Math.min(model.metadata.trainingRows / 200, 1), 4),
      explanation: `${model.metadata.modelName} distance ratio ${NumberUtils.roundOff(ratio, 3)} using ${model.metadata.trainingRows} training rows`,
    };
  }

  public toPersistedState(model: TrainedBaselineModel): PersistedBaselineModelState {
    return {
      featureMeans: model.featureMeans,
      featureStdDevs: model.featureStdDevs,
      centroid: model.centroid,
      threshold: model.threshold,
    };
  }

  public fromPersistedState(modelId: string, metadata: BaselineModelMetadata, state: PersistedBaselineModelState): TrainedBaselineModel {
    return {
      modelId,
      metadata,
      featureMeans: state.featureMeans,
      featureStdDevs: state.featureStdDevs,
      centroid: state.centroid,
      threshold: state.threshold,
    };
  }

  private toFeatureVector(row: Partial<AnomalyTrainingFeatureRow> | Record<string, number | string | null>): AnomalyFeatureVector {
    const vector = {} as AnomalyFeatureVector;
    for (const featureName of ANOMALY_FEATURE_NAMES) {
      const value = row[featureName as keyof typeof row];
      vector[featureName] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }

    return vector;
  }

  private normalize(vector: AnomalyFeatureVector, means: AnomalyFeatureVector, stdDevs: AnomalyFeatureVector): AnomalyFeatureVector {
    const normalized = {} as AnomalyFeatureVector;
    for (const featureName of ANOMALY_FEATURE_NAMES) {
      normalized[featureName] = (vector[featureName] - means[featureName]) / (stdDevs[featureName] || 1);
    }

    return normalized;
  }

  private computeFeatureMeans(vectors: AnomalyFeatureVector[]): AnomalyFeatureVector {
    const means = {} as AnomalyFeatureVector;
    for (const featureName of ANOMALY_FEATURE_NAMES) {
      means[featureName] = vectors.reduce((sum, vector) => sum + vector[featureName], 0) / vectors.length;
    }

    return means;
  }

  private computeFeatureStdDevs(vectors: AnomalyFeatureVector[], means: AnomalyFeatureVector): AnomalyFeatureVector {
    const stdDevs = {} as AnomalyFeatureVector;
    for (const featureName of ANOMALY_FEATURE_NAMES) {
      const variance = vectors.reduce((sum, vector) => sum + ((vector[featureName] - means[featureName]) ** 2), 0) / vectors.length;
      stdDevs[featureName] = Math.sqrt(variance) || 1;
    }

    return stdDevs;
  }

  private distance(left: AnomalyFeatureVector, right: AnomalyFeatureVector): number {
    const sumSquares = ANOMALY_FEATURE_NAMES.reduce((sum, featureName) => sum + ((left[featureName] - right[featureName]) ** 2), 0);
    return Math.sqrt(sumSquares / ANOMALY_FEATURE_NAMES.length);
  }

  private quantile(values: number[], quantile: number): number {
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * quantile)));
    return sorted[index] ?? 1;
  }

  private scoreIsolationForestProxy(distanceRatio: number): number {
    return NumberUtils.roundOff(Math.min(Math.max((distanceRatio - 0.75) / 1.75, 0), 1), 4);
  }

  private scoreOneClassSvmProxy(distanceRatio: number): number {
    return NumberUtils.roundOff(Math.min(Math.max((distanceRatio - 0.85) / 1.5, 0), 1), 4);
  }
}
