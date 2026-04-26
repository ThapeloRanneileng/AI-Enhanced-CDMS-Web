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
  modelName: string;
  modelFamily: string;
  modelVersion: string;
  anomalyStatus: ObservationAnomalyOutcomeEnum;
  anomalyScore: number;
  confidenceScore: number | null;
  confidence: number | null;
  finalDecision: ObservationAnomalyOutcomeEnum;
  explanation: string | null;
  severity: ObservationAnomalySeverityEnum;
  contributingSignals: ObservationMlContributingSignal[];
  featureSnapshot: Record<string, number | string | null> | null;
}

export interface ObservationReviewerControlsDto {
  finalDecision: string;
  reviewerComment: string | null;
  availableActions: string[];
}

export interface ExternalReviewMetadataDto {
  recordId: string;
  stationId: string;
  observationDatetime: string;
  elementCode: string;
  value: string;
  qcStatus: string;
  mlStatus: string;
  finalDecision: string;
  severity: string;
  anomalyType: string;
  explanationSummary: string;
  recommendedAction: string;
  modelVersion: string;
  engineVersion: string;
  runTimestamp: string;
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
  modelName: string;
  modelFamily: string;
  modelVersion: string;
  anomalyScore: number;
  confidenceScore: number | null;
  confidence: number | null;
  finalDecision: ObservationAnomalyOutcomeEnum;
  explanation: string | null;
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
  externalReviewMetadata?: ExternalReviewMetadataDto | null;
  createdByUserId: number | null;
  createdAt: string;
}
