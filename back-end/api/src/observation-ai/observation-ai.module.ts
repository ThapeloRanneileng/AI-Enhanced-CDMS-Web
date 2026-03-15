import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ObservationEntity } from 'src/observation/entities/observation.entity';
import { ObservationAnomalyAssessmentEntity } from './entities/observation-anomaly-assessment.entity';
import { AnomalyFeatureBuilderService } from './services/anomaly-feature-builder.service';
import { AnomalyModelRegistryService } from './services/anomaly-model-registry.service';
import { ObservationAnomalyDetectionService } from './services/observation-anomaly-detection.service';
import { ObservationAnomalyAssessmentService } from './services/observation-anomaly-assessment.service';
import { ObservationAnomalyJobService } from './services/observation-anomaly-job.service';
import { ObservationAnomalyAssessmentsQueryService } from './services/observation-anomaly-assessments-query.service';
import { ObservationAnomalyAssessmentsController } from './controllers/observation-anomaly-assessments.controller';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ObservationEntity, ObservationAnomalyAssessmentEntity]),
    UserModule,
  ],
  controllers: [
    ObservationAnomalyAssessmentsController,
  ],
  providers: [
    AnomalyFeatureBuilderService,
    AnomalyModelRegistryService,
    ObservationAnomalyDetectionService,
    ObservationAnomalyAssessmentService,
    ObservationAnomalyJobService,
    ObservationAnomalyAssessmentsQueryService,
  ],
  exports: [
    AnomalyFeatureBuilderService,
    AnomalyModelRegistryService,
    ObservationAnomalyDetectionService,
    ObservationAnomalyAssessmentService,
    ObservationAnomalyAssessmentsQueryService,
  ]
})
export class ObservationAiModule { }
