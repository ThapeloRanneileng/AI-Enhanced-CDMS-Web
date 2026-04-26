import { ViewObservationQueryDTO } from '../dtos/view-observation-query.dto';

export function buildQCObservationQueryFilter(queryDto: ViewObservationQueryDTO): string {
    let where = '';
    if (queryDto.stationIds && queryDto.stationIds.length > 0) {
        where = where + ` station_id IN (${queryDto.stationIds.map(id => `'${id}'`).join(',')}) AND`;
    }

    if (queryDto.elementIds && queryDto.elementIds.length > 0) {
        where = where + ` element_id IN (${queryDto.elementIds.join(',')}) AND`;
    }

    if (queryDto.level !== undefined) {
        where = `${where} level = ${queryDto.level} AND`;
    }

    if (queryDto.intervals && queryDto.intervals.length > 0) {
        where = `${where} interval IN (${queryDto.intervals.join(',')}) AND`;
    }

    if (queryDto.sourceIds && queryDto.sourceIds.length > 0) {
        where = `${where} source_id IN (${queryDto.sourceIds.join(',')}) AND`;
    }

    const dateOperator = getQCQueryDateFilter(queryDto);
    if (dateOperator) {
        where = `${where} ( ${dateOperator} ) AND`;
    }

    return `${where} deleted = FALSE`;
}

function getQCQueryDateFilter(queryDto: ViewObservationQueryDTO): string | null {
    let dateOperator: string | null = null;
    const dateColToUse = queryDto.useEntryDate ? 'entry_date_time' : 'date_time';
    const strFromDate = queryDto.fromDate ? queryDto.fromDate.replace('T', ' ').replace('Z', '') : '';
    const strToDate = queryDto.toDate ? queryDto.toDate.replace('T', ' ').replace('Z', '') : '';

    if (strFromDate && strToDate) {
        if (strFromDate === strToDate) {
            dateOperator = `${dateColToUse} = '${strFromDate}' `;
        } else {
            dateOperator = `${dateColToUse} BETWEEN '${strFromDate}' AND '${strToDate}'`;
        }

    } else if (strFromDate) {
        dateOperator = `${dateColToUse} >= '${strFromDate}' `;
    } else if (strToDate) {
        dateOperator = `${dateColToUse} <= '${strToDate}' `;
    }

    return dateOperator;
}
