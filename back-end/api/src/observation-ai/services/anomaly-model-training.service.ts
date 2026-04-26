import { Injectable } from '@nestjs/common';
import { AnomalyTrainingDatasetRequest, AnomalyTrainingDataPreparationService, AnomalyTrainingFeatureRow } from './anomaly-training-data-preparation.service';
import { AnomalyProxyTrainingSourceService, ProxyTrainingSourceDescriptor } from './anomaly-proxy-training-source.service';
import { AnomalyBaselineModelService, BaselineModelFamily, TrainedBaselineModel } from './anomaly-baseline-model.service';
import { AnomalyModelRegistryService } from './anomaly-model-registry.service';
import { AnomalyModelPersistenceService } from './anomaly-model-persistence.service';

export interface AnomalyTrainingPlan {
  datasetRows: number;
  featureSchemaVersion: string;
  candidateModelFamilies: string[];
  groupingStrategy: string[];
  supportedProxySources: ProxyTrainingSourceDescriptor[];
  status: 'ready_for_training' | 'insufficient_data';
}

export interface AnomalyTrainingRunResult extends AnomalyTrainingPlan {
  trainingRunId: number;
  trainedModels: {
    modelId: string;
    modelName: string;
    modelVersion: string;
    stationId: string;
    elementId: number;
    interval: number;
    level: number;
    trainingRows: number;
    trainingRange: { from: string; to: string };
    trainingDatasetKind: string;
  }[];
}

@Injectable()
export class AnomalyModelTrainingService {
  private readonly minimumRowsForTraining = 8;

  constructor(
    private trainingDataPreparationService: AnomalyTrainingDataPreparationService,
    private proxyTrainingSourceService: AnomalyProxyTrainingSourceService,
    private baselineModelService: AnomalyBaselineModelService,
    private modelRegistryService: AnomalyModelRegistryService,
    private modelPersistenceService: AnomalyModelPersistenceService,
  ) { }

  public async prepareTrainingPlan(request: AnomalyTrainingDatasetRequest): Promise<AnomalyTrainingPlan> {
    const dataset = await this.trainingDataPreparationService.prepareFeatureDataset(request);

    return {
      datasetRows: dataset.length,
      featureSchemaVersion: 'observation-anomaly-features.v1',
      candidateModelFamilies: [
        'seasonal_gaussian_ensemble',
        'isolation_forest',
        'one_class_svm',
      ],
      groupingStrategy: [
        'element',
        'interval',
        'level',
        'station_or_station_group',
      ],
      supportedProxySources: this.proxyTrainingSourceService.listProxySources(),
      status: dataset.length >= this.minimumRowsForTraining ? 'ready_for_training' : 'insufficient_data',
    };
  }

  public async trainBaselineModels(request: AnomalyTrainingDatasetRequest): Promise<AnomalyTrainingRunResult> {
    const featureRows = await this.trainingDataPreparationService.prepareFeatureDataset(request);
    const plan = await this.prepareTrainingPlan(request);
    const groups = this.groupFeatureRows(featureRows);
    const modelFamilies: BaselineModelFamily[] = ['isolation_forest', 'one_class_svm'];
    const modelVersion = `baseline-${new Date().toISOString().substring(0, 10)}`;
    const trainedModels: AnomalyTrainingRunResult['trainedModels'] = [];
    const trainedBaselineModels: TrainedBaselineModel[] = [];

    for (const groupRows of groups.values()) {
      if (groupRows.length < this.minimumRowsForTraining) {
        continue;
      }

      for (const modelFamily of modelFamilies) {
        const trainedModel = this.baselineModelService.train(modelFamily, groupRows, modelVersion);
        if (!trainedModel) {
          continue;
        }

        this.modelRegistryService.registerModel(trainedModel);
        trainedBaselineModels.push(trainedModel);
        trainedModels.push({
          modelId: trainedModel.modelId,
          modelName: trainedModel.metadata.modelName,
          modelVersion: trainedModel.metadata.modelVersion,
          stationId: trainedModel.metadata.stationId,
          elementId: trainedModel.metadata.supportedElementId,
          interval: trainedModel.metadata.supportedInterval,
          level: trainedModel.metadata.supportedLevel,
          trainingRows: trainedModel.metadata.trainingRows,
          trainingRange: trainedModel.metadata.trainingRange,
          trainingDatasetKind: trainedModel.metadata.trainingDatasetKind,
        });
      }
    }

    const persistedRun = await this.modelPersistenceService.saveTrainingRun(
      request,
      trainedBaselineModels,
      plan.featureSchemaVersion,
      trainedModels.length > 0 ? 'completed' : 'insufficient_data',
    );

    return {
      ...plan,
      trainedModels,
      trainingRunId: persistedRun.id,
      status: trainedModels.length > 0 ? 'ready_for_training' : 'insufficient_data',
    };
  }

  private groupFeatureRows(rows: AnomalyTrainingFeatureRow[]): Map<string, AnomalyTrainingFeatureRow[]> {
    const groups = new Map<string, AnomalyTrainingFeatureRow[]>();
    for (const row of rows) {
      const key = `${row.stationId}|${row.elementId}|${row.interval}|${row.level}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }

    return groups;
  }
}
