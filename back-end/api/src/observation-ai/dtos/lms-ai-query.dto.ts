import { Transform } from 'class-transformer';
import { ArrayNotEmpty, IsNumberString, IsOptional, IsString } from 'class-validator';
import { ViewObservationQueryDTO } from 'src/observation/dtos/view-observation-query.dto';
import { StringUtils } from 'src/shared/utils/string.utils';

export class LmsAiQueryDto extends ViewObservationQueryDTO {
  @IsOptional()
  @IsString()
  stationId?: string;

  @IsOptional()
  @IsString()
  stationName?: string;

  @IsOptional()
  @IsString()
  elementCode?: string;

  @IsOptional()
  @Transform(({ value }) => value ? StringUtils.mapCommaSeparatedStringToStringArray(value.toString()) : [])
  @ArrayNotEmpty()
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
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsNumberString()
  offset?: string;
}
