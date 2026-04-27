import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AppAuthInterceptor } from 'src/app/app-auth.interceptor';
import { AppConfigService } from 'src/app/app-config.service';
import { StringUtils } from 'src/app/shared/utils/string.utils';

export interface LmsAiQuery {
  stationId?: string;
  stationIds?: string[];
  stationName?: string;
  elementCode?: string;
  elementCodes?: string[];
  elementName?: string;
  dateFrom?: string;
  dateTo?: string;
  outcome?: string;
  finalDecision?: string;
  severity?: string;
  reviewSource?: string;
  modelName?: string;
  limit?: number;
  offset?: number;
}

export interface LmsAiPagedRows<T = Record<string, string>> {
  total: number;
  limit: number;
  offset: number;
  rows: T[];
  missing?: boolean;
}

export interface LmsAiStatus {
  available: boolean;
  manifest: any;
  modelSummary: any;
  autoencoderStatus: Record<string, string> | null;
  files: { key: string; fileName: string; exists: boolean; sizeBytes: number }[];
  restricted?: boolean;
}

@Injectable({ providedIn: 'root' })
export class LmsAiService {
  private readonly endPointUrl: string;

  constructor(
    private appConfigService: AppConfigService,
    private http: HttpClient,
  ) {
    this.endPointUrl = `${this.appConfigService.apiBaseUrl}/lms-ai`;
  }

  public status(): Observable<LmsAiStatus> {
    return this.http.get<LmsAiStatus>(`${this.endPointUrl}/status`).pipe(catchError(AppAuthInterceptor.handleError));
  }

  public qcReview(query: LmsAiQuery = {}): Observable<LmsAiPagedRows> {
    return this.getPaged('qc-review', query);
  }

  public ensemble(query: LmsAiQuery = {}): Observable<LmsAiPagedRows> {
    return this.getPaged('ensemble', query);
  }

  public normalizedObservations(query: LmsAiQuery = {}): Observable<LmsAiPagedRows> {
    return this.getPaged('normalized-observations', query);
  }

  public rejectedRecords(query: LmsAiQuery = {}): Observable<LmsAiPagedRows> {
    return this.getPaged('rejected-records', query);
  }

  public predictions(query: LmsAiQuery = {}): Observable<LmsAiPagedRows> {
    return this.getPaged('predictions', query);
  }

  public modelSummary(): Observable<{ exists: boolean; data: any; file: any }> {
    return this.http.get<{ exists: boolean; data: any; file: any }>(`${this.endPointUrl}/model-summary`).pipe(catchError(AppAuthInterceptor.handleError));
  }

  public manifest(): Observable<{ exists: boolean; data: any; file: any }> {
    return this.http.get<{ exists: boolean; data: any; file: any }>(`${this.endPointUrl}/manifest`).pipe(catchError(AppAuthInterceptor.handleError));
  }

  public supervisorSummary(): Observable<{ exists: boolean; content: string; file: any }> {
    return this.http.get<{ exists: boolean; content: string; file: any }>(`${this.endPointUrl}/supervisor-summary`).pipe(catchError(AppAuthInterceptor.handleError));
  }

  private getPaged(path: string, query: LmsAiQuery): Observable<LmsAiPagedRows> {
    return this.http.get<LmsAiPagedRows>(
      `${this.endPointUrl}/${path}`,
      { params: StringUtils.getQueryParams<LmsAiQuery>(query) },
    ).pipe(catchError(AppAuthInterceptor.handleError));
  }
}
