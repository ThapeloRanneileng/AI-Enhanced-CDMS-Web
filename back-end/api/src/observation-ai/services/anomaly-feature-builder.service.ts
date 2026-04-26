import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ObservationEntity } from 'src/observation/entities/observation.entity';
import { NumberUtils } from 'src/shared/utils/number.utils';

export interface ObservationAnomalyFeatureSet {
  stationId: string;
  elementId: number;
  level: number;
  interval: number;
  sourceId: number;
  datetime: string;
  features: Record<string, number | string | null>;
}

interface NumericSummary {
  count: number;
  mean: number | null;
  stdDev: number | null;
  min: number | null;
  max: number | null;
}

@Injectable()
export class AnomalyFeatureBuilderService {
  private readonly logger = new Logger(AnomalyFeatureBuilderService.name);
  private readonly rollingWindowSize = 30;
  private readonly seasonalWindowSize = 60;

  constructor(
    @InjectRepository(ObservationEntity) private observationRepo: Repository<ObservationEntity>,
  ) { }

  public async buildFeatures(observation: ObservationEntity): Promise<ObservationAnomalyFeatureSet> {
    this.logger.debug(`Building anomaly features for ${observation.stationId}/${observation.elementId}/${observation.datetime.toISOString()}`);

    const rollingValues = await this.getRollingValues(observation, this.rollingWindowSize);
    const seasonalValues = await this.getSeasonalValues(observation, this.seasonalWindowSize);
    const previousValue = rollingValues.length > 0 ? rollingValues[0] : null;
    const rollingSummary = this.summarizeValues(rollingValues);
    const seasonalSummary = this.summarizeValues(seasonalValues);

    const rollingZScore = this.computeZScore(observation.value, rollingSummary.mean, rollingSummary.stdDev);
    const seasonalZScore = this.computeZScore(observation.value, seasonalSummary.mean, seasonalSummary.stdDev);
    const observationMonth = observation.datetime.getUTCMonth() + 1;

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
        previousValue,
        differenceFromPrevious: observation.value === null || previousValue === null ? null : observation.value - previousValue,
        rollingHistoryCount: rollingSummary.count,
        rollingMean: rollingSummary.mean,
        rollingStdDev: rollingSummary.stdDev,
        rollingMin: rollingSummary.min,
        rollingMax: rollingSummary.max,
        rollingZScore,
        seasonalHistoryCount: seasonalSummary.count,
        seasonalMean: seasonalSummary.mean,
        seasonalStdDev: seasonalSummary.stdDev,
        seasonalMin: seasonalSummary.min,
        seasonalMax: seasonalSummary.max,
        seasonalZScore,
        month: observationMonth,
        season: Math.floor((observationMonth - 1) / 3) + 1,
        hour: observation.interval < 1440 ? observation.datetime.getUTCHours() : null,
      }
    };
  }

  private async getRollingValues(observation: ObservationEntity, limit: number): Promise<number[]> {
    const rows: { value: number }[] = await this.observationRepo
      .createQueryBuilder('observation')
      .select('observation.value', 'value')
      .where('observation.station_id = :stationId', { stationId: observation.stationId })
      .andWhere('observation.element_id = :elementId', { elementId: observation.elementId })
      .andWhere('observation.level = :level', { level: observation.level })
      .andWhere('observation.interval = :interval', { interval: observation.interval })
      .andWhere('observation.date_time < :datetime', { datetime: observation.datetime.toISOString() })
      .andWhere('observation.deleted = FALSE')
      .andWhere('observation.value IS NOT NULL')
      .orderBy('observation.date_time', 'DESC')
      .limit(limit)
      .getRawMany();

    return rows.map((row) => Number(row.value)).filter((value) => Number.isFinite(value));
  }

  private async getSeasonalValues(observation: ObservationEntity, limit: number): Promise<number[]> {
    const rows: { value: number }[] = await this.observationRepo
      .createQueryBuilder('observation')
      .select('observation.value', 'value')
      .where('observation.station_id = :stationId', { stationId: observation.stationId })
      .andWhere('observation.element_id = :elementId', { elementId: observation.elementId })
      .andWhere('observation.level = :level', { level: observation.level })
      .andWhere('observation.interval = :interval', { interval: observation.interval })
      .andWhere('observation.date_time < :datetime', { datetime: observation.datetime.toISOString() })
      .andWhere('EXTRACT(MONTH FROM observation.date_time) = :month', { month: observation.datetime.getUTCMonth() + 1 })
      .andWhere('observation.deleted = FALSE')
      .andWhere('observation.value IS NOT NULL')
      .orderBy('observation.date_time', 'DESC')
      .limit(limit)
      .getRawMany();

    return rows.map((row) => Number(row.value)).filter((value) => Number.isFinite(value));
  }

  private summarizeValues(values: number[]): NumericSummary {
    if (values.length === 0) {
      return {
        count: 0,
        mean: null,
        stdDev: null,
        min: null,
        max: null,
      };
    }

    const count = values.length;
    const mean = values.reduce((sum, value) => sum + value, 0) / count;
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / count;
    const stdDev = Math.sqrt(variance);

    return {
      count,
      mean: NumberUtils.roundOff(mean, 4),
      stdDev: NumberUtils.roundOff(stdDev, 4),
      min: NumberUtils.roundOff(Math.min(...values), 4),
      max: NumberUtils.roundOff(Math.max(...values), 4),
    };
  }

  private computeZScore(value: number | null, mean: number | null, stdDev: number | null): number | null {
    if (value === null || mean === null || stdDev === null || stdDev === 0) {
      return null;
    }

    return NumberUtils.roundOff((value - mean) / stdDev, 4);
  }
}
