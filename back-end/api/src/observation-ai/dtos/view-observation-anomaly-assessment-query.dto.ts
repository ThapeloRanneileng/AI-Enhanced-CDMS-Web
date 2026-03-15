import { Transform } from "class-transformer";
import { ArrayNotEmpty, IsEnum, IsOptional, IsString } from "class-validator";
import { ViewObservationQueryDTO } from "src/observation/dtos/view-observation-query.dto";
import { StringUtils } from "src/shared/utils/string.utils";
import { ObservationAnomalyAssessmentTypeEnum, ObservationAnomalyOutcomeEnum, ObservationAnomalySeverityEnum } from "../entities/observation-anomaly-assessment.entity";

export class ViewObservationAnomalyAssessmentQueryDto extends ViewObservationQueryDTO {
  @IsOptional()
  @Transform(({ value }) => value ? StringUtils.mapCommaSeparatedStringToStringArray(value.toString()) : [])
  @ArrayNotEmpty()
  @IsEnum(ObservationAnomalyAssessmentTypeEnum, { each: true })
  assessmentTypes?: ObservationAnomalyAssessmentTypeEnum[];

  @IsOptional()
  @Transform(({ value }) => value ? StringUtils.mapCommaSeparatedStringToStringArray(value.toString()) : [])
  @ArrayNotEmpty()
  @IsEnum(ObservationAnomalySeverityEnum, { each: true })
  severities?: ObservationAnomalySeverityEnum[];

  @IsOptional()
  @Transform(({ value }) => value ? StringUtils.mapCommaSeparatedStringToStringArray(value.toString()) : [])
  @ArrayNotEmpty()
  @IsEnum(ObservationAnomalyOutcomeEnum, { each: true })
  outcomes?: ObservationAnomalyOutcomeEnum[];

  @IsOptional()
  @IsString()
  modelId?: string;

  @IsOptional()
  @IsString()
  modelVersion?: string;
}
