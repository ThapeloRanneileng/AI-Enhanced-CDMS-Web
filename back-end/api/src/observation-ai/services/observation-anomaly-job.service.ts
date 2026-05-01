import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { ObservationAnomalyAssessmentEntity, ObservationAnomalyAssessmentTypeEnum } from '../entities/observation-anomaly-assessment.entity';
import { ObservationAnomalyAssessmentService } from './observation-anomaly-assessment.service';
import { ObservationsSavedEvent, ObservationPrimaryKey } from 'src/observation/events/observations-saved.event';

@Injectable()
export class ObservationAnomalyJobService {
  private readonly logger = new Logger(ObservationAnomalyJobService.name);
  private readonly deduplicationWindowMs = 2 * 60 * 1000;

  constructor(
    @InjectRepository(ObservationAnomalyAssessmentEntity)
    private anomalyAssessmentRepo: Repository<ObservationAnomalyAssessmentEntity>,
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

    let scored = 0;
    let skipped = 0;
    let failed = 0;

    for (const key of observationKeys) {
      try {
        const isDuplicate = await this.recentAssessmentExists(key);
        if (isDuplicate) {
          skipped++;
          continue;
        }

        await this.observationAnomalyAssessmentService.assessObservationByKey(
          key,
          ObservationAnomalyAssessmentTypeEnum.INGESTION,
        );
        scored++;
      } catch (err) {
        failed++;
        this.logger.error(
          `Failed to score observation ${key.stationId}/${key.elementId}/${key.datetime.toISOString()}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.logger.log(`Ingestion scoring complete: ${scored} scored, ${skipped} skipped (recent duplicate), ${failed} failed`);
  }

  @OnEvent('observations.quality-controlled')
  async handleObservationsQualityControlled() {
    this.logger.log('Received observations.quality-controlled event for ML anomaly detection and generative review assistance follow-up');
  }

  private async recentAssessmentExists(key: ObservationPrimaryKey): Promise<boolean> {
    const cutoff = new Date(Date.now() - this.deduplicationWindowMs);
    const count = await this.anomalyAssessmentRepo.countBy({
      stationId: key.stationId.trim(),
      elementId: key.elementId,
      level: key.level,
      datetime: key.datetime,
      interval: key.interval,
      sourceId: key.sourceId,
      createdAt: MoreThanOrEqual(cutoff),
    });
    return count > 0;
  }
}
