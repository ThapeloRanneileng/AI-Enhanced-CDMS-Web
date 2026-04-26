import { ElementImportTransformer } from './element-import-transformer';

describe('ElementImportTransformer LMS validation', () => {
    it('reports duplicate abbreviations without adding DuckDB constraints', async () => {
        const run = jest.fn().mockResolvedValue(undefined);
        const runAndReadAll = jest
            .fn()
            .mockResolvedValueOnce({ getRowObjects: () => [] })
            .mockResolvedValueOnce({ getRowObjects: () => [{ abbreviation: 'TMAX', duplicate_count: 2 }] });

        const error = await ElementImportTransformer.executeTransformation(
            { run, runAndReadAll } as any,
            'elements_import',
            {
                idColumnPosition: 1,
                abbreviationColumnPosition: 2,
                nameColumnPosition: 3,
                unitsColumnPosition: 4,
            } as any,
            7,
        );

        expect(error).toEqual(expect.objectContaining({
            type: 'SQL_EXECUTION_ERROR',
            message: expect.stringContaining('duplicate abbreviations'),
            detail: expect.stringContaining('TMAX'),
        }));
        expect(run.mock.calls.flat().join('; ')).not.toContain('ADD CONSTRAINT');
    });

    it('reports missing or empty units', async () => {
        const run = jest.fn().mockResolvedValue(undefined);
        const runAndReadAll = jest
            .fn()
            .mockResolvedValueOnce({ getRowObjects: () => [] })
            .mockResolvedValueOnce({ getRowObjects: () => [] })
            .mockResolvedValueOnce({ getRowObjects: () => [] })
            .mockResolvedValueOnce({ getRowObjects: () => [{ cnt: 2 }] });

        const error = await ElementImportTransformer.executeTransformation(
            { run, runAndReadAll } as any,
            'elements_import',
            {
                idColumnPosition: 1,
                abbreviationColumnPosition: 2,
                nameColumnPosition: 3,
                unitsColumnPosition: 4,
            } as any,
            7,
        );

        expect(error).toEqual(expect.objectContaining({
            type: 'SQL_EXECUTION_ERROR',
            message: expect.stringContaining('units'),
            detail: expect.stringContaining('2 row'),
        }));
        expect(run.mock.calls.flat().join('; ')).not.toContain('ADD CONSTRAINT');
    });
});
