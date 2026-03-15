export interface ViewObservationAnomalyAssessmentQueryModel {
    stationIds?: string[];
    elementIds?: number[];
    intervals?: number[];
    level?: number;
    sourceIds?: number[];
    fromDate?: string;
    toDate?: string;
    page?: number;
    pageSize?: number;
}
