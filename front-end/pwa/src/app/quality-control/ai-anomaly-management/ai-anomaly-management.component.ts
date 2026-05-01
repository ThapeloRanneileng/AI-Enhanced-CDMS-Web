import { Component, OnDestroy, OnInit } from '@angular/core';
import { catchError, forkJoin, of, Subscription, take } from 'rxjs';
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
import { LmsAiAgentInsights, LmsAiGenAiSummary, LmsAiService, LmsAiStatus } from '../services/lms-ai.service';

interface SupervisorSummarySection {
  title: string;
  lines: string[];
}

interface LmsModelCard {
  name: string;
  contribution: string;
  metrics: any;
  status: string;
}

@Component({
  selector: 'app-ai-anomaly-management',
  templateUrl: './ai-anomaly-management.component.html',
  styleUrls: ['./ai-anomaly-management.component.scss']
})
export class AiAnomalyManagementComponent implements OnInit, OnDestroy {
  private lmsAiLoadSub: Subscription | null = null;
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
  protected isLoadingLmsAi = true;
  protected lmsAiAvailable = false;
  protected lmsAiError = '';
  protected showLegacyProxyControls = false;
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
  protected lmsWarningMessage = '';
  protected lmsPreviewErrorMessage = '';
  protected lmsGenAiSummary: LmsAiGenAiSummary | null = null;
  protected lmsGenAiReviewerRows: Record<string, string>[] = [];
  protected lmsAgentInsights: LmsAiAgentInsights | null = null;
  protected lmsAgentLoading = false;
  protected lmsAgentPrompt = 'Explain current model performance';
  protected readonly lmsAgentPrompts = [
    'Explain current model performance',
    'Summarize highest-risk stations',
    'Recommend reviewer actions',
    'Generate supervisor update',
    'Explain why anomalies are not automatically wrong values',
  ];
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
    this.pagesDataService.setPageHeader('LMS AI Model & Agent Centre');
  }

  ngOnInit(): void {
    this.refreshLists();
  }

  ngOnDestroy(): void {
    this.lmsAiLoadSub?.unsubscribe();
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
    this.loadLmsAiCentre();
    this.loadLegacyObservationAiRecords();
  }

  protected retryLmsAi(): void {
    this.loadLmsAiCentre();
  }

  private loadLmsAiCentre(): void {
    this.lmsAiLoadSub?.unsubscribe();
    this.isLoadingLmsAi = true;
    this.loading = true;
    this.lmsAiAvailable = false;
    this.lmsAiStatus = null;
    this.lmsAiError = '';
    this.lmsWarningMessage = '';
    this.lmsAiLoadSub = forkJoin({
      lmsStatus: this.lmsAiService.status(),
      lmsManifest: this.lmsAiService.manifest(),
      lmsModelSummary: this.lmsAiService.modelSummary(),
      lmsSupervisorSummary: this.lmsAiService.supervisorSummary(),
      lmsGenAiSummary: this.lmsAiService.genAiSummary(),
      lmsGenAiReviewerRows: this.lmsAiService.genAiReviewerExplanations({ limit: 5 }),
    }).pipe(take(1)).subscribe({
      next: data => {
        const manifest = data.lmsStatus?.manifest ?? data.lmsManifest.data ?? null;
        const modelSummary = data.lmsStatus?.modelSummary ?? data.lmsModelSummary.data ?? null;
        const lmsAiAvailable = this.hasLmsAiOutputs(data.lmsStatus, data.lmsManifest, data.lmsModelSummary);

        this.lmsAiStatus = {
          ...data.lmsStatus,
          available: lmsAiAvailable,
          manifest,
          modelSummary,
        };
        this.lmsAiAvailable = lmsAiAvailable;
        this.lmsSupervisorSummary = data.lmsSupervisorSummary.content;
        this.lmsSupervisorSummarySections = this.parseSupervisorSummary(data.lmsSupervisorSummary.content);
        this.lmsGenAiSummary = data.lmsGenAiSummary;
        this.lmsGenAiReviewerRows = data.lmsGenAiReviewerRows.rows;
        this.lmsReports = (data.lmsStatus?.files ?? [])
          .filter(file => file.exists && ['modelSummary', 'modelSummaryMarkdown', 'supervisorSummary', 'manifest', 'qcReview', 'ensemble', 'genaiModelSummary', 'genaiReviewerExplanations'].includes(file.key))
          .map(file => ({ label: file.key, fileName: file.fileName, exists: file.exists }));
        this.lmsAiError = lmsAiAvailable ? '' : this.getLmsAiLoadError([
          data.lmsStatus?.errorMessage,
          data.lmsManifest.errorMessage,
          data.lmsModelSummary.errorMessage,
          data.lmsSupervisorSummary.errorMessage,
          data.lmsGenAiSummary.errorMessage,
          data.lmsGenAiReviewerRows.errorMessage,
        ]);
        this.lmsWarningMessage = this.lmsAiError;
        if (lmsAiAvailable) {
          this.queryAgentInsights(this.lmsAgentPrompt);
        }
      },
      error: err => {
        this.lmsAiAvailable = false;
        this.lmsAiStatus = null;
        this.lmsAiError = this.getFriendlyLmsError(err);
        this.lmsWarningMessage = this.lmsAiError;
        this.isLoadingLmsAi = false;
        this.loading = false;
      },
      complete: () => {
        this.isLoadingLmsAi = false;
        this.loading = false;
      },
    });
  }

  private loadLegacyObservationAiRecords(): void {
    forkJoin({
      proxySources: this.observationAiTrainingService.listProxySources().pipe(catchError(() => of([] as AnomalyProxySource[]))),
      trainingRuns: this.observationAiTrainingService.listTrainingRuns().pipe(catchError(() => of([] as AnomalyTrainingRun[]))),
      models: this.observationAiTrainingService.listModels().pipe(catchError(() => of([] as AnomalyModelMetadata[]))),
    }).pipe(take(1)).subscribe(data => {
      this.proxySources = data.proxySources;
      this.trainingRuns = data.trainingRuns;
      this.models = data.models;
      this.syncSelectedModel();
    });
  }

  protected previewLmsDataset(): void {
    this.lmsPreviewLoading = true;
    this.lmsPreviewErrorMessage = '';
    this.lmsAiService.normalizedObservations({
      stationId: this.lmsPreviewStationId || undefined,
      elementCode: this.lmsPreviewElementCode || undefined,
      dateFrom: this.lmsPreviewFromDate || undefined,
      dateTo: this.lmsPreviewToDate || undefined,
      limit: 50,
    }).pipe(take(1)).subscribe({
      next: result => {
        this.lmsPreviewRows = result.rows;
        this.lmsPreviewErrorMessage = result.errorMessage || '';
        if (result.errorMessage) {
          this.lmsPreviewRows = [];
        }
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

  protected get lmsModelCards(): LmsModelCard[] {
    const metrics = this.lmsModelSummary?.modelMetrics ?? {};
    const statusRows = this.lmsModelSummary?.modelStatus ?? [];
    const statusFor = (name: string) => statusRows.find((row: any) => `${row.modelName}`.toLowerCase() === name.toLowerCase())?.status
      || (metrics[name] ? 'trained/available' : 'not available');
    return [
      {
        name: 'Z-score baseline',
        metrics: metrics['Z-score'],
        status: metrics['Z-score'] ? 'trained/available' : 'not available',
        contribution: 'Seasonal statistical baseline that flags values far from learned LMS station-element distributions.',
      },
      {
        name: 'Isolation Forest',
        metrics: metrics['Isolation Forest'],
        status: statusFor('Isolation Forest'),
        contribution: 'Learns feature-space isolation patterns and contributes model-agreement evidence for unusual LMS observations.',
      },
      {
        name: 'One-Class SVM',
        metrics: metrics['One-Class SVM'],
        status: statusFor('One-Class SVM'),
        contribution: 'Learns a normal historical boundary and flags LMS observations outside that support.',
      },
      {
        name: 'Autoencoder',
        metrics: metrics['Autoencoder'],
        status: statusFor('Autoencoder'),
        contribution: 'Uses reconstruction error to highlight station-element patterns that do not match learned historical structure.',
      },
      {
        name: 'Ensemble decision layer',
        metrics: metrics['Ensemble'],
        status: metrics['Ensemble'] ? 'trained/available' : 'not available',
        contribution: 'Combines model outcomes into the final NORMAL, SUSPECT, or FAILED QC review handoff decision.',
      },
    ];
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
    return this.lmsAiAvailable;
  }

  protected get lmsStatusLoaded(): boolean {
    return !!this.lmsAiStatus;
  }

  protected get lmsGenAiProvider(): string {
    const provider = this.lmsGenAiSummary?.provider
      || this.lmsGenAiSummary?.effectiveProvider
      || this.lmsAiStatus?.effectiveGenaiProvider
      || this.lmsAiStatus?.genaiProvider
      || this.lmsManifest.effectiveGenaiProvider
      || this.lmsManifest.genaiProvider
      || 'Not available';
    return this.formatProvider(provider);
  }

  protected get lmsRequestedGenAiProvider(): string {
    const provider = this.lmsGenAiSummary?.requestedProvider
      || this.lmsAiStatus?.requestedGenaiProvider
      || this.lmsManifest.requestedGenaiProvider
      || this.lmsManifest.genaiProvider
      || 'Not available';
    return this.formatProvider(provider);
  }

  protected get lmsEffectiveGenAiProvider(): string {
    const provider = this.lmsGenAiSummary?.effectiveProvider
      || this.lmsAiStatus?.effectiveGenaiProvider
      || this.lmsManifest.effectiveGenaiProvider
      || this.lmsAiStatus?.genaiProvider
      || this.lmsManifest.genaiProvider
      || 'Not available';
    return this.formatProvider(provider);
  }

  protected get lmsConfiguredGenAiProvider(): string {
    const provider = this.lmsAiStatus?.genaiProvider
      || this.lmsManifest.genaiProvider
      || this.lmsGenAiSummary?.provider
      || 'Not available';
    return this.formatProvider(provider);
  }

  protected get lmsGenAiProviderStatus(): string {
    return this.lmsGenAiSummary?.status
      || this.lmsAiStatus?.genaiProviderStatus
      || this.lmsManifest.genaiProviderStatus
      || 'Not available';
  }

  protected get lmsGenAiFallbackReason(): string {
    return this.lmsGenAiSummary?.fallbackReason
      || this.lmsAiStatus?.genaiFallbackReason
      || this.lmsManifest.genaiFallbackReason
      || '';
  }

  protected get isTemplateGenAiProvider(): boolean {
    return `${this.lmsGenAiProvider}`.toLowerCase().includes('template');
  }

  protected formatRate(value: any): string {
    return `${((Number(value) || 0) * 100).toFixed(2)}%`;
  }

  protected formatCount(value: any): string {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue.toLocaleString() : '0';
  }

  protected get lmsTrainingSource(): string {
    return 'LMS historical climate data';
  }

  protected get lmsTrainingPeriod(): string {
    const summaryRows = this.lmsModelSummary?.trainTestSummary ?? this.lmsModelSummary?.trainingPeriod;
    if (typeof summaryRows === 'string') return summaryRows;
    const from = this.lmsManifest.trainingRangeFrom || this.lmsModelSummary?.trainingRangeFrom || this.lmsModelSummary?.minObservationDate;
    const to = this.lmsManifest.trainingRangeTo || this.lmsModelSummary?.trainingRangeTo || this.lmsModelSummary?.maxObservationDate;
    if (from || to) return `${from || 'start'} to ${to || 'end'}`;
    return 'Historical LMS range from pipeline manifest/model summary';
  }

  protected get lmsTrainedStationsCount(): string {
    const count = this.lmsManifest.trainedStationsCount
      || this.lmsModelSummary?.trainedStationsCount
      || this.lmsModelSummary?.stationAnomalyRates?.length;
    return count ? this.formatCount(count) : 'Not available';
  }

  protected get lmsTrainedElements(): string {
    const elements = this.lmsManifest.trainedElements
      || this.lmsModelSummary?.trainedElements
      || this.lmsModelSummary?.elementAnomalyRates?.map((row: any) => row.elementCode);
    return Array.isArray(elements) && elements.length ? elements.join(', ') : 'Present in LMS historical data';
  }

  protected get lmsPipelineVersion(): string {
    return this.lmsManifest.pipelineVersion || this.lmsManifest.pipelineName || 'Not available';
  }

  protected get modelVersion(): string {
    return this.lmsManifest.runId || this.lmsPipelineVersion;
  }

  protected queryAgentInsights(prompt: string): void {
    if (!this.lmsAiStatus?.available) return;
    this.lmsAgentPrompt = prompt;
    this.lmsAgentLoading = true;
    this.lmsAiService.agentInsights({ prompt, limit: 5 }).pipe(take(1)).subscribe({
      next: result => this.lmsAgentInsights = result,
      complete: () => this.lmsAgentLoading = false,
    });
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

  private formatProvider(provider: string): string {
    const value = `${provider}`.toLowerCase();
    if (value.includes('gemini')) return 'Gemini';
    if (value.includes('groq')) return 'Groq';
    if (value.includes('template')) return 'Template fallback';
    return provider;
  }

  private hasLmsAiOutputs(status: LmsAiStatus, manifestResponse: any, modelSummaryResponse: any): boolean {
    const hasManifest = !!status?.manifest || !!manifestResponse?.data || !!manifestResponse?.exists;
    const hasModelSummary = !!status?.modelSummary || !!modelSummaryResponse?.data || !!modelSummaryResponse?.exists;
    const hasOutputFile = (status?.files ?? []).some(file => file.exists && ['manifest', 'modelSummary', 'qcReview', 'ensemble'].includes(file.key));
    return (!!status?.available && !status?.restricted) || hasManifest || hasModelSummary || hasOutputFile;
  }

  private getLmsAiLoadError(messages: Array<string | undefined>): string {
    return messages.find(message => !!message)
      || 'LMS AI outputs could not be loaded. Check that the backend API is running and the user is logged in.';
  }

  private getFriendlyLmsError(err: any): string {
    return err?.error?.message
      || err?.error?.errorMessage
      || err?.message
      || 'LMS AI outputs could not be loaded. Check that the backend API is running and the user is logged in.';
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
