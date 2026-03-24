import { Component, OnDestroy, ViewChild } from '@angular/core';
import { ViewObservationQueryModel } from 'src/app/data-ingestion/models/view-observation-query.model';
import { PagesDataService, ToastEventTypeEnum } from 'src/app/core/services/pages-data.service';
import { Subject, firstValueFrom, take, takeUntil } from 'rxjs';
import { IntervalsUtil } from 'src/app/shared/controls/interval-selector/Intervals.util';
import { NumberUtils } from 'src/app/shared/utils/number.utils';
import { PagingParameters } from 'src/app/shared/controls/page-input/paging-parameters';
import { DateUtils } from 'src/app/shared/utils/date.utils';
import { CachedMetadataService } from 'src/app/metadata/metadata-updates/cached-metadata.service';
import { ObservationsService } from 'src/app/data-ingestion/services/observations.service';
import { QCAssessmentsService } from 'src/app/quality-control/services/qc-assessments.service';
import { QCStatusEnum } from 'src/app/data-ingestion/models/qc-status.enum';
import { ObservationEntry } from 'src/app/observations/models/observation-entry.model';
import { QuerySelectionComponent } from 'src/app/observations/query-selection/query-selection.component';
import { PerformQCDialogComponent } from './perform-qc-dialog/perform-qc-dialog.component';
import { ViewObservationAnomalyAssessmentModel } from '../models/view-observation-anomaly-assessment.model';
import { ObservationAnomalyAssessmentsService } from '../services/observation-anomaly-assessments.service';
import { StringUtils } from 'src/app/shared/utils/string.utils';
import { AppAuthService } from 'src/app/app-auth.service';
import { AppDatabase, AppComponentState, UserAppStateEnum } from 'src/app/app-database';

type ReviewerDecision = 'pending' | 'approved' | 'overridden' | 'escalated';

interface PersistedQCReviewDecision {
  decision: ReviewerDecision;
  notes: string;
  reviewedAt: string;
  reviewedByEmail?: string;
}

interface PersistedQCReviewState {
  reviews: Record<string, PersistedQCReviewDecision>;
}

interface QCReviewItem {
  key: string;
  observationEntry: ObservationEntry | null;
  stationId: string;
  elementId: number;
  level: number;
  interval: number;
  sourceId: number;
  observationDatetime: string;
  stationName: string;
  elementName: string;
  sourceName: string;
  formattedDatetime: string;
  intervalName: string;
  observationValue: number | null;
  observationFlag: string | null;
  observationComment: string | null;
  ruleStatus: 'Failed' | 'Passed' | 'Not Run';
  failedChecks: string[];
  aiAssessment: ViewObservationAnomalyAssessmentModel | null;
  aiConfidence: number | null;
  aiExplanation: string;
  reviewerDecision: ReviewerDecision;
  reviewerNotes: string;
  reviewedAt: string | null;
  reviewedByEmail: string | null;
}

@Component({
  selector: 'app-qc-assessment',
  templateUrl: './qc-assessment.component.html',
  styleUrls: ['./qc-assessment.component.scss']
})
export class QCAssessmentComponent implements OnDestroy {
  @ViewChild('querySelection') querySelection!: QuerySelectionComponent;
  @ViewChild('performQCDialog') performQCDialog!: PerformQCDialogComponent;

  protected reviewItems: QCReviewItem[] = [];
  protected pageInputDefinition: PagingParameters = new PagingParameters();
  protected enableQueryButton: boolean = true;
  protected enablePerformQCButton: boolean = true;
  protected queryFilter: ViewObservationQueryModel = { qcStatus: QCStatusEnum.FAILED };
  private allMetadataLoaded: boolean = false;
  protected selectedReviewKey: string | null = null;
  protected reviewerNotesDraft: string = '';
  protected queueSearch: string = '';
  protected reviewDecisionFilter: 'all' | ReviewerDecision = 'all';
  protected loadingAiContext: boolean = false;
  protected currentUserEmail: string = '';
  private allReviewItems: QCReviewItem[] = [];

  private destroy$ = new Subject<void>();

