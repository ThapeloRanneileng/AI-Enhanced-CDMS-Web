import { ObservationEntity } from "../entities/observation.entity";

export interface ObservationPrimaryKey {
  stationId: string;
  elementId: number;
  level: number;
  datetime: Date;
  interval: number;
  sourceId: number;
}

export interface ObservationsSavedEvent {
  observationKeys: ObservationPrimaryKey[];
}

export class ObservationEventUtils {
  public static mapEntityKey(observation: Pick<ObservationEntity, "stationId" | "elementId" | "level" | "datetime" | "interval" | "sourceId">): ObservationPrimaryKey {
    return {
      stationId: observation.stationId,
      elementId: observation.elementId,
      level: observation.level,
      datetime: observation.datetime,
      interval: observation.interval,
      sourceId: observation.sourceId,
    };
  }

  public static deduplicateObservationKeys(observationKeys: ObservationPrimaryKey[]): ObservationPrimaryKey[] {
    const uniqueKeys = new Map<string, ObservationPrimaryKey>();

    for (const observationKey of observationKeys) {
      const key = [
        observationKey.stationId,
        observationKey.elementId,
        observationKey.level,
        observationKey.datetime.toISOString(),
        observationKey.interval,
        observationKey.sourceId,
      ].join('|');

      uniqueKeys.set(key, observationKey);
    }

    return [...uniqueKeys.values()];
  }
}
