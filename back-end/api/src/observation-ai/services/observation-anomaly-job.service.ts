import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ObservationAnomalyAssessmentTypeEnum } from '../entities/observation-anomaly-assessment.entity';
import { AnomalyFeatureBuilderService } from './anomaly-feature-builder.service';
import { ObservationAnomalyAssessmentService } from './observation-anomaly-assessment.service';

@Injectable()
export class ObservationAnomalyJobService {
  private readonly logger = new Logger(ObservationAnomalyJobService.name);

  constructor(
    private featureBuilderService: AnomalyFeatureBuilderService,
    private observationAnomalyAssessmentService: ObservationAnomalyAssessmentService,
  ) { }

  @OnEvent('observations.saved')
  async handleObservationsSaved() {
    this.logger.log('Received observations.saved event for AI anomaly assessment');

    // Placeholder event handling until the save flow emits explicit observation keys.
    const recentKeys = await this.featureBuilderService.findObservationKeysForRecentIngestion(25);
    for (const key of recentKeys) {
      await this.observationAnomalyAssessmentService.assessObservationByKey(key, ObservationAnomalyAssessmentTypeEnum.INGESTION);
    }
  }

  @OnEvent('observations.quality-controlled')
  async handleObservationsQualityControlled() {
    this.logger.log('Received observations.quality-controlled event for AI anomaly follow-up');
  }
}
