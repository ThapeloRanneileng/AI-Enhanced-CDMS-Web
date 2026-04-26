import * as path from 'node:path';
import { ParsedPaperArchiveFileNameDto } from '../dtos/paper-archive.dto';

export function parseStructuredPaperArchiveFileName(fileName: string): ParsedPaperArchiveFileNameDto | null {
    const baseName = path.basename(fileName, path.extname(fileName));
    const match = /^([A-Za-z0-9_]+)-(\d+)-(\d{10})$/.exec(baseName);
    if (!match) return null;

    const timestamp = match[3];
    const year = timestamp.slice(0, 4);
    const month = timestamp.slice(4, 6);
    const day = timestamp.slice(6, 8);
    const hour = Number(timestamp.slice(8, 10));

    if (hour < 0 || hour > 23) return null;

    const observationDate = `${year}-${month}-${day}`;
    if (!isValidDate(Number(year), Number(month), Number(day))) {
        return {
            stationId: match[1],
            sourceId: Number(match[2]),
            observationHour: hour,
            needsReview: true,
            reviewReason: 'Invalid observation date parsed from filename',
        };
    }

    return {
        stationId: match[1],
        sourceId: Number(match[2]),
        observationDate,
        observationHour: hour,
    };
}

function isValidDate(year: number, month: number, day: number): boolean {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
    if (month < 1 || month > 12 || day < 1) return false;

    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    return parsedDate.getUTCFullYear() === year
        && parsedDate.getUTCMonth() === month - 1
        && parsedDate.getUTCDate() === day;
}
