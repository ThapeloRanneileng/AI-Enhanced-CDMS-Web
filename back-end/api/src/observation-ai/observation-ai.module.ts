import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ObservationEntity } from 'src/observation/entities/observation.entity';
import { ObservationAnomalyAssessmentEntity } from './entities/observation-anomaly-assessment.entity';
import { AnomalyFeatureBuilderService } from './services/anomaly-feature-builder.service';
import { AnomalyModelRegistryService } from './services/anomaly-model-registry.service';
import { ObservationAnomalyDetectionService } from './services/observation-anomaly-detection.service';
import { ObservationAnomalyAssessmentService } from './services/observation-anomaly-assessment.service';
import { ObservationAnomalyJobService } from './services/observation-anomaly-job.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ObservationEntity, ObservationAnomalyAssessmentEntity]),
  ],
  providers: [
    AnomalyFeatureBuilderService,
    AnomalyModelRegistryService,
    ObservationAnomalyDetectionService,
    ObservationAnomalyAssessmentService,
    ObservationAnomalyJobService,
  ],
  exports: [
    AnomalyFeatureBuilderService,
    AnomalyModelRegistryService,
    ObservationAnomalyDetectionService,
    ObservationAnomalyAssessmentService,
  ]
})
export class ObservationAiModule { }
