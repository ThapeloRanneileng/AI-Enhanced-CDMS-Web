import { Transform } from 'class-transformer';
import { IsDateString, IsInt, IsNumber, IsString } from 'class-validator';

export class DeleteObservationDto {
    @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
    @IsString()
    stationId: string;

    @IsInt()
    elementId: number;

    @IsInt()
    sourceId: number;

    @IsNumber()
    level: number;

    @IsDateString()
    datetime: string;

    @IsInt()
    interval: number;
}
