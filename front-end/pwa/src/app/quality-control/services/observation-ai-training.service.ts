import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AppConfigService } from 'src/app/app-config.service';
import { AppAuthInterceptor } from 'src/app/app-auth.interceptor';

export interface AnomalyTrainingRequest {
  stationIds?: string[];
  elementCodes?: string[];
  intervals?: number[];
  level?: number;
  sourceIds?: number[];
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export interface AnomalyTrainingDatasetRow {
  stationId: string;
  elementId: number;
  elementCode: string;
  level: number;
  interval: number;
  sourceId: number;
  sourceName: string | null;
  observationDatetime: string;
  value: number;
}

export interface AnomalyProxySource {
  name: string;
  cadence: string;
  supportedElementCodes: string[];
  role: string;
  replacementStrategy: string;
}

export interface AnomalyTrainingRun {
  id: number;
  trainingDatasetKind: string;
  trainingRangeFrom: string | null;
  trainingRangeTo: string | null;
  trainingRows: number;
  featureSchemaVersion: string;
  status: string;
  createdAt: string;
}

export interface AnomalyModelMetadata {
  id: number;
  trainingRunId: number | null;
  modelId: string;
  modelName: string;
  modelVersion: string;
  stationId: string;
  elementId: number;
  interval: number;
  level: number;
  trainingRangeFrom: string;
  trainingRangeTo: string;
  trainingRows: number;
  trainingDatasetKind: string;
  featureSchemaVersion: string;
  createdAt: string;
}

export interface AnomalyTrainingRunResult {
  trainingRunId: number;
  datasetRows: number;
  status: string;
  trainedModels: AnomalyModelMetadata[];
}

@Injectable({ providedIn: 'root' })
export class ObservationAiTrainingService {
  private readonly endPointUrl: string;

  constructor(
    private appConfigService: AppConfigService,
    private http: HttpClient,
  ) {
    this.endPointUrl = `${this.appConfigService.apiBaseUrl}/observation-ai/training`;
  }

  public previewDataset(request: AnomalyTrainingRequest): Observable<AnomalyTrainingDatasetRow[]> {
    return this.http.post<AnomalyTrainingDatasetRow[]>(`${this.endPointUrl}/dataset-preview`, request)
      .pipe(catchError(AppAuthInterceptor.handleError));
  }

  public runTraining(request: AnomalyTrainingRequest): Observable<AnomalyTrainingRunResult> {
    return this.http.post<AnomalyTrainingRunResult>(`${this.endPointUrl}/run`, request)
      .pipe(catchError(AppAuthInterceptor.handleError));
  }

  public listProxySources(): Observable<AnomalyProxySource[]> {
    return this.http.get<AnomalyProxySource[]>(`${this.endPointUrl}/proxy-sources`)
      .pipe(catchError(AppAuthInterceptor.handleError));
  }

  public listTrainingRuns(): Observable<AnomalyTrainingRun[]> {
    return this.http.get<AnomalyTrainingRun[]>(`${this.endPointUrl}/runs`)
      .pipe(catchError(AppAuthInterceptor.handleError));
  }

  public listModels(): Observable<AnomalyModelMetadata[]> {
    return this.http.get<AnomalyModelMetadata[]>(`${this.endPointUrl}/models`)
      .pipe(catchError(AppAuthInterceptor.handleError));
  }
}
