import {
  ObservationAnomalyAssessmentTypeEnum,
  ObservationAnomalyOutcomeEnum,
  ObservationAnomalySeverityEnum,
  ObservationGenerativeExplanation,
  ObservationMlContributingSignal,
} from "../entities/observation-anomaly-assessment.entity";
import { FlagEnum } from "src/observation/enums/flag.enum";
import { QCStatusEnum } from "src/observation/enums/qc-status.enum";

export interface ObservationReviewQueueColumnsDto {
  ruleBasedQc: QCStatusEnum | null;
  failedChecks: string[];
  aiScore: number;
  aiConfidence: number | null;
  aiExplanation: string | null;
  finalDecision: string;
}

export interface ObservationRawReviewDataDto {
  value: number | null;
  flag: FlagEnum | null;
  qcStatus: QCStatusEnum;
  comment: string | null;
  deleted: boolean;
}

export interface ObservationRuleBasedQcResultsDto {
  status: QCStatusEnum;
  failedChecks: string[];
  qcTestLog: { qcTestId: number; qcStatus: QCStatusEnum }[];
}

export interface ObservationMlAnomalyOutputsDto {
  modelId: string;
  modelFamily: string;
  modelVersion: string;
  anomalyStatus: ObservationAnomalyOutcomeEnum;
  anomalyScore: number;
  confidenceScore: number | null;
  severity: ObservationAnomalySeverityEnum;
  contributingSignals: ObservationMlContributingSignal[];
  featureSnapshot: Record<string, number | string | null> | null;
}

export interface ObservationReviewerControlsDto {
  finalDecision: string;
  reviewerComment: string | null;
  availableActions: string[];
}

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
  modelFamily: string;
  modelVersion: string;
  anomalyScore: number;
  confidenceScore: number | null;
  severity: ObservationAnomalySeverityEnum;
  outcome: ObservationAnomalyOutcomeEnum;
  reasons: string[];
  featureSnapshot: Record<string, number | string | null> | null;
  contributingSignals: ObservationMlContributingSignal[];
  generativeExplanation: ObservationGenerativeExplanation | null;
  reviewQueue: ObservationReviewQueueColumnsDto;
  rawObservationData: ObservationRawReviewDataDto | null;
  ruleBasedQcResults: ObservationRuleBasedQcResultsDto | null;
  mlAnomalyOutputs: ObservationMlAnomalyOutputsDto;
  reviewerControls: ObservationReviewerControlsDto | null;
  createdByUserId: number | null;
  createdAt: string;
}
