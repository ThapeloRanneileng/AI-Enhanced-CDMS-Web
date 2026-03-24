import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ObservationAnomalyAssessmentTypeEnum } from '../entities/observation-anomaly-assessment.entity';
import { ObservationAnomalyAssessmentService } from './observation-anomaly-assessment.service';
import { ObservationsSavedEvent } from 'src/observation/events/observations-saved.event';

@Injectable()
export class ObservationAnomalyJobService {
  private readonly logger = new Logger(ObservationAnomalyJobService.name);

  constructor(
    private observationAnomalyAssessmentService: ObservationAnomalyAssessmentService,
  ) { }

  @OnEvent('observations.saved')
  async handleObservationsSaved(event: ObservationsSavedEvent) {
    const observationKeys = event?.observationKeys ?? [];
    this.logger.log(`Received observations.saved event for ${observationKeys.length} observation(s)`);
    if (observationKeys.length > 0) {
      this.logger.debug(`observations.saved first key at listener: ${JSON.stringify({
        ...observationKeys[0],
        datetime: observationKeys[0].datetime.toISOString(),
      })}`);
    }

    for (const key of observationKeys) {
      await this.observationAnomalyAssessmentService.assessObservationByKey(key, ObservationAnomalyAssessmentTypeEnum.INGESTION);
    }
  }

  @OnEvent('observations.quality-controlled')
  async handleObservationsQualityControlled() {
    this.logger.log('Received observations.quality-controlled event for ML anomaly detection and generative review assistance follow-up');
  }
}
