import { Body, Controller, Get, Post } from '@nestjs/common';
import { AnomalyModelTrainingService } from '../services/anomaly-model-training.service';
import { AnomalyProxyTrainingSourceService } from '../services/anomaly-proxy-training-source.service';
import { AnomalyTrainingDatasetRequest, AnomalyTrainingDataPreparationService } from '../services/anomaly-training-data-preparation.service';
import { AnomalyModelPersistenceService } from '../services/anomaly-model-persistence.service';
import { Admin } from 'src/user/decorators/admin.decorator';

@Admin()
@Controller('observation-ai/training')
export class ObservationAnomalyTrainingController {
  constructor(
    private readonly anomalyTrainingDataPreparationService: AnomalyTrainingDataPreparationService,
    private readonly anomalyModelTrainingService: AnomalyModelTrainingService,
    private readonly anomalyProxyTrainingSourceService: AnomalyProxyTrainingSourceService,
    private readonly anomalyModelPersistenceService: AnomalyModelPersistenceService,
  ) { }

  @Post('dataset-preview')
  public prepareDatasetPreview(@Body() request: AnomalyTrainingDatasetRequest) {
    return this.anomalyTrainingDataPreparationService.prepareDataset({
      ...request,
      limit: Math.min(request.limit ?? 100, 1000),
    });
  }

  @Post('plan')
  public prepareTrainingPlan(@Body() request: AnomalyTrainingDatasetRequest) {
    return this.anomalyModelTrainingService.prepareTrainingPlan(request);
  }

  @Post('run')
  public runTraining(@Body() request: AnomalyTrainingDatasetRequest) {
    return this.anomalyModelTrainingService.trainBaselineModels(request);
  }

  @Get('proxy-sources')
  public listProxySources() {
    return this.anomalyProxyTrainingSourceService.listProxySources();
  }

  @Get('runs')
  public listTrainingRuns() {
    return this.anomalyModelPersistenceService.listTrainingRuns();
  }

  @Get('models')
  public listModels() {
    return this.anomalyModelPersistenceService.listModelMetadata();
  }
}
