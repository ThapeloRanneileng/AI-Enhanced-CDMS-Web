import { StationImportTransformer } from './station-import-transformer';

describe('StationImportTransformer LMS validation', () => {
    it('reports duplicate station IDs without adding DuckDB constraints', async () => {
        const run = jest.fn().mockResolvedValue(undefined);
        const runAndReadAll = jest.fn().mockResolvedValue({
            getRowObjects: () => [{ id: 'STA001', duplicate_count: 2 }],
        });

        const error = await StationImportTransformer.executeTransformation(
            { run, runAndReadAll } as any,
            'stations_import',
            {
                idColumnPosition: 1,
                nameColumnPosition: 2,
            } as any,
            7,
        );

        expect(error).toEqual(expect.objectContaining({
            type: 'SQL_EXECUTION_ERROR',
            message: expect.stringContaining('duplicate station IDs'),
            detail: expect.stringContaining('STA001'),
        }));
        expect(run.mock.calls.flat().join('; ')).not.toContain('ADD CONSTRAINT');
    });

    it('reports invalid latitude ranges', async () => {
        const run = jest.fn().mockResolvedValue(undefined);
        const runAndReadAll = jest
            .fn()
            .mockResolvedValueOnce({ getRowObjects: () => [] })
            .mockResolvedValueOnce({ getRowObjects: () => [{ cnt: 1 }] });

        const error = await StationImportTransformer.executeTransformation(
            { run, runAndReadAll } as any,
            'stations_import',
            {
                idColumnPosition: 1,
                nameColumnPosition: 2,
                latitudeColumnPosition: 3,
            } as any,
            7,
        );

        expect(error).toEqual(expect.objectContaining({
            type: 'SQL_EXECUTION_ERROR',
            message: expect.stringContaining('latitude'),
            detail: expect.stringContaining('1 row'),
        }));
        expect(run.mock.calls.flat().join('; ')).not.toContain('ADD CONSTRAINT');
    });
});
