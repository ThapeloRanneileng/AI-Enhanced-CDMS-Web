import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ObservationAnomalyModelEntity } from '../entities/observation-anomaly-model.entity';
import { ObservationAnomalyTrainingRunEntity, ObservationAnomalyTrainingRunStatus } from '../entities/observation-anomaly-training-run.entity';
import { AnomalyTrainingDatasetRequest } from './anomaly-training-data-preparation.service';
import { ANOMALY_FEATURE_NAMES, AnomalyBaselineModelService, BaselineModelFamily, PersistedBaselineModelState, TrainedBaselineModel } from './anomaly-baseline-model.service';

@Injectable()
export class AnomalyModelPersistenceService {
  constructor(
    @InjectRepository(ObservationAnomalyModelEntity) private modelRepo: Repository<ObservationAnomalyModelEntity>,
    @InjectRepository(ObservationAnomalyTrainingRunEntity) private trainingRunRepo: Repository<ObservationAnomalyTrainingRunEntity>,
    private baselineModelService: AnomalyBaselineModelService,
    private dataSource: DataSource,
  ) { }

  public async ensureTables(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS observation_anomaly_training_runs (
        id SERIAL PRIMARY KEY,
        training_dataset_kind VARCHAR NOT NULL,
        training_range_from TIMESTAMPTZ NULL,
        training_range_to TIMESTAMPTZ NULL,
        training_rows INT NOT NULL,
        feature_schema_version VARCHAR NOT NULL,
        status VARCHAR NOT NULL,
        request_snapshot JSONB NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS observation_anomaly_models (
        id SERIAL PRIMARY KEY,
        training_run_id INT NULL REFERENCES observation_anomaly_training_runs(id) ON DELETE SET NULL,
        model_id VARCHAR NOT NULL,
        model_name VARCHAR NOT NULL,
        model_version VARCHAR NOT NULL,
        station_id VARCHAR NOT NULL,
        element_id INT NOT NULL,
        interval INT NOT NULL,
        level INT NOT NULL,
        training_range_from TIMESTAMPTZ NOT NULL,
        training_range_to TIMESTAMPTZ NOT NULL,
        training_rows INT NOT NULL,
        training_dataset_kind VARCHAR NOT NULL,
        feature_schema_version VARCHAR NOT NULL,
        model_state JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS "IDX_obs_anomaly_training_runs_status" ON observation_anomaly_training_runs (status);`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS "IDX_obs_anomaly_training_runs_created_at" ON observation_anomaly_training_runs (created_at);`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS "IDX_obs_anomaly_model_training_run_id" ON observation_anomaly_models (training_run_id);`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS "IDX_obs_anomaly_model_model_id" ON observation_anomaly_models (model_id);`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS "IDX_obs_anomaly_model_station_id" ON observation_anomaly_models (station_id);`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS "IDX_obs_anomaly_model_element_id" ON observation_anomaly_models (element_id);`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS "IDX_obs_anomaly_model_interval" ON observation_anomaly_models (interval);`);
    await this.dataSource.query(`CREATE INDEX IF NOT EXISTS "IDX_obs_anomaly_model_level" ON observation_anomaly_models (level);`);
    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS "IDX_obs_anomaly_model_lookup"
      ON observation_anomaly_models (station_id, element_id, interval, level, model_name);
    `);
  }

  public async saveTrainingRun(
    request: AnomalyTrainingDatasetRequest,
    models: TrainedBaselineModel[],
    featureSchemaVersion: string,
    status: ObservationAnomalyTrainingRunStatus,
  ): Promise<ObservationAnomalyTrainingRunEntity> {
    const trainingRangeFrom = this.getMinDate(models.map((model) => model.metadata.trainingRange.from));
    const trainingRangeTo = this.getMaxDate(models.map((model) => model.metadata.trainingRange.to));
    const trainingRows = models.reduce((sum, model) => sum + model.metadata.trainingRows, 0);
    const run = await this.trainingRunRepo.save(this.trainingRunRepo.create({
      trainingDatasetKind: 'shared_observation',
      trainingRangeFrom,
      trainingRangeTo,
      trainingRows,
      featureSchemaVersion,
      status,
      requestSnapshot: request as Record<string, unknown>,
    }));

    for (const model of models) {
      await this.saveModel(run.id, model, featureSchemaVersion);
    }

    return run;
  }

  public async loadPersistedModels(): Promise<TrainedBaselineModel[]> {
    await this.ensureTables();
    const latestModels = await this.modelRepo
      .createQueryBuilder('model')
      .distinctOn(['model.stationId', 'model.elementId', 'model.interval', 'model.level', 'model.modelName'])
      .orderBy('model.stationId', 'ASC')
      .addOrderBy('model.elementId', 'ASC')
      .addOrderBy('model.interval', 'ASC')
      .addOrderBy('model.level', 'ASC')
      .addOrderBy('model.modelName', 'ASC')
      .addOrderBy('model.createdAt', 'DESC')
      .getMany();

    return latestModels.map((model) => this.baselineModelService.fromPersistedState(
      model.modelId,
      {
        modelName: model.modelName as BaselineModelFamily,
        modelVersion: model.modelVersion,
        supportedElementId: model.elementId,
        supportedInterval: model.interval,
        supportedLevel: model.level,
        stationId: model.stationId,
        trainingRange: {
          from: model.trainingRangeFrom.toISOString(),
          to: model.trainingRangeTo.toISOString(),
        },
        trainingDatasetKind: model.trainingDatasetKind,
        trainingRows: model.trainingRows,
        featureNames: [...ANOMALY_FEATURE_NAMES],
      },
      model.modelState as unknown as PersistedBaselineModelState,
    ));
  }

  public listTrainingRuns(limit: number = 100): Promise<ObservationAnomalyTrainingRunEntity[]> {
    return this.trainingRunRepo.find({
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 500),
    });
  }

  public listModelMetadata(limit: number = 200): Promise<ObservationAnomalyModelEntity[]> {
    return this.modelRepo.find({
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 1000),
    });
  }

  private async saveModel(trainingRunId: number, model: TrainedBaselineModel, featureSchemaVersion: string): Promise<void> {
    await this.modelRepo.save(this.modelRepo.create({
      trainingRunId,
      modelId: model.modelId,
      modelName: model.metadata.modelName,
      modelVersion: model.metadata.modelVersion,
      stationId: model.metadata.stationId,
      elementId: model.metadata.supportedElementId,
      interval: model.metadata.supportedInterval,
      level: model.metadata.supportedLevel,
      trainingRangeFrom: new Date(model.metadata.trainingRange.from),
      trainingRangeTo: new Date(model.metadata.trainingRange.to),
      trainingRows: model.metadata.trainingRows,
      trainingDatasetKind: model.metadata.trainingDatasetKind,
      featureSchemaVersion,
      modelState: this.baselineModelService.toPersistedState(model) as unknown as Record<string, unknown>,
    }));
  }

  private getMinDate(values: string[]): Date | null {
    if (values.length === 0) return null;
    return new Date(Math.min(...values.map((value) => new Date(value).getTime())));
  }

  private getMaxDate(values: string[]): Date | null {
    if (values.length === 0) return null;
    return new Date(Math.max(...values.map((value) => new Date(value).getTime())));
  }
}
