import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ObservationEntity } from 'src/observation/entities/observation.entity';
import { ElementEntity } from 'src/metadata/elements/entities/element.entity';
import { SourceSpecificationEntity } from 'src/metadata/source-specifications/entities/source-specification.entity';

export const SUPPORTED_ANOMALY_ELEMENT_CODES = ['TEMP', 'RH', 'PRES', 'RN', 'WS', 'WD'] as const;
export type SupportedAnomalyElementCode = typeof SUPPORTED_ANOMALY_ELEMENT_CODES[number];

export interface AnomalyTrainingDatasetRequest {
  stationIds?: string[];
  elementCodes?: SupportedAnomalyElementCode[];
  intervals?: number[];
  level?: number;
  sourceIds?: number[];
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export interface AnomalyTrainingDatasetRow {
  stationId: string;
  elementId: number;
  elementCode: string;
  level: number;
  interval: number;
  sourceId: number;
  sourceName: string | null;
  observationDatetime: string;
  value: number;
}

export interface AnomalyTrainingFeatureRow extends AnomalyTrainingDatasetRow {
  previousValue: number | null;
  differenceFromPrevious: number | null;
  rollingMean: number | null;
  rollingStdDev: number | null;
  rollingZScore: number | null;
  month: number;
  season: number;
  hour: number | null;
}

@Injectable()
export class AnomalyTrainingDataPreparationService {
  constructor(
    @InjectRepository(ObservationEntity) private observationRepo: Repository<ObservationEntity>,
    @InjectRepository(ElementEntity) private elementRepo: Repository<ElementEntity>,
    @InjectRepository(SourceSpecificationEntity) private sourceRepo: Repository<SourceSpecificationEntity>,
  ) { }

  public async prepareDataset(request: AnomalyTrainingDatasetRequest): Promise<AnomalyTrainingDatasetRow[]> {
    const elementCodes = request.elementCodes?.length ? request.elementCodes : [...SUPPORTED_ANOMALY_ELEMENT_CODES];
    const elements = await this.elementRepo.find({ where: { abbreviation: In(elementCodes) } });
    const elementCodeById = new Map(elements.map((element) => [element.id, element.abbreviation]));
    const sourceIds = request.sourceIds;
    const sources = await this.sourceRepo.find({
      where: sourceIds?.length ? { id: In(sourceIds) } : {},
    });
    const sourceNameById = new Map(sources.map((source) => [source.id, source.name]));

    if (elements.length === 0) {
      return [];
    }

    const query = this.observationRepo
      .createQueryBuilder('observation')
      .where('observation.deleted = FALSE')
      .andWhere('observation.value IS NOT NULL')
      .andWhere('observation.element_id IN (:...elementIds)', { elementIds: elements.map((element) => element.id) });

    if (request.stationIds?.length) {
      query.andWhere('observation.station_id IN (:...stationIds)', { stationIds: request.stationIds });
    }

    if (request.intervals?.length) {
      query.andWhere('observation.interval IN (:...intervals)', { intervals: request.intervals });
    }

    if (request.level !== undefined) {
      query.andWhere('observation.level = :level', { level: request.level });
    }

    if (sourceIds?.length) {
      query.andWhere('observation.source_id IN (:...sourceIds)', { sourceIds });
    }

    if (request.fromDate) {
      query.andWhere('observation.date_time >= :fromDate', { fromDate: request.fromDate });
    }

    if (request.toDate) {
      query.andWhere('observation.date_time <= :toDate', { toDate: request.toDate });
    }

    const observations = await query
      .orderBy('observation.station_id', 'ASC')
      .addOrderBy('observation.element_id', 'ASC')
      .addOrderBy('observation.interval', 'ASC')
      .addOrderBy('observation.date_time', 'ASC')
      .limit(request.limit ?? 10000)
      .getMany();

    return observations.map((observation) => ({
      stationId: observation.stationId,
      elementId: observation.elementId,
      elementCode: elementCodeById.get(observation.elementId) ?? observation.elementId.toString(),
      level: observation.level,
      interval: observation.interval,
      sourceId: observation.sourceId,
      sourceName: sourceNameById.get(observation.sourceId) ?? null,
      observationDatetime: observation.datetime.toISOString(),
      value: observation.value as number,
    }));
  }

  public async prepareFeatureDataset(request: AnomalyTrainingDatasetRequest): Promise<AnomalyTrainingFeatureRow[]> {
    const rows = await this.prepareDataset(request);
    const groupedRows = new Map<string, AnomalyTrainingDatasetRow[]>();

    for (const row of rows) {
      const groupKey = this.getTrainingGroupKey(row);
      groupedRows.set(groupKey, [...(groupedRows.get(groupKey) ?? []), row]);
    }

    const featureRows: AnomalyTrainingFeatureRow[] = [];
    for (const groupRows of groupedRows.values()) {
      const sortedRows = [...groupRows].sort((left, right) => left.observationDatetime.localeCompare(right.observationDatetime));
      for (let index = 0; index < sortedRows.length; index++) {
        const row = sortedRows[index];
        const previousRows = sortedRows.slice(Math.max(0, index - 30), index);
        const previousValue = index > 0 ? sortedRows[index - 1].value : null;
        const rollingSummary = this.summarize(previousRows.map((item) => item.value));
        const observationDate = new Date(row.observationDatetime);

        featureRows.push({
          ...row,
          previousValue,
          differenceFromPrevious: previousValue === null ? null : row.value - previousValue,
          rollingMean: rollingSummary.mean,
          rollingStdDev: rollingSummary.stdDev,
          rollingZScore: this.computeZScore(row.value, rollingSummary.mean, rollingSummary.stdDev),
          month: observationDate.getUTCMonth() + 1,
          season: Math.floor(observationDate.getUTCMonth() / 3) + 1,
          hour: row.interval < 1440 ? observationDate.getUTCHours() : null,
        });
      }
    }

    return featureRows;
  }

  private getTrainingGroupKey(row: Pick<AnomalyTrainingDatasetRow, 'stationId' | 'elementId' | 'interval' | 'level'>): string {
    return `${row.stationId}|${row.elementId}|${row.interval}|${row.level}`;
  }

  private summarize(values: number[]): { mean: number | null; stdDev: number | null } {
    if (values.length === 0) {
      return { mean: null, stdDev: null };
    }

    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
    return {
      mean,
      stdDev: Math.sqrt(variance),
    };
  }

  private computeZScore(value: number, mean: number | null, stdDev: number | null): number | null {
    if (mean === null || stdDev === null || stdDev === 0) {
      return null;
    }

    return (value - mean) / stdDev;
  }
}
