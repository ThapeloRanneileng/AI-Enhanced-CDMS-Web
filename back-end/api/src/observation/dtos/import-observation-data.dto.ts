import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

export class ObservationDataImportRowDto {
    @IsOptional()
    @IsString()
    stationId?: string;

    @IsOptional()
    @IsString()
    element?: string;

    @IsOptional()
    @IsString()
    observationDatetime?: string;

    @IsOptional()
    value?: string | number;

    @IsOptional()
    level?: string | number;

    @IsOptional()
    interval?: string | number;

    @IsOptional()
    @IsString()
    source?: string;

    @IsOptional()
    @IsString()
    comment?: string;
}

export class ImportObservationDataDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ObservationDataImportRowDto)
    rows: ObservationDataImportRowDto[];
}

export interface ObservationDataRejectedRowDto {
    rowNumber: number;
    stationId?: string;
    element?: string;
    reasons: string[];
    row: ObservationDataImportRowDto;
}

export interface ObservationDataImportResultDto {
    totalRows: number;
    importedRows: number;
    rejectedRows: ObservationDataRejectedRowDto[];
}
