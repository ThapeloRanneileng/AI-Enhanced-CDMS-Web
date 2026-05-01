import { Transform } from 'class-transformer';
import { IsDateString, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateIf } from 'class-validator';

export class ReviewerDecisionDto {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsNotEmpty()
  @IsString()
  stationId: string;

  @IsInt()
  elementId: number;

  @IsDateString()
  datetime: string;

  @IsInt()
  level: number;

  @IsInt()
  interval: number;

  @IsInt()
  sourceId: number;

  @IsOptional()
  @IsInt()
  assessmentId?: number;

  // approved | overridden | escalated
  @IsNotEmpty()
  @IsString()
  decision: string;

  @IsOptional()
  @ValidateIf(o => o.correctedValue !== null)
  @IsNumber()
  correctedValue?: number | null;

  @IsOptional()
  @IsString()
  reasonCode?: string;

  @IsOptional()
  @IsString()
  reasonNote?: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
