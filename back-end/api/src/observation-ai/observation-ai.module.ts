import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ElementEntity } from 'src/metadata/elements/entities/element.entity';
import { StationEntity } from 'src/metadata/stations/entities/station.entity';
import { SourceSpecificationEntity } from 'src/metadata/source-specifications/entities/source-specification.entity';
import { ObservationEntity } from 'src/observation/entities/observation.entity';
import { ObservationAnomalyAssessmentEntity } from './entities/observation-anomaly-assessment.entity';
import { ObservationAnomalyModelEntity } from './entities/observation-anomaly-model.entity';
import { ObservationAnomalyTrainingRunEntity } from './entities/observation-anomaly-training-run.entity';
import { AnomalyFeatureBuilderService } from './services/anomaly-feature-builder.service';
import { AnomalyModelRegistryService } from './services/anomaly-model-registry.service';
import { ObservationAnomalyDetectionService } from './services/observation-anomaly-detection.service';
import { ObservationAnomalyAssessmentService } from './services/observation-anomaly-assessment.service';
import { ObservationAnomalyJobService } from './services/observation-anomaly-job.service';
import { ObservationAnomalyAssessmentsQueryService } from './services/observation-anomaly-assessments-query.service';
import { ObservationAnomalyAssessmentsController } from './controllers/observation-anomaly-assessments.controller';
import { ObservationAnomalyTrainingController } from './controllers/observation-anomaly-training.controller';
import { LmsAiController } from './controllers/lms-ai.controller';
import { UserModule } from 'src/user/user.module';
import { ObservationGenerativeReviewAssistanceService } from './services/observation-generative-review-assistance.service';
import { AnomalyTrainingDataPreparationService } from './services/anomaly-training-data-preparation.service';
import { AnomalyProxyTrainingSourceService } from './services/anomaly-proxy-training-source.service';
import { AnomalyModelTrainingService } from './services/anomaly-model-training.service';
import { AnomalyBaselineModelService } from './services/anomaly-baseline-model.service';
import { AnomalyModelPersistenceService } from './services/anomaly-model-persistence.service';
import { AnomalyModelRegistryLoaderService } from './services/anomaly-model-registry-loader.service';
import { LmsAiOutputService } from './services/lms-ai-output.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ObservationEntity,
      ObservationAnomalyAssessmentEntity,
      ObservationAnomalyModelEntity,
      ObservationAnomalyTrainingRunEntity,
      StationEntity,
      ElementEntity,
      SourceSpecificationEntity,
    ]),
    UserModule,
  ],
  controllers: [
    ObservationAnomalyAssessmentsController,
    ObservationAnomalyTrainingController,
    LmsAiController,
  ],
  providers: [
    AnomalyFeatureBuilderService,
    AnomalyModelRegistryService,
    AnomalyTrainingDataPreparationService,
    AnomalyProxyTrainingSourceService,
    AnomalyBaselineModelService,
    AnomalyModelPersistenceService,
    AnomalyModelRegistryLoaderService,
    AnomalyModelTrainingService,
    ObservationAnomalyDetectionService,
    ObservationGenerativeReviewAssistanceService,
    ObservationAnomalyAssessmentService,
    ObservationAnomalyJobService,
    ObservationAnomalyAssessmentsQueryService,
    LmsAiOutputService,
  ],
  exports: [
    AnomalyFeatureBuilderService,
    AnomalyModelRegistryService,
    AnomalyTrainingDataPreparationService,
    AnomalyProxyTrainingSourceService,
    AnomalyBaselineModelService,
    AnomalyModelPersistenceService,
    AnomalyModelTrainingService,
    ObservationAnomalyDetectionService,
    ObservationGenerativeReviewAssistanceService,
    ObservationAnomalyAssessmentService,
    ObservationAnomalyAssessmentsQueryService,
    LmsAiOutputService,
  ]
})
export class ObservationAiModule { }
