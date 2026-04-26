import * as fs from 'node:fs';
import { Repository } from 'typeorm';

jest.mock('../entities/paper-archive.entity', () => ({
    PaperArchiveStatusEnum: {
        ACTIVE: 'active',
        NEEDS_REVIEW: 'needs_review',
    },
    PaperArchiveEntity: class PaperArchiveEntity { },
}));

import { PaperArchiveEntity, PaperArchiveStatusEnum } from '../entities/paper-archive.entity';
import { PaperArchiveService } from './paper-archive.service';

describe('PaperArchiveService', () => {
    it('saves files with invalid parsed dates as needs_review instead of passing the invalid date to the repository', async () => {
        jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
        jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined);

        const repo = {
            create: jest.fn((entity: Partial<PaperArchiveEntity>) => entity),
            save: jest.fn(async (entity: Partial<PaperArchiveEntity>) => ({
                id: 1,
                entryUserId: entity.entryUserId,
                entryDateTime: new Date('2026-04-24T08:00:00Z'),
                ...entity,
            })),
        } as unknown as Repository<PaperArchiveEntity>;
        const service = new PaperArchiveService(repo, { apiImportsDir: '/tmp/imports' } as any);

        await service.create({
            originalname: 'LESBUT1-12-2026134008.pdf',
            buffer: Buffer.from('archive'),
        } as Express.Multer.File, {}, 99);

        expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
            stationId: 'LESBUT1',
            sourceId: 12,
            observationDate: null,
            observationHour: 8,
            status: PaperArchiveStatusEnum.NEEDS_REVIEW,
            notes: 'Invalid observation date parsed from filename',
        }));
        expect(repo.save).toHaveBeenCalled();
    });
});
