import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ObservationEntity } from 'src/observation/entities/observation.entity';

export interface ObservationAnomalyFeatureSet {
  stationId: string;
  elementId: number;
  level: number;
  interval: number;
  sourceId: number;
  datetime: string;
  features: Record<string, number | string | null>;
}

@Injectable()
export class AnomalyFeatureBuilderService {
  private readonly logger = new Logger(AnomalyFeatureBuilderService.name);

  constructor(
    @InjectRepository(ObservationEntity) private observationRepo: Repository<ObservationEntity>,
  ) { }

  public async buildFeatures(observation: ObservationEntity): Promise<ObservationAnomalyFeatureSet> {
    this.logger.debug(`Building anomaly features for ${observation.stationId}/${observation.elementId}/${observation.datetime.toISOString()}`);

    // Placeholder for lag, climatology, neighbour, and metadata-derived features.
    return {
      stationId: observation.stationId,
      elementId: observation.elementId,
      level: observation.level,
      interval: observation.interval,
      sourceId: observation.sourceId,
      datetime: observation.datetime.toISOString(),
      features: {
        value: observation.value,
        flag: observation.flag,
        qcStatus: observation.qcStatus,
      }
    };
  }

  public async findObservationKeysForRecentIngestion(limit = 100): Promise<Pick<ObservationEntity, "stationId" | "elementId" | "level" | "datetime" | "interval" | "sourceId">[]> {
    return this.observationRepo.find({
      select: {
        stationId: true,
        elementId: true,
        level: true,
        datetime: true,
        interval: true,
        sourceId: true,
      },
      order: {
        entryDateTime: "DESC",
      },
      take: limit,
    });
  }
}
