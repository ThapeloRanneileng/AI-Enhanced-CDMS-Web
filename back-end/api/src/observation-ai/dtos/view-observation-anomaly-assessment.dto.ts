import { ObservationAnomalyAssessmentTypeEnum, ObservationAnomalyOutcomeEnum, ObservationAnomalySeverityEnum } from "../entities/observation-anomaly-assessment.entity";

export interface ViewObservationAnomalyAssessmentDto {
  id: number;
  stationId: string;
  elementId: number;
  level: number;
  datetime: string;
  interval: number;
  sourceId: number;
  assessmentType: ObservationAnomalyAssessmentTypeEnum;
  modelId: string;
  modelVersion: string;
  anomalyScore: number;
  severity: ObservationAnomalySeverityEnum;
  outcome: ObservationAnomalyOutcomeEnum;
  reasons: string[];
  featureSnapshot: Record<string, number | string | null> | null;
  createdByUserId: number | null;
  createdAt: string;
}
