export type ObservationAnomalySeverity = 'low' | 'medium' | 'high';
export type ObservationAnomalyOutcome = 'passed' | 'suspect' | 'failed' | 'not_applicable';
export type ObservationAnomalyAssessmentType = 'ingestion' | 'on_demand_qc' | 'recheck' | 'backfill';

export interface ObservationMlContributingSignalModel {
    signal: string;
    feature: string;
    observedValue: number | string | null;
    expectedValue: number | null;
    contributionScore: number;
    direction: 'higher' | 'lower' | 'neutral';
}

export interface ObservationGenerativeExplanationModel {
    summary: string;
    abnormalPatterns: string[];
    failedQcChecks: string[];
    suggestedReviewerAction: string;
    reviewerGuidance: string;
}

export interface ViewObservationAnomalyAssessmentModel {
    id: number;
    stationId: string;
    elementId: number;
    level: number;
    datetime: string;
    interval: number;
    sourceId: number;
    assessmentType: ObservationAnomalyAssessmentType;
    modelId: string;
    modelFamily?: string;
    modelVersion: string;
    anomalyScore: number;
    confidenceScore?: number | null;
    severity: ObservationAnomalySeverity;
    outcome: ObservationAnomalyOutcome;
    reasons: string[];
    featureSnapshot: Record<string, number | string | null> | null;
    contributingSignals?: ObservationMlContributingSignalModel[];
    generativeExplanation?: ObservationGenerativeExplanationModel | null;
    reviewQueue?: {
        ruleBasedQc: string | null;
        failedChecks: string[];
        aiScore: number;
        aiConfidence: number | null;
        aiExplanation: string | null;
        finalDecision: string;
    };
    rawObservationData?: {
        value: number | null;
        flag: string | null;
        qcStatus: string;
        comment: string | null;
        deleted: boolean;
    } | null;
    ruleBasedQcResults?: {
        status: string;
        failedChecks: string[];
        qcTestLog: { qcTestId: number; qcStatus: string }[];
    } | null;
    mlAnomalyOutputs?: {
        modelId: string;
        modelFamily: string;
        modelVersion: string;
        anomalyStatus: ObservationAnomalyOutcome;
        anomalyScore: number;
        confidenceScore: number | null;
        severity: ObservationAnomalySeverity;
        contributingSignals: ObservationMlContributingSignalModel[];
        featureSnapshot: Record<string, number | string | null> | null;
    };
    reviewerControls?: {
        finalDecision: string;
        reviewerComment: string | null;
        availableActions: string[];
    } | null;
    createdByUserId: number | null;
    createdAt: string;
}
