import { Component, OnInit } from '@angular/core';
import { catchError, forkJoin, of, take } from 'rxjs';
import { PagesDataService, ToastEventTypeEnum } from 'src/app/core/services/pages-data.service';
import { ViewObservationAnomalyAssessmentModel } from '../models/view-observation-anomaly-assessment.model';
import { ObservationAnomalyAssessmentsService } from '../services/observation-anomaly-assessments.service';
import {
  AnomalyModelMetadata,
  AnomalyProxySource,
  AnomalyTrainingDatasetRow,
  AnomalyTrainingRequest,
  AnomalyTrainingRun,
  ObservationAiTrainingService,
} from '../services/observation-ai-training.service';
import { LmsAiService, LmsAiStatus } from '../services/lms-ai.service';

interface SupervisorSummarySection {
  title: string;
  lines: string[];
}

@Component({
  selector: 'app-ai-anomaly-management',
  templateUrl: './ai-anomaly-management.component.html',
  styleUrls: ['./ai-anomaly-management.component.scss']
})
export class AiAnomalyManagementComponent implements OnInit {
  protected selectedStationIds: string[] = [];
  protected selectedElementCodes: string[] = ['TEMP', 'RH', 'PRES', 'RN', 'WS', 'WD'];
  protected selectedIntervals: number[] = [60, 1440];
  protected readonly elementOptions = [
    { code: 'TEMP', name: 'Temperature' },
    { code: 'RH', name: 'Relative humidity' },
    { code: 'PRES', name: 'Pressure' },
    { code: 'RN', name: 'Rainfall' },
    { code: 'WS', name: 'Wind speed' },
    { code: 'WD', name: 'Wind direction' },
  ];
  protected level = 0;
  protected fromDate = '';
  protected toDate = '';
  protected loading = false;
  protected previewRows: AnomalyTrainingDatasetRow[] = [];
  protected proxySources: AnomalyProxySource[] = [];
  protected trainingRuns: AnomalyTrainingRun[] = [];
  protected models: AnomalyModelMetadata[] = [];
  protected selectedModel: AnomalyModelMetadata | null = null;
  protected latestScoring: ViewObservationAnomalyAssessmentModel | null = null;
  protected latestScoringState: 'idle' | 'loading' | 'ready' | 'empty' | 'error' = 'idle';
  protected latestScoringMessage = 'Select a model to view its latest shared anomaly scoring result.';
  protected lmsAiStatus: LmsAiStatus | null = null;
  protected lmsSupervisorSummary = '';
  protected lmsSupervisorSummarySections: SupervisorSummarySection[] = [];
  protected lmsReports: { label: string; fileName: string; exists: boolean }[] = [];
  protected lmsPreviewRows: Record<string, string>[] = [];
  protected lmsPreviewLoading = false;
  protected lmsPreviewStationId = '';
  protected lmsPreviewElementCode = '';
  protected lmsPreviewFromDate = '';
  protected lmsPreviewToDate = '';
  protected readonly supervisorSummarySectionTitles = [
    'Pipeline Run Overview',
    'Data Ingestion Summary',
    'AI Model Summary',
    'Autoencoder Calibration Summary',
    'Anomaly Review Summary',
    'Highest-Risk Stations and Elements',
    'QC Review Handoff Summary',
    'Interpretation Notes',
    'Next Recommended Actions',
  ];

  constructor(
    private pagesDataService: PagesDataService,
    private observationAiTrainingService: ObservationAiTrainingService,
    private observationAnomalyAssessmentsService: ObservationAnomalyAssessmentsService,
    private lmsAiService: LmsAiService,
  ) {
    this.pagesDataService.setPageHeader('AI Anomaly Management');
  }

  ngOnInit(): void {
    this.refreshLists();
  }

  protected previewDataset(): void {
    if (this.lmsAiStatus?.available) {
      this.previewLmsDataset();
      return;
    }

    this.loading = true;
    this.observationAiTrainingService.previewDataset({ ...this.buildRequest(), limit: 100 }).pipe(take(1)).subscribe({
      next: rows => this.previewRows = rows,
      error: err => this.handleError(err),
      complete: () => this.loading = false,
    });
  }

  protected runTraining(): void {
    this.loading = true;
    this.observationAiTrainingService.runTraining(this.buildRequest()).pipe(take(1)).subscribe({
      next: result => {
        this.pagesDataService.showToast({
          title: 'AI Anomaly Training',
          message: `Training run ${result.trainingRunId} completed with ${result.trainedModels.length} model(s).`,
          type: ToastEventTypeEnum.SUCCESS,
        });
        this.refreshLists();
      },
      error: err => this.handleError(err),
      complete: () => this.loading = false,
    });
  }

