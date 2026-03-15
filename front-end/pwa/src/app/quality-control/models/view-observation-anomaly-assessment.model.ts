export type ObservationAnomalySeverity = 'low' | 'medium' | 'high';
export type ObservationAnomalyOutcome = 'passed' | 'suspect' | 'failed' | 'not_applicable';
export type ObservationAnomalyAssessmentType = 'ingestion' | 'on_demand_qc' | 'recheck' | 'backfill';

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
    modelVersion: string;
    anomalyScore: number;
    severity: ObservationAnomalySeverity;
    outcome: ObservationAnomalyOutcome;
    reasons: string[];
    featureSnapshot: Record<string, number | string | null> | null;
    createdByUserId: number | null;
    createdAt: string;
}
