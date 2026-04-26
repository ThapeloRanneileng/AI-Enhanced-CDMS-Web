import { Injectable } from '@nestjs/common';
import { ObservationEntity } from 'src/observation/entities/observation.entity';
import { BaselineModelScore, TrainedBaselineModel } from './anomaly-baseline-model.service';

export interface ObservationAnomalyModelDescriptor {
  modelId: string;
  modelFamily: string;
  modelVersion: string;
  supportsInference: boolean;
  candidateModelFamilies: string[];
  grouping: {
    elementId: number;
    interval: number;
    level: number;
    stationScope: 'station' | 'station_group';
  };
  trainedModels: {
    modelId: string;
    modelName: string;
    modelVersion: string;
    trainingRows: number;
    trainingDatasetKind: string;
    trainingRange: { from: string; to: string };
  }[];
}

@Injectable()
export class AnomalyModelRegistryService {
  private readonly trainedModels = new Map<string, TrainedBaselineModel[]>();

  public resolveModel(observation: ObservationEntity): ObservationAnomalyModelDescriptor {
    const registeredModels = this.getRegisteredModelsForObservation(observation);
    return {
      modelId: `default-${observation.elementId}-${observation.interval}`,
      modelFamily: registeredModels.length > 0 ? 'trained_baseline_ensemble' : 'seasonal_gaussian_ensemble',
      modelVersion: '0.2.0',
      supportsInference: true,
      candidateModelFamilies: [
        'seasonal_gaussian_ensemble',
        'isolation_forest',
        'one_class_svm',
      ],
      grouping: {
        elementId: observation.elementId,
        interval: observation.interval,
        level: observation.level,
        stationScope: 'station',
      },
      trainedModels: registeredModels.map((model) => ({
        modelId: model.modelId,
        modelName: model.metadata.modelName,
        modelVersion: model.metadata.modelVersion,
        trainingRows: model.metadata.trainingRows,
        trainingDatasetKind: model.metadata.trainingDatasetKind,
        trainingRange: model.metadata.trainingRange,
      })),
    };
  }

  public registerModel(model: TrainedBaselineModel): void {
    const groupKey = this.getModelGroupKey(model.metadata.stationId, model.metadata.supportedElementId, model.metadata.supportedInterval, model.metadata.supportedLevel);
    this.trainedModels.set(groupKey, [
      ...(this.trainedModels.get(groupKey) ?? []).filter((item) => item.metadata.modelName !== model.metadata.modelName),
      model,
    ]);
  }

  public listRegisteredModels(): TrainedBaselineModel[] {
    return [...this.trainedModels.values()].flat();
  }

  public scoreWithRegisteredModels(observation: ObservationEntity, features: Record<string, number | string | null>, scorer: { score(model: TrainedBaselineModel, features: Record<string, number | string | null>): BaselineModelScore }): BaselineModelScore[] {
    return this.getRegisteredModelsForObservation(observation).map((model) => scorer.score(model, features));
  }

  private getRegisteredModelsForObservation(observation: ObservationEntity): TrainedBaselineModel[] {
    return this.trainedModels.get(this.getModelGroupKey(observation.stationId, observation.elementId, observation.interval, observation.level)) ?? [];
  }

  private getModelGroupKey(stationId: string, elementId: number, interval: number, level: number): string {
    return `${stationId}|${elementId}|${interval}|${level}`;
  }
}
