import { Transform } from 'class-transformer';
import { IsInt, IsNumberString, IsOptional, IsString } from 'class-validator';
import { ViewObservationQueryDTO } from 'src/observation/dtos/view-observation-query.dto';
import { StringUtils } from 'src/shared/utils/string.utils';

export class LmsAiQueryDto extends ViewObservationQueryDTO {
  @IsOptional()
  @Transform(({ value }) => value
    ? StringUtils.mapCommaSeparatedStringToStringArray(value.toString()).map(id => id.trim()).filter(id => id.length > 0)
    : undefined)
  @IsString({ each: true })
  stationIds?: string[];

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const numericValue = Number(value);
    return numericValue === 0 ? undefined : numericValue;
  })
  @IsInt()
  level?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const numericValue = Number(value);
    return numericValue === 0 ? undefined : numericValue;
  })
  @IsInt()
  interval?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const numericValue = Number(value);
    return numericValue === 0 ? undefined : numericValue;
  })
  @IsInt()
  sourceId?: number;

  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  stationId?: string;

  @IsOptional()
  @IsString()
  stationName?: string;

  @IsOptional()
  @IsString()
  elementCode?: string;

  @IsOptional()
  @Transform(({ value }) => value ? StringUtils.mapCommaSeparatedStringToStringArray(value.toString()) : undefined)
  @IsString({ each: true })
  elementCodes?: string[];

  @IsOptional()
  @IsString()
  elementName?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  outcome?: string;

  @IsOptional()
  @IsString()
  finalDecision?: string;

  @IsOptional()
  @IsString()
  severity?: string;

  @IsOptional()
  @IsString()
  reviewSource?: string;

  @IsOptional()
  @IsString()
  modelName?: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsNumberString()
  offset?: string;
}