  protected refreshLists(): void {
    forkJoin({
      proxySources: this.observationAiTrainingService.listProxySources(),
      trainingRuns: this.observationAiTrainingService.listTrainingRuns(),
      models: this.observationAiTrainingService.listModels(),
      lmsStatus: this.lmsAiService.status().pipe(catchError(() => of(null))),
      lmsSupervisorSummary: this.lmsAiService.supervisorSummary().pipe(catchError(() => of({ exists: false, content: '', file: null }))),
    }).pipe(take(1)).subscribe({
      next: data => {
        this.proxySources = data.proxySources;
        this.trainingRuns = data.trainingRuns;
        this.models = data.models;
        this.lmsAiStatus = data.lmsStatus;
        this.lmsSupervisorSummary = data.lmsSupervisorSummary.content;
        this.lmsSupervisorSummarySections = this.parseSupervisorSummary(data.lmsSupervisorSummary.content);
        this.lmsReports = (data.lmsStatus?.files ?? [])
          .filter(file => file.exists && ['modelSummary', 'modelSummaryMarkdown', 'supervisorSummary', 'manifest', 'qcReview', 'ensemble'].includes(file.key))
          .map(file => ({ label: file.key, fileName: file.fileName, exists: file.exists }));
        this.syncSelectedModel();
      },
      error: err => this.handleError(err),
    });
  }

  protected previewLmsDataset(): void {
    this.lmsPreviewLoading = true;
    this.lmsAiService.normalizedObservations({
      stationId: this.lmsPreviewStationId || undefined,
      elementCode: this.lmsPreviewElementCode || undefined,
      dateFrom: this.lmsPreviewFromDate || undefined,
      dateTo: this.lmsPreviewToDate || undefined,
      limit: 50,
    }).pipe(take(1)).subscribe({
      next: result => this.lmsPreviewRows = result.rows,
      error: err => {
        this.lmsPreviewLoading = false;
        this.handleError(err);
      },
      complete: () => this.lmsPreviewLoading = false,
    });
  }

  protected get latestTrainingRun(): AnomalyTrainingRun | undefined {
    return this.trainingRuns.reduce<AnomalyTrainingRun | undefined>((latest, run) => {
      if (!latest) return run;
      return new Date(run.createdAt).getTime() > new Date(latest.createdAt).getTime() ? run : latest;
    }, undefined);
  }

  protected get latestTrainingRunLabel(): string {
    const latest = this.latestTrainingRun;
    if (!latest) return 'No runs yet';
    return `#${latest.id} ${latest.status}`;
  }

  protected get latestTrainingRunDate(): string {
    return this.latestTrainingRun?.createdAt ?? 'Run training to create one';
  }

  protected get lmsManifest(): any {
    return this.lmsAiStatus?.manifest ?? {};
  }

  protected get lmsModelSummary(): any {
    return this.lmsAiStatus?.modelSummary ?? {};
  }

  protected get lmsModelMetricsEntries(): { name: string; metrics: any }[] {
    const metrics = this.lmsModelSummary?.modelMetrics ?? {};
    return Object.keys(metrics).map(name => ({ name, metrics: metrics[name] }));
  }

  protected get lmsTopStations(): any[] {
    return [...(this.lmsModelSummary?.stationAnomalyRates ?? [])]
      .sort((left, right) => Number(right.anomalyRate) - Number(left.anomalyRate))
      .slice(0, 5);
  }

  protected get lmsTopElements(): any[] {
    return [...(this.lmsModelSummary?.elementAnomalyRates ?? [])]
      .sort((left, right) => Number(right.anomalyRate) - Number(left.anomalyRate))
      .slice(0, 5);
  }

  protected get lmsTopPairs(): any[] {
    return (this.lmsModelSummary?.topStationElementPairs ?? []).slice(0, 5);
  }

  protected get lmsHasOutputs(): boolean {
    return !!this.lmsAiStatus?.available;
  }

  protected formatRate(value: any): string {
    return `${((Number(value) || 0) * 100).toFixed(2)}%`;
  }

  protected formatCount(value: any): string {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue.toLocaleString() : '0';
  }

  protected isElementSelected(code: string): boolean {
    return this.selectedElementCodes.includes(code);
  }

  protected toggleElement(code: string): void {
    if (this.isElementSelected(code)) {
      this.selectedElementCodes = this.selectedElementCodes.filter(item => item !== code);
      return;
    }

    this.selectedElementCodes = [...this.selectedElementCodes, code];
  }

  protected selectModel(model: AnomalyModelMetadata): void {
    if (this.selectedModel?.modelId === model.modelId) {
      return;
    }

    this.selectedModel = model;
    this.loadLatestScoring(model);
  }

  protected isSelectedModel(model: AnomalyModelMetadata): boolean {
    return this.selectedModel?.modelId === model.modelId;
  }

  protected get latestScoringOutcome(): string {
    return this.latestScoring?.mlAnomalyOutputs?.anomalyStatus ?? this.latestScoring?.outcome ?? 'No result loaded';
  }

  protected get latestScoringScore(): number | null {
    return this.latestScoring?.mlAnomalyOutputs?.anomalyScore ?? this.latestScoring?.anomalyScore ?? null;
  }

  protected get latestScoringConfidence(): number | null {
    return this.latestScoring?.mlAnomalyOutputs?.confidenceScore ?? this.latestScoring?.confidenceScore ?? null;
  }

