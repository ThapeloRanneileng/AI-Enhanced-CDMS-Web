import { parseStructuredPaperArchiveFileName } from './paper-archive-filename.util';

describe('parseStructuredPaperArchiveFileName', () => {
    it('parses StnID-FormID-YYYYMMDDHH filenames', () => {
        expect(parseStructuredPaperArchiveFileName('LESBUT1-12-2026042408.pdf')).toEqual({
            stationId: 'LESBUT1',
            sourceId: 12,
            observationDate: '2026-04-24',
            observationHour: 8,
        });
    });

    it('returns null for unstructured filenames', () => {
        expect(parseStructuredPaperArchiveFileName('Botha_Bothe_scan.pdf')).toBeNull();
    });

    it('returns null for invalid hours', () => {
        expect(parseStructuredPaperArchiveFileName('LESER1-12-2026042425.jpg')).toBeNull();
    });

    it('marks impossible observation dates for review without returning a date', () => {
        expect(parseStructuredPaperArchiveFileName('LESBUT1-12-2026134008.pdf')).toEqual({
            stationId: 'LESBUT1',
            sourceId: 12,
            observationHour: 8,
            needsReview: true,
            reviewReason: 'Invalid observation date parsed from filename',
        });
    });
});
