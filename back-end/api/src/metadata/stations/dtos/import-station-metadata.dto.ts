import { Type } from 'class-transformer';
import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';

export class StationMetadataImportRowDto {
    @IsOptional()
    @IsString()
    id?: string;

    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    latitude?: string | number;

    @IsOptional()
    longitude?: string | number;

    @IsOptional()
    elevation?: string | number;

    @IsOptional()
    @IsString()
    wmoId?: string;

    @IsOptional()
    @IsString()
    wigosId?: string;

    @IsOptional()
    @IsString()
    icaoId?: string;

    @IsOptional()
    @IsString()
    comment?: string;
}

export class ImportStationMetadataDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => StationMetadataImportRowDto)
    rows: StationMetadataImportRowDto[];
}

export interface StationMetadataRejectedRowDto {
    rowNumber: number;
    stationId?: string;
    reasons: string[];
    row: StationMetadataImportRowDto;
}

export interface StationMetadataImportResultDto {
    totalRows: number;
    importedRows: number;
    rejectedRows: StationMetadataRejectedRowDto[];
}