  constructor(
    private pagesDataService: PagesDataService,
    private appAuthService: AppAuthService,
    private cachedMetadataSearchService: CachedMetadataService,
    private observationService: ObservationsService,
    private qcAssessmentsService: QCAssessmentsService,
    private observationAnomalyAssessmentsService: ObservationAnomalyAssessmentsService,
  ) {
    this.pagesDataService.setPageHeader('QC Review Workspace');
    this.pageInputDefinition.setPageSize(18);

    this.appAuthService.user.pipe(
      takeUntil(this.destroy$),
    ).subscribe(user => {
      if (!user) {
        return;
      }

      this.currentUserEmail = user.email;
    });

    this.cachedMetadataSearchService.allMetadataLoaded.pipe(
      takeUntil(this.destroy$),
    ).subscribe(allMetadataLoaded => {
      if (!allMetadataLoaded) return;
      this.allMetadataLoaded = allMetadataLoaded;
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  protected get componentName(): string {
    return QCAssessmentComponent.name;
  }

  protected onQueryQCClick(queryFilter: ViewObservationQueryModel): void {
    this.queryFilter = { ...queryFilter, qcStatus: undefined };
    this.queryData();
  }

  protected onShowPerformQCDialog(): void {
    this.queryFilter = this.querySelection.getFilter();
    this.performQCDialog.showDialog(this.queryFilter)
  }

  protected onQCPerformedClick(): void {
    this.queryFilter = { ...this.querySelection.getFilter(), qcStatus: undefined };
    this.queryData();
  }

  private queryData(): void {
    if (!(this.allMetadataLoaded && this.queryFilter)) {
      return;
    }

    this.allReviewItems = [];
    this.reviewItems = [];
    this.selectedReviewKey = null;
    this.reviewerNotesDraft = '';
    this.pageInputDefinition.onFirst();
    this.pageInputDefinition.setTotalRowCount(0);
    this.enableQueryButton = false;
    this.loadData();
  }

  protected loadData(): void {
    this.enableQueryButton = false;
    this.loadingAiContext = true;
    void this.loadUnifiedReviewData();
  }

  protected get filteredReviewItems(): QCReviewItem[] {
    return this.reviewItems;
  }

  protected get hasSelection(): boolean {
    return !!this.selectedReviewItem;
  }

  protected onQueueFiltersChanged(): void {
    this.pageInputDefinition.onFirst();
    this.updateVisibleReviewItems();
  }

  protected onQueuePageChanged(): void {
    this.updateVisibleReviewItems();
  }

  protected get unifiedReviewCount(): number {
    return this.allReviewItems.length;
  }

  protected get failedRuleCount(): number {
    return this.allReviewItems.filter(item => item.ruleStatus === 'Failed').length;
  }

  protected get aiFlaggedCount(): number {
    return this.allReviewItems.filter(item => {
      const outcome = item.aiAssessment?.outcome;
      return outcome === 'failed' || outcome === 'suspect';
    }).length;
  }

  protected get completedDecisionCount(): number {
    return this.allReviewItems.filter(item => item.reviewerDecision !== 'pending').length;
  }

  protected get averageAIConfidence(): number {
    const confidences = this.allReviewItems
      .map(item => item.aiConfidence)
      .filter((confidence): confidence is number => confidence !== null);
    if (confidences.length === 0) {
      return 0;
    }

    return Math.round(confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length);
  }

  private getFilteredReviewItems(): QCReviewItem[] {
    return this.allReviewItems.filter(item => {
      const searchValue = this.queueSearch.trim().toLowerCase();
      const matchesSearch = searchValue.length === 0
        || item.stationName.toLowerCase().includes(searchValue)
        || item.elementName.toLowerCase().includes(searchValue)
        || item.sourceName.toLowerCase().includes(searchValue)
        || item.stationId.toLowerCase().includes(searchValue)
        || `${item.elementId}`.includes(searchValue)
        || `${item.sourceId}`.includes(searchValue)
        || item.failedChecks.some(check => check.toLowerCase().includes(searchValue))
        || item.aiExplanation.toLowerCase().includes(searchValue);
      const matchesDecision = this.reviewDecisionFilter === 'all' || item.reviewerDecision === this.reviewDecisionFilter;
      return matchesSearch && matchesDecision;
    });
  }

  protected get selectedReviewItem(): QCReviewItem | undefined {
    return this.allReviewItems.find(item => item.key === this.selectedReviewKey);
  }

  protected get hasLoadedQueue(): boolean {
    return this.enableQueryButton;
  }

  protected clearWorkspaceFilters(): void {
    this.queryFilter = { qcStatus: QCStatusEnum.FAILED };
    this.allReviewItems = [];
    this.reviewItems = [];
    this.selectedReviewKey = null;
    this.reviewerNotesDraft = '';
    this.queueSearch = '';
    this.reviewDecisionFilter = 'all';
    this.pageInputDefinition.onFirst();
    this.pageInputDefinition.setTotalRowCount(0);
  }

  protected selectReviewItem(reviewKey: string | null, syncDraft: boolean = true): void {
    this.selectedReviewKey = reviewKey;
    if (!syncDraft) {
      return;
    }

    const reviewItem = this.selectedReviewItem;
    this.reviewerNotesDraft = reviewItem?.reviewerNotes ?? '';
  }

  protected async onSelectDecision(decision: ReviewerDecision): Promise<void> {
    const selectedReviewItem = this.selectedReviewItem;
    if (!selectedReviewItem) {
      return;
    }

    selectedReviewItem.reviewerDecision = decision;
    selectedReviewItem.reviewerNotes = this.reviewerNotesDraft.trim();
    selectedReviewItem.reviewedAt = new Date().toISOString();
    selectedReviewItem.reviewedByEmail = this.currentUserEmail || null;
    await this.persistReviewItem(selectedReviewItem);
    this.updateVisibleReviewItems();
    this.pagesDataService.showToast({
      title: 'QC Review Workspace',
      message: `Reviewer decision saved as ${this.formatDecision(decision)}.`,
      type: ToastEventTypeEnum.SUCCESS
    });
  }

  protected async onSaveReviewerNotes(): Promise<void> {
    const selectedReviewItem = this.selectedReviewItem;
    if (!selectedReviewItem) {
      return;
    }

    selectedReviewItem.reviewerNotes = this.reviewerNotesDraft.trim();
    if (!selectedReviewItem.reviewedAt) {
      selectedReviewItem.reviewedAt = new Date().toISOString();
      selectedReviewItem.reviewedByEmail = this.currentUserEmail || null;
    }

    await this.persistReviewItem(selectedReviewItem);
    this.updateVisibleReviewItems();
    this.pagesDataService.showToast({
      title: 'QC Review Workspace',
      message: 'Reviewer notes saved.',
      type: ToastEventTypeEnum.SUCCESS
    });
  }

  protected getRowNumber(currentRowIndex: number): number {
    return NumberUtils.getRowNumber(this.pageInputDefinition.page, this.pageInputDefinition.pageSize, currentRowIndex);
  }

  protected formatDecision(decision: ReviewerDecision): string {
    return StringUtils.formatEnumForDisplay(decision);
  }

  protected formatRuleStatus(item: QCReviewItem): string {
    return item.ruleStatus;
  }

  protected formatAIOutcome(item: QCReviewItem): string {
    const mlStatus = item.aiAssessment?.mlAnomalyOutputs?.anomalyStatus ?? item.aiAssessment?.outcome;
    return mlStatus ? StringUtils.formatEnumForDisplay(mlStatus) : 'No ML anomaly assessment';
  }

  protected formatAIScore(item: QCReviewItem): string {
    const score = item.aiAssessment?.mlAnomalyOutputs?.anomalyScore ?? item.aiAssessment?.anomalyScore;
    return score !== undefined ? `${NumberUtils.roundOff(score, 3)}` : '—';
  }

  protected formatAIConfidence(item: QCReviewItem): string {
    return item.aiConfidence !== null ? `${item.aiConfidence}%` : '—';
  }

  protected getMlModelLabel(item: QCReviewItem): string {
    if (!item.aiAssessment) {
      return 'No ML model output';
    }

    const modelFamily = item.aiAssessment.mlAnomalyOutputs?.modelFamily ?? item.aiAssessment.modelFamily ?? 'ml_anomaly_model';
    const modelId = item.aiAssessment.mlAnomalyOutputs?.modelId ?? item.aiAssessment.modelId;
    const modelVersion = item.aiAssessment.mlAnomalyOutputs?.modelVersion ?? item.aiAssessment.modelVersion;
    return `${StringUtils.formatEnumForDisplay(modelFamily)} • ${modelId} ${modelVersion}`;
  }

  protected getMlModelName(item: QCReviewItem): string {
    if (!item.aiAssessment) {
      return 'No model output';
    }

    const modelFamily = item.aiAssessment.mlAnomalyOutputs?.modelFamily ?? item.aiAssessment.modelFamily ?? 'ml_anomaly_model';
    const modelId = item.aiAssessment.mlAnomalyOutputs?.modelId ?? item.aiAssessment.modelId;
    return `${StringUtils.formatEnumForDisplay(modelFamily)} • ${modelId}`;
  }

  protected getMlModelVersion(item: QCReviewItem): string {
    if (!item.aiAssessment) {
      return '—';
    }

    return item.aiAssessment.mlAnomalyOutputs?.modelVersion ?? item.aiAssessment.modelVersion;
  }

  protected getGenerativeSummary(item: QCReviewItem): string {
    return item.aiAssessment?.generativeExplanation?.summary ?? item.aiExplanation;
  }

  protected getGenerativeAbnormalPatterns(item: QCReviewItem): string[] {
    return item.aiAssessment?.generativeExplanation?.abnormalPatterns ?? [];
  }

  protected getSuggestedReviewerAction(item: QCReviewItem): string {
    return item.aiAssessment?.generativeExplanation?.suggestedReviewerAction
      ?? 'Review the observation context and record the final reviewer decision.';
  }

  protected getReviewerGuidance(item: QCReviewItem): string {
    return item.aiAssessment?.generativeExplanation?.reviewerGuidance
      ?? 'Generative explanation is not available for this record.';
  }

  protected getMlSignals(item: QCReviewItem) {
    return item.aiAssessment?.mlAnomalyOutputs?.contributingSignals ?? item.aiAssessment?.contributingSignals ?? [];
  }

  protected getTopMlSignals(item: QCReviewItem) {
    return this.getMlSignals(item).slice(0, 3);
  }

  protected getFailedChecksSummary(item: QCReviewItem): string {
    return item.failedChecks.length > 0 ? `${item.failedChecks.length} recorded` : 'None recorded';
  }

  protected getWhyFlaggedBullets(item: QCReviewItem): string[] {
    const bullets: string[] = [];
    const patterns = this.getGenerativeAbnormalPatterns(item);

    bullets.push(...patterns.slice(0, 2));

    if (item.failedChecks.length > 0) {
      bullets.push(`${item.failedChecks.length} rule-based failed check${item.failedChecks.length > 1 ? 's' : ''}`);
    }

    if (bullets.length < 3 && this.getTopMlSignals(item).length > 0) {
      const signal = this.getTopMlSignals(item)[0];
      bullets.push(`${signal.signal} on ${signal.feature} (${signal.direction})`);
    }

    if (bullets.length === 0) {
      bullets.push(this.getGenerativeSummary(item));
    }

    return bullets.slice(0, 3);
  }

  protected getCompactReviewerAction(item: QCReviewItem): string {
    return item.aiAssessment?.generativeExplanation?.suggestedReviewerAction
      ?? 'Review the record and capture the final reviewer decision.';
  }

  protected closeDetailPane(): void {
    this.selectReviewItem(null);
  }

  protected formatReviewTimestamp(item: QCReviewItem): string {
    return item.reviewedAt ? DateUtils.getPresentableDatetime(item.reviewedAt, this.cachedMetadataSearchService.utcOffSet) : 'Not reviewed';
  }

  protected getRuleStatusClass(item: QCReviewItem): string {
    switch (item.ruleStatus) {
      case 'Failed':
        return 'badge bg-danger-subtle text-danger-emphasis';
      case 'Passed':
        return 'badge bg-success-subtle text-success-emphasis';
      default:
        return 'badge bg-secondary-subtle text-secondary-emphasis';
    }
  }

  protected getAIOutcomeClass(item: QCReviewItem): string {
    const outcome = item.aiAssessment?.mlAnomalyOutputs?.anomalyStatus ?? item.aiAssessment?.outcome;
    switch (outcome) {
      case 'failed':
        return 'badge bg-danger-subtle text-danger-emphasis';
      case 'suspect':
        return 'badge bg-warning-subtle text-warning-emphasis';
      case 'passed':
        return 'badge bg-success-subtle text-success-emphasis';
      default:
        return 'badge bg-secondary-subtle text-secondary-emphasis';
    }
  }

  protected getDecisionClass(decision: ReviewerDecision): string {
    switch (decision) {
      case 'approved':
        return 'badge bg-success-subtle text-success-emphasis';
      case 'overridden':
        return 'badge bg-warning-subtle text-warning-emphasis';
      case 'escalated':
        return 'badge bg-danger-subtle text-danger-emphasis';
      default:
        return 'badge bg-secondary-subtle text-secondary-emphasis';
    }
  }

  private async loadUnifiedReviewData(): Promise<void> {
    try {
      const baseQuery: ViewObservationQueryModel = {
        ...this.queryFilter,
        qcStatus: undefined,
      };

      const [allObservations, allAnomalyAssessments, reviewState] = await Promise.all([
        this.fetchAllObservations(baseQuery),
        this.fetchAllAnomalyAssessments(baseQuery),
        this.loadReviewState(),
      ]);

      console.info('[QC Review Workspace] Unified review source counts', {
        processedObservationsCount: allObservations.length,
        anomalyAssessmentsCount: allAnomalyAssessments.length,
        persistedReviewCount: Object.keys(reviewState.reviews).length,
      });

      const observationEntries = allObservations.map(observation => this.createObservationEntry(observation));
      const observationEntryMap = new Map<string, ObservationEntry>();
      for (const entry of observationEntries) {
        const observationKey = this.getObservationKey(entry);
        console.info('[QC Review Workspace] Observation review key', {
          stationId: entry.observation.stationId,
          elementId: entry.observation.elementId,
          level: entry.observation.level,
          datetime: entry.observation.datetime,
          interval: entry.observation.interval,
          sourceId: entry.observation.sourceId,
          sourceUtcOffset: this.cachedMetadataSearchService.getSource(entry.observation.sourceId).utcOffset,
          observationKey,
        });
        observationEntryMap.set(observationKey, entry);
      }

      const assessmentMap = new Map<string, ViewObservationAnomalyAssessmentModel>();
      for (const assessment of allAnomalyAssessments) {
        const rawAssessmentKey = this.getObservationKeyFromParts(
          assessment.stationId,
          assessment.elementId,
          assessment.level,
          assessment.datetime,
          assessment.interval,
          assessment.sourceId,
        );
        const normalizedAssessmentKey = this.getNormalizedReviewKeyFromParts(
          assessment.stationId,
          assessment.elementId,
          assessment.level,
          assessment.datetime,
          assessment.interval,
          assessment.sourceId,
        );
        this.logAssessmentKeyVerification(assessment, normalizedAssessmentKey, rawAssessmentKey, observationEntryMap);
        console.info('[QC Review Workspace] Anomaly assessment review key', {
          stationId: assessment.stationId,
          elementId: assessment.elementId,
          level: assessment.level,
          datetime: assessment.datetime,
          normalizedDatetime: this.normalizeObservationDatetime(assessment.datetime, assessment.sourceId),
          interval: assessment.interval,
          sourceId: assessment.sourceId,
          sourceUtcOffset: this.cachedMetadataSearchService.getSource(assessment.sourceId).utcOffset,
          rawAssessmentKey,
          normalizedAssessmentKey,
        });
        if (!assessmentMap.has(normalizedAssessmentKey)) {
          assessmentMap.set(normalizedAssessmentKey, assessment);
        }
      }

      const unifiedKeys = new Set<string>([
        ...observationEntryMap.keys(),
        ...assessmentMap.keys(),
        ...Object.keys(reviewState.reviews),
      ]);

      console.info('[QC Review Workspace] Unified review key count', {
        unifiedKeysCount: unifiedKeys.size,
      });

      this.allReviewItems = [];
      const droppedKeys: string[] = [];

      for (const key of unifiedKeys) {
        const entry = observationEntryMap.get(key);
        const aiAssessment = assessmentMap.get(key) ?? null;
        const persistedReview = reviewState.reviews[key];
        const failedChecks = (entry?.qcTestsFailed ?? []).map(check => check.name);
        const ruleFailed = entry
          ? entry.observation.qcStatus === QCStatusEnum.FAILED || failedChecks.length > 0
          : false;
        const aiFlagged = aiAssessment?.outcome === 'suspect' || aiAssessment?.outcome === 'failed';
        const reviewed = !!persistedReview;

        if (!(ruleFailed || aiFlagged || reviewed)) {
          droppedKeys.push(key);
          continue;
        }

        const itemMetadata = this.buildReviewItemMetadata(key, entry, aiAssessment);
        this.allReviewItems.push({
          key,
          observationEntry: entry ?? null,
          ...itemMetadata,
          ruleStatus: entry ? this.getRuleStatus(entry) : 'Not Run',
          failedChecks,
          aiAssessment,
          aiConfidence: this.getAIConfidence(aiAssessment),
          aiExplanation: this.getAIExplanation(aiAssessment),
          reviewerDecision: persistedReview?.decision ?? 'pending',
          reviewerNotes: persistedReview?.notes ?? '',
          reviewedAt: persistedReview?.reviewedAt ?? null,
          reviewedByEmail: persistedReview?.reviewedByEmail ?? null,
        });
      }

      this.allReviewItems.sort((left, right) =>
        new Date(right.observationDatetime).getTime()
        - new Date(left.observationDatetime).getTime()
      );

      console.info('[QC Review Workspace] Dropped unified review keys', {
        droppedKeysCount: droppedKeys.length,
        droppedKeys,
      });

      this.updateVisibleReviewItems();

      if (this.allReviewItems.length === 0) {
        this.pagesDataService.showToast({ title: 'QC Review Workspace', message: 'No data', type: ToastEventTypeEnum.INFO });
      }
    } catch (err) {
      this.pagesDataService.showToast({ title: 'QC Review Workspace', message: `${err}`, type: ToastEventTypeEnum.ERROR });
    } finally {
      this.enableQueryButton = true;
      this.loadingAiContext = false;
    }
  }

  private createObservationEntry(observation: ObservationEntry['observation']): ObservationEntry {
    const stationMetadata = this.cachedMetadataSearchService.getStation(observation.stationId);
    const elementMetadata = this.cachedMetadataSearchService.getElement(observation.elementId);
    const sourceMetadata = this.cachedMetadataSearchService.getSource(observation.sourceId);
    const qcTestLogMetadata = observation.qcTestLog ?
      observation.qcTestLog
        .filter(qcLogItem => qcLogItem.qcStatus == QCStatusEnum.FAILED)
        .map(qcLogItem => this.cachedMetadataSearchService.getQCTest(qcLogItem.qcTestId)) : [];

    return {
      observation,
      confirmAsCorrect: false,
      delete: false,
      change: 'no_change',
      hardDelete: false,
      restore: false,
      stationName: stationMetadata.name,
      elementAbbrv: elementMetadata.name,
      sourceName: sourceMetadata.name,
      formattedDatetime: DateUtils.getPresentableDatetime(observation.datetime, this.cachedMetadataSearchService.utcOffSet),
      intervalName: IntervalsUtil.getIntervalName(observation.interval),
      qcTestsFailed: qcTestLogMetadata,
    };
  }

  private getObservationKey(entry: ObservationEntry): string {
    return this.getNormalizedReviewKeyFromParts(
      entry.observation.stationId,
      entry.observation.elementId,
      entry.observation.level,
      entry.observation.datetime,
      entry.observation.interval,
      entry.observation.sourceId,
    );
  }

  private getObservationKeyFromParts(
    stationId: string,
    elementId: number,
    level: number,
    datetime: string,
    interval: number,
    sourceId: number,
  ): string {
    return [stationId, elementId, level, datetime, interval, sourceId].join('|');
  }

  private getNormalizedReviewKeyFromParts(
    stationId: string,
    elementId: number,
    level: number,
    datetime: string,
    interval: number,
    sourceId: number,
  ): string {
    return this.getObservationKeyFromParts(
      stationId,
      elementId,
      level,
      this.normalizeObservationDatetime(datetime, sourceId),
      interval,
      sourceId,
    );
  }

  private normalizeObservationDatetime(datetime: string, sourceId: number): string {
    const sourceMetadata = this.cachedMetadataSearchService.getSource(sourceId);
    const normalizedDatetime = DateUtils.getDatetimesBasedOnUTCOffset(datetime, sourceMetadata.utcOffset, 'add');
    return new Date(normalizedDatetime).toISOString();
  }

  private parseReviewKey(key: string): {
    stationId: string;
    elementId: number;
    level: number;
    datetime: string;
    interval: number;
    sourceId: number;
  } {
    const [stationId, elementId, level, datetime, interval, sourceId] = key.split('|');
    return {
      stationId,
      elementId: Number(elementId),
      level: Number(level),
      datetime,
      interval: Number(interval),
      sourceId: Number(sourceId),
    };
  }

  private buildReviewItemMetadata(
    key: string,
    observationEntry: ObservationEntry | undefined,
    aiAssessment: ViewObservationAnomalyAssessmentModel | null,
  ): Pick<QCReviewItem,
    'stationId'
    | 'elementId'
    | 'level'
    | 'interval'
    | 'sourceId'
    | 'observationDatetime'
    | 'stationName'
    | 'elementName'
    | 'sourceName'
    | 'formattedDatetime'
    | 'intervalName'
    | 'observationValue'
    | 'observationFlag'
    | 'observationComment'> {
    if (observationEntry) {
      return {
        stationId: observationEntry.observation.stationId,
        elementId: observationEntry.observation.elementId,
        level: observationEntry.observation.level,
        interval: observationEntry.observation.interval,
        sourceId: observationEntry.observation.sourceId,
        observationDatetime: observationEntry.observation.datetime,
        stationName: observationEntry.stationName ?? observationEntry.observation.stationId,
        elementName: observationEntry.elementAbbrv ?? `${observationEntry.observation.elementId}`,
        sourceName: observationEntry.sourceName ?? `${observationEntry.observation.sourceId}`,
        formattedDatetime: observationEntry.formattedDatetime ?? observationEntry.observation.datetime,
        intervalName: observationEntry.intervalName ?? IntervalsUtil.getIntervalName(observationEntry.observation.interval),
        observationValue: observationEntry.observation.value,
        observationFlag: observationEntry.observation.flag,
        observationComment: observationEntry.observation.comment,
      };
    }

    const keyParts = this.parseReviewKey(key);
    const stationMetadata = this.cachedMetadataSearchService.getStation(keyParts.stationId);
    const elementMetadata = this.cachedMetadataSearchService.getElement(keyParts.elementId);
    const sourceMetadata = this.cachedMetadataSearchService.getSource(keyParts.sourceId);
    const displayDatetime = aiAssessment?.datetime ?? keyParts.datetime;

    return {
      stationId: keyParts.stationId,
      elementId: keyParts.elementId,
      level: keyParts.level,
      interval: keyParts.interval,
      sourceId: keyParts.sourceId,
      observationDatetime: keyParts.datetime,
      stationName: stationMetadata?.name ?? keyParts.stationId,
      elementName: elementMetadata?.name ?? `Element ${keyParts.elementId}`,
      sourceName: sourceMetadata?.name ?? `Source ${keyParts.sourceId}`,
      formattedDatetime: DateUtils.getPresentableDatetime(displayDatetime, this.cachedMetadataSearchService.utcOffSet),
      intervalName: IntervalsUtil.getIntervalName(keyParts.interval),
      observationValue: null,
      observationFlag: null,
      observationComment: aiAssessment
        ? 'Rendered from ML anomaly assessment because no processed observation matched this key.'
        : 'Rendered from persisted reviewer state because no current processed observation matched this key.',
    };
  }

  private logAssessmentKeyVerification(
    assessment: ViewObservationAnomalyAssessmentModel,
    normalizedAssessmentKey: string,
    rawAssessmentKey: string,
    observationEntryMap: Map<string, ObservationEntry>,
  ): void {
    const normalizedMatch = observationEntryMap.get(normalizedAssessmentKey);
    const rawMatch = observationEntryMap.get(rawAssessmentKey);

    console.info('[QC Review Workspace] Assessment join verification', {
      stationIdMatches: normalizedMatch ? normalizedMatch.observation.stationId === assessment.stationId : false,
      elementIdMatches: normalizedMatch ? normalizedMatch.observation.elementId === assessment.elementId : false,
      levelMatches: normalizedMatch ? normalizedMatch.observation.level === assessment.level : false,
      datetimeMatchesAfterNormalization: normalizedMatch
        ? this.normalizeObservationDatetime(normalizedMatch.observation.datetime, normalizedMatch.observation.sourceId)
          === this.normalizeObservationDatetime(assessment.datetime, assessment.sourceId)
        : false,
      intervalMatches: normalizedMatch ? normalizedMatch.observation.interval === assessment.interval : false,
      sourceIdMatches: normalizedMatch ? normalizedMatch.observation.sourceId === assessment.sourceId : false,
      rawKeyMatchedObservation: !!rawMatch,
      normalizedKeyMatchedObservation: !!normalizedMatch,
      normalizedAssessmentKey,
    });
  }

  private getRuleStatus(entry: ObservationEntry): 'Failed' | 'Passed' | 'Not Run' {
    switch (entry.observation.qcStatus) {
      case QCStatusEnum.FAILED:
        return 'Failed';
      case QCStatusEnum.PASSED:
        return 'Passed';
      default:
        return 'Not Run';
    }
  }

  private getAIExplanation(aiAssessment: ViewObservationAnomalyAssessmentModel | null): string {
    if (!aiAssessment) {
      return 'No ML anomaly result or generative explanation available.';
    }

    if (aiAssessment.generativeExplanation?.summary) {
      return aiAssessment.generativeExplanation.summary;
    }

    if (aiAssessment.reasons.length > 0) {
      return aiAssessment.reasons.join('; ');
    }

    return `ML anomaly detection marked this observation as ${StringUtils.formatEnumForDisplay(aiAssessment.outcome)}.`;
  }

  private getAIConfidence(aiAssessment: ViewObservationAnomalyAssessmentModel | null): number | null {
    if (!aiAssessment) {
      return null;
    }

    if (aiAssessment.confidenceScore !== undefined && aiAssessment.confidenceScore !== null) {
      const confidence = aiAssessment.confidenceScore <= 1 ? aiAssessment.confidenceScore * 100 : aiAssessment.confidenceScore;
      return Math.round(confidence);
    }

    const baseScore = aiAssessment.anomalyScore <= 1 ? aiAssessment.anomalyScore * 100 : aiAssessment.anomalyScore;
    const severityBoost = aiAssessment.severity === 'high' ? 8 : aiAssessment.severity === 'medium' ? 4 : 0;
    const confidence = Math.round(Math.min(99, Math.max(45, baseScore + severityBoost)));
    return confidence;
  }

  private async loadReviewState(): Promise<PersistedQCReviewState> {
    const savedState = await AppDatabase.instance.userSettings.get(UserAppStateEnum.QC_ASSESSMENT_REVIEWS);
    return savedState?.parameters ?? { reviews: {} };
  }

  private async fetchAllObservations(query: ViewObservationQueryModel): Promise<ObservationEntry['observation'][]> {
    const pageSize = 500;
    const results: ObservationEntry['observation'][] = [];
    let page = 1;

    while (true) {
      const batch = await firstValueFrom(this.observationService.findProcessed({
        ...query,
        page,
        pageSize,
      }).pipe(take(1)));
      results.push(...batch);
      if (batch.length < pageSize) {
        break;
      }
      page++;
    }

    return results;
  }

  private async fetchAllAnomalyAssessments(query: ViewObservationQueryModel): Promise<ViewObservationAnomalyAssessmentModel[]> {
    const pageSize = 500;
    const results: ViewObservationAnomalyAssessmentModel[] = [];
    let page = 1;
    const anomalyQuery = this.getUnifiedAnomalyQueryWindow(query);

    while (true) {
      const batch = await firstValueFrom(this.observationAnomalyAssessmentsService.find({
        stationIds: query.stationIds,
        elementIds: query.elementIds,
        intervals: query.intervals,
        level: query.level,
        sourceIds: query.sourceIds,
        fromDate: anomalyQuery.fromDate,
        toDate: anomalyQuery.toDate,
        page,
        pageSize,
      }).pipe(take(1)));
      results.push(...batch);
      if (batch.length < pageSize) {
        break;
      }
      page++;
    }

    return results;
  }

  private getUnifiedAnomalyQueryWindow(query: ViewObservationQueryModel): { fromDate?: string; toDate?: string } {
    if (!query.fromDate && !query.toDate) {
      return {};
    }

    const sourceIds = query.sourceIds && query.sourceIds.length > 0
      ? query.sourceIds
      : this.cachedMetadataSearchService.sourcesMetadata.map(source => source.id);
    const offsets = sourceIds.map(sourceId => this.cachedMetadataSearchService.getSource(sourceId).utcOffset);
    const minOffset = offsets.length > 0 ? Math.min(...offsets) : 0;
    const maxOffset = offsets.length > 0 ? Math.max(...offsets) : 0;

    return {
      fromDate: query.fromDate ? DateUtils.getDatetimesBasedOnUTCOffset(query.fromDate, maxOffset, 'subtract') : undefined,
      toDate: query.toDate ? DateUtils.getDatetimesBasedOnUTCOffset(query.toDate, minOffset, 'subtract') : undefined,
    };
  }

  private updateVisibleReviewItems(): void {
    const filteredItems = this.getFilteredReviewItems();
    this.pageInputDefinition.setTotalRowCount(filteredItems.length);

    const startIndex = (this.pageInputDefinition.page - 1) * this.pageInputDefinition.pageSize;
    const endIndex = startIndex + this.pageInputDefinition.pageSize;
    this.reviewItems = filteredItems.slice(startIndex, endIndex);

    const selectedReviewStillVisible = this.reviewItems.some(item => item.key === this.selectedReviewKey);
    if (!selectedReviewStillVisible) {
      const fallbackKey = this.reviewItems[0]?.key ?? filteredItems[0]?.key ?? null;
      this.selectReviewItem(fallbackKey);
    } else {
      this.selectReviewItem(this.selectedReviewKey, false);
    }
  }

  private async persistReviewItem(reviewItem: QCReviewItem): Promise<void> {
    const reviewState = await this.loadReviewState();
      reviewState.reviews[reviewItem.key] = {
      decision: reviewItem.reviewerDecision,
      notes: reviewItem.reviewerNotes,
      reviewedAt: reviewItem.reviewedAt ?? new Date().toISOString(),
      reviewedByEmail: reviewItem.reviewedByEmail ?? this.currentUserEmail ?? undefined,
    };

    const state: AppComponentState = {
      name: UserAppStateEnum.QC_ASSESSMENT_REVIEWS,
      parameters: reviewState,
    };

    await AppDatabase.instance.userSettings.put(state);
  }
}
