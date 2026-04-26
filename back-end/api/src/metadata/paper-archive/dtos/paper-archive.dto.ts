import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PaperArchiveStatusEnum } from '../entities/paper-archive.entity';

export class CreatePaperArchiveDto {
    @IsOptional()
    @IsString()
    stationId?: string;

    @IsOptional()
    @Transform(({ value }) => value === '' || value === undefined ? undefined : Number(value))
    @IsInt()
    sourceId?: number;

    @IsOptional()
    @IsDateString()
    observationDate?: string;

    @IsOptional()
    @Transform(({ value }) => value === '' || value === undefined ? undefined : Number(value))
    @IsInt()
    @Min(0)
    @Max(23)
    observationHour?: number;

    @IsOptional()
    @IsString()
    notes?: string;

    @IsOptional()
    @IsEnum(PaperArchiveStatusEnum)
    status?: PaperArchiveStatusEnum;
}

export interface ViewPaperArchiveDto {
    id: number;
    stationId: string;
    sourceId: number | null;
    observationDate: string;
    observationHour: number | null;
    uploadedBy: number;
    uploadedAt: Date;
    originalFileName: string;
    storedFileName: string;
    archivePath: string;
    checksum: string;
    notes: string;
    status: PaperArchiveStatusEnum;
}

export interface ParsedPaperArchiveFileNameDto {
    stationId: string;
    sourceId: number;
    observationDate?: string;
    observationHour: number;
    needsReview?: boolean;
    reviewReason?: string;
}