  protected get latestScoringSummary(): string {
    return this.latestScoring?.generativeExplanation?.summary
      ?? this.latestScoring?.externalReviewMetadata?.explanationSummary
      ?? this.latestScoring?.reasons?.[0]
      ?? 'No summary available from the shared observation-ai feed.';
  }

  protected get latestScoringCreatedAt(): string {
    return this.latestScoring?.createdAt ?? 'Not available';
  }

  protected get latestScoringObservedAt(): string {
    return this.latestScoring?.datetime
      ?? this.latestScoring?.externalReviewMetadata?.observationDatetime
      ?? 'Not available';
  }

  protected get latestScoringSeverity(): string {
    return this.latestScoring?.mlAnomalyOutputs?.severity ?? this.latestScoring?.severity ?? 'Not available';
  }

  private buildRequest(): AnomalyTrainingRequest {
    return {
      stationIds: this.selectedStationIds.length ? this.selectedStationIds : undefined,
      elementCodes: this.selectedElementCodes.length ? this.selectedElementCodes : undefined,
      intervals: this.selectedIntervals.length ? this.selectedIntervals : undefined,
      level: this.level,
      fromDate: this.fromDate ? `${this.fromDate}T00:00:00.000Z` : undefined,
      toDate: this.toDate ? `${this.toDate}T23:59:59.000Z` : undefined,
    };
  }

  private handleError(err: any): void {
    this.loading = false;
    this.pagesDataService.showToast({
      title: 'AI Anomaly Management',
      message: err?.error?.message || err?.message || err,
      type: ToastEventTypeEnum.ERROR,
    });
  }

  private parseSupervisorSummary(markdown: string): SupervisorSummarySection[] {
    const normalized = (markdown || '').replace(/\\n/g, '\n');
    const sections = new Map<string, string[]>();
    const headingPattern = /^##\s+(.+)$/;
    let currentTitle = '';

    normalized.split(/\r?\n/).forEach(rawLine => {
      const line = rawLine.trim();
      if (!line || line.startsWith('# LMS Supervisor Summary')) return;
      const headingMatch = line.match(headingPattern);
      if (headingMatch) {
        currentTitle = headingMatch[1].trim();
        sections.set(currentTitle, []);
        return;
      }
      if (!currentTitle) return;
      sections.get(currentTitle)?.push(line.replace(/^-\s*/, ''));
    });

    return this.supervisorSummarySectionTitles.map(title => ({
      title,
      lines: sections.get(title) ?? [],
    }));
  }

  private syncSelectedModel(): void {
    if (this.models.length === 0) {
      this.selectedModel = null;
      this.latestScoring = null;
      this.latestScoringState = 'idle';
      this.latestScoringMessage = 'No persisted trained models are available yet.';
      return;
    }

    const matchingModel = this.selectedModel
      ? this.models.find(model => model.modelId === this.selectedModel?.modelId) ?? null
      : null;

    this.selectedModel = matchingModel ?? this.models[0];
    this.loadLatestScoring(this.selectedModel);
  }

  private loadLatestScoring(model: AnomalyModelMetadata): void {
    this.latestScoring = null;
    this.latestScoringState = 'loading';
    this.latestScoringMessage = 'Loading latest shared anomaly scoring result...';

    this.observationAnomalyAssessmentsService.find({
      stationIds: [model.stationId],
      elementIds: [model.elementId],
      intervals: [model.interval],
      level: model.level,
      page: 1,
      pageSize: 100,
    }).pipe(take(1)).subscribe({
      next: assessments => {
        const latestMatch = assessments
          .filter(assessment => this.matchesSelectedModel(assessment, model))
          .sort((left, right) => this.getLatestAssessmentTimestamp(right) - this.getLatestAssessmentTimestamp(left))[0];

        if (!latestMatch) {
          this.latestScoringState = 'empty';
          this.latestScoringMessage = 'No latest scoring result is exposed yet for this model in the shared observation-ai review feed.';
          return;
        }

        this.latestScoring = latestMatch;
        this.latestScoringState = 'ready';
        this.latestScoringMessage = '';
      },
      error: () => {
        this.latestScoringState = 'error';
        this.latestScoringMessage = 'Latest scoring visibility is not available from the current backend response for this model.';
      }
    });
  }

  private matchesSelectedModel(
    assessment: ViewObservationAnomalyAssessmentModel,
    model: AnomalyModelMetadata,
  ): boolean {
    const assessmentModelId = assessment.mlAnomalyOutputs?.modelId ?? assessment.modelId;
    const assessmentModelVersion = assessment.mlAnomalyOutputs?.modelVersion ?? assessment.modelVersion;

    return assessment.stationId === model.stationId
      && assessment.elementId === model.elementId
      && assessment.interval === model.interval
      && assessment.level === model.level
      && assessmentModelId === model.modelId
      && assessmentModelVersion === model.modelVersion;
  }

  private getLatestAssessmentTimestamp(assessment: ViewObservationAnomalyAssessmentModel): number {
    return new Date(
      assessment.createdAt
      || assessment.datetime
      || assessment.externalReviewMetadata?.runTimestamp
      || 0
    ).getTime();
  }
}
