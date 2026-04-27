import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
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
  errorMessage?: string;
}

export interface LmsAiStatus {
  available: boolean;
  manifest: any;
  modelSummary: any;
  autoencoderStatus: Record<string, string> | null;
  files: { key: string; fileName: string; exists: boolean; sizeBytes: number }[];
  restricted?: boolean;
  genaiProvider?: string | null;
  genaiModelSummaryExists?: boolean;
  genaiReviewerExplanationsExists?: boolean;
  genaiReportFiles?: { key: string; fileName: string; exists: boolean; sizeBytes: number }[];
  errorMessage?: string;
}

export interface LmsAiMarkdownReport {
  exists: boolean;
  content: string;
  file: any;
  errorMessage?: string;
}

export interface LmsAiGenAiSummary extends LmsAiMarkdownReport {
  provider: string | null;
  sections: { title: string; lines: string[] }[];
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
    return this.http.get<LmsAiStatus>(`${this.endPointUrl}/status`).pipe(
      catchError(err => of(this.emptyStatus(err))),
    );
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
    return this.http.get<{ exists: boolean; data: any; file: any }>(`${this.endPointUrl}/model-summary`).pipe(
      catchError(err => of({ exists: false, data: null, file: null, errorMessage: this.getFriendlyError(err) } as any)),
    );
  }

  public manifest(): Observable<{ exists: boolean; data: any; file: any }> {
    return this.http.get<{ exists: boolean; data: any; file: any }>(`${this.endPointUrl}/manifest`).pipe(
      catchError(err => of({ exists: false, data: null, file: null, errorMessage: this.getFriendlyError(err) } as any)),
    );
  }

  public supervisorSummary(): Observable<LmsAiMarkdownReport> {
    return this.http.get<LmsAiMarkdownReport>(`${this.endPointUrl}/supervisor-summary`).pipe(
      catchError(err => of(this.emptyMarkdownReport(err))),
    );
  }

  public genAiSummary(): Observable<LmsAiGenAiSummary> {
    return this.http.get<LmsAiGenAiSummary>(`${this.endPointUrl}/genai-summary`).pipe(
      catchError(err => of({ ...this.emptyMarkdownReport(err), provider: null, sections: [] })),
    );
  }

  public genAiReviewerExplanations(query: LmsAiQuery = {}): Observable<LmsAiPagedRows> {
    return this.getPaged('genai-reviewer-explanations', query);
  }

  private getPaged(path: string, query: LmsAiQuery): Observable<LmsAiPagedRows> {
    return this.http.get<LmsAiPagedRows>(
      `${this.endPointUrl}/${path}`,
      { params: StringUtils.getQueryParams<LmsAiQuery>(query) },
    ).pipe(catchError(err => of(this.emptyPagedRows(query, err))));
  }

  private emptyStatus(err: any): LmsAiStatus {
    return {
      available: false,
      manifest: null,
      modelSummary: null,
      autoencoderStatus: null,
      files: [],
      genaiProvider: null,
      genaiModelSummaryExists: false,
      genaiReviewerExplanationsExists: false,
      genaiReportFiles: [],
      errorMessage: this.getFriendlyError(err),
    };
  }

  private emptyMarkdownReport(err: any): LmsAiMarkdownReport {
    return {
      exists: false,
      content: '',
      file: null,
      errorMessage: this.getFriendlyError(err),
    };
  }

  private emptyPagedRows(query: LmsAiQuery, err: any): LmsAiPagedRows {
    return {
      total: 0,
      limit: query.limit ?? 100,
      offset: query.offset ?? 0,
      rows: [],
      missing: true,
      errorMessage: this.getFriendlyError(err),
    };
  }

  private getFriendlyError(err: any): string {
    if (err?.status === 0) {
      return `LMS AI API could not be reached at ${this.endPointUrl}. Check that the backend API is running and reachable from the browser.`;
    }
    return err?.error?.message || err?.message || 'LMS AI API request failed.';
  }
}
