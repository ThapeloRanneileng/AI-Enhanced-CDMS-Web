import { buildQCObservationQueryFilter } from './qc-query-filter.util';

describe('buildQCObservationQueryFilter', () => {
    it('includes source and interval filters so manual form observations can be targeted for QC', () => {
        const filter = buildQCObservationQueryFilter({
            stationIds: ['STN1'],
            elementIds: [1],
            level: 0,
            intervals: [60],
            sourceIds: [10],
            fromDate: '2026-04-01T00:00:00.000Z',
            toDate: '2026-04-01T23:00:00.000Z',
        });

        expect(filter).toContain("station_id IN ('STN1')");
        expect(filter).toContain('element_id IN (1)');
        expect(filter).toContain('level = 0');
        expect(filter).toContain('interval IN (60)');
        expect(filter).toContain('source_id IN (10)');
        expect(filter).toContain('deleted = FALSE');
    });
});
