jest.mock('../entities/observation.entity', () => ({
    ObservationEntity: class ObservationEntity { },
}));

import { ObservationsService } from './observations.service';
import { SourceTypeEnum } from 'src/metadata/source-specifications/enums/source-type.enum';

describe('ObservationsService manual import permissions', () => {
    function createService(dataEntryCheckService = { checkData: jest.fn().mockResolvedValue(undefined) }) {
        const service = new ObservationsService(
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            { emit: jest.fn() } as any,
            { find: () => [{ id: 'STA001' }] } as any,
            { find: () => [{ id: 1, abbreviation: 'TEMP', name: 'Temperature' }] } as any,
            { findAll: () => [{ id: 10, name: 'Import A', sourceType: SourceTypeEnum.IMPORT, disabled: false }] } as any,
            dataEntryCheckService as any,
        );

        jest.spyOn(service, 'bulkPut').mockResolvedValue(undefined);
        return service;
    }

    it('rejects rows for import sources outside the user import permissions', async () => {
        const service = createService();

        const result = await service.importObservationDataRows([
            {
                stationId: 'STA001',
                element: 'TEMP',
                observationDatetime: '2026-01-01T00:00:00.000Z',
                value: 12,
                source: '10',
            },
        ], {
            id: 5,
            name: 'Limited User',
            email: 'limited@example.com',
            isSystemAdmin: false,
            permissions: {
                importPermissions: { importTemplateIds: [11] },
                entryPermissions: { stationIds: ['STA001'] },
            },
        } as any);

        expect(result.importedRows).toBe(0);
        expect(result.rejectedRows[0].reasons).toContain('Not authorised to access the import');
        expect(service.bulkPut).not.toHaveBeenCalled();
    });

    it('runs existing data-entry validation before saving accepted rows', async () => {
        const dataEntryCheckService = { checkData: jest.fn().mockResolvedValue(undefined) };
        const service = createService(dataEntryCheckService);

        const result = await service.importObservationDataRows([
            {
                stationId: 'STA001',
                element: 'TEMP',
                observationDatetime: '2026-01-01T00:00:00.000Z',
                value: 12,
                source: '10',
            },
        ], {
            id: 5,
            name: 'Limited User',
            email: 'limited@example.com',
            isSystemAdmin: false,
            permissions: {
                importPermissions: { importTemplateIds: [10] },
                entryPermissions: { stationIds: ['STA001'] },
            },
        } as any);

        expect(result.importedRows).toBe(1);
        expect(dataEntryCheckService.checkData).toHaveBeenCalledWith(
            [expect.objectContaining({ stationId: 'STA001', sourceId: 10 })],
            expect.objectContaining({ id: 5 }),
            'data-entry',
        );
        expect(service.bulkPut).toHaveBeenCalled();
    });
});
