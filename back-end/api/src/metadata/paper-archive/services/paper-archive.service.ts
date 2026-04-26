import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Repository } from 'typeorm';
import { FileIOService } from 'src/shared/services/file-io.service';
import { CreatePaperArchiveDto, ViewPaperArchiveDto } from '../dtos/paper-archive.dto';
import { PaperArchiveEntity, PaperArchiveStatusEnum } from '../entities/paper-archive.entity';
import { parseStructuredPaperArchiveFileName } from './paper-archive-filename.util';

@Injectable()
export class PaperArchiveService {
    private readonly archiveDir: string;

    constructor(
        @InjectRepository(PaperArchiveEntity) private paperArchiveRepo: Repository<PaperArchiveEntity>,
        private fileIOService: FileIOService,
    ) {
        this.archiveDir = path.posix.join(this.fileIOService.apiImportsDir, 'paper-archive');
        fs.mkdirSync(this.archiveDir, { recursive: true });
    }

    public async findAll(): Promise<ViewPaperArchiveDto[]> {
        const entities = await this.paperArchiveRepo.find({ order: { entryDateTime: 'DESC', id: 'DESC' } });
        return entities.map(entity => this.toViewDto(entity));
    }

    public async find(id: number): Promise<ViewPaperArchiveDto> {
        return this.toViewDto(await this.findEntity(id));
    }

    public async create(file: Express.Multer.File, dto: CreatePaperArchiveDto, userId: number): Promise<ViewPaperArchiveDto> {
        if (!file) throw new BadRequestException('Archive file is required');

        const parsed = parseStructuredPaperArchiveFileName(file.originalname);
        const stationId = dto.stationId || parsed?.stationId || null;
        const sourceId = dto.sourceId ?? parsed?.sourceId ?? null;
        const observationDate = dto.observationDate || parsed?.observationDate || null;
        const observationHour = dto.observationHour ?? parsed?.observationHour ?? null;

        const ext = path.extname(file.originalname).toLowerCase();
        const storedFileName = `${Date.now()}_${crypto.randomUUID()}${ext}`;
        const archivePath = path.posix.join(this.archiveDir, storedFileName);
        await fs.promises.writeFile(archivePath, file.buffer);

        const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');
        const needsReview = !stationId || !sourceId || !observationDate || !!parsed?.needsReview;
        const notes = [dto.notes, parsed?.reviewReason].filter(Boolean).join('; ') || null;

        const entity = this.paperArchiveRepo.create({
            stationId,
            sourceId,
            observationDate,
            observationHour,
            originalFileName: file.originalname,
            storedFileName,
            archivePath,
            checksum,
            notes,
            status: parsed?.needsReview
                ? PaperArchiveStatusEnum.NEEDS_REVIEW
                : dto.status || (needsReview ? PaperArchiveStatusEnum.NEEDS_REVIEW : PaperArchiveStatusEnum.ACTIVE),
            entryUserId: userId,
        });

        return this.toViewDto(await this.paperArchiveRepo.save(entity));
    }

    public async getFilePath(id: number): Promise<string> {
        const entity = await this.findEntity(id);
        return entity.archivePath;
    }

    private async findEntity(id: number): Promise<PaperArchiveEntity> {
        const entity = await this.paperArchiveRepo.findOneBy({ id });
        if (!entity) throw new NotFoundException(`Paper archive #${id} not found`);
        return entity;
    }

    private toViewDto(entity: PaperArchiveEntity): ViewPaperArchiveDto {
        return {
            id: entity.id,
            stationId: entity.stationId || '',
            sourceId: entity.sourceId,
            observationDate: entity.observationDate || '',
            observationHour: entity.observationHour,
            uploadedBy: entity.entryUserId,
            uploadedAt: entity.entryDateTime,
            originalFileName: entity.originalFileName,
            storedFileName: entity.storedFileName,
            archivePath: entity.archivePath,
            checksum: entity.checksum || '',
            notes: entity.notes || '',
            status: entity.status,
        };
    }
}
