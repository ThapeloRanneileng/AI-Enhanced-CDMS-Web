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
import { QCReviewWorkflowService } from '../services/qc-review-workflow.service';
import { LmsAiQuery, LmsAiService } from '../services/lms-ai.service';

type ReviewerDecision = 'pending' | 'approved' | 'overridden' | 'escalated';

interface PersistedQCReviewDecision {
  decision: ReviewerDecision;
  notes: string;
  correctedValue: number | null;
  reviewedAt: string;
  reviewedByEmail?: string;
  workflowStatus: 'pending_review' | 'reviewed' | 'approved_to_final' | 'corrected_and_approved' | 'rejected_escalated';
  promotionError: string | null;
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
  reviewSource: string;
  reviewReason: string;
  recommendedReviewerAction: string;
  reviewerDecision: ReviewerDecision;
  reviewerNotes: string;
  correctedValue: number | null;
  reviewedAt: string | null;
  reviewedByEmail: string | null;
  workflowStatus: 'pending_review' | 'reviewed' | 'approved_to_final' | 'corrected_and_approved' | 'rejected_escalated';
  promotionError: string | null;
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
  protected correctedValueDraft: number | null = null;
  protected queueSearch: string = '';
  protected reviewDecisionFilter: 'all' | ReviewerDecision = 'all';
  protected loadingAiContext: boolean = false;
  protected currentUserEmail: string = '';
  protected loadedObservationCount: number = 0;
  protected loadedRuleFailedObservationCount: number = 0;
  protected loadedAnomalyAssessmentCount: number = 0;
  protected emptyWorkspaceMessage: string = 'Try widening the date range or removing some filters.';
  private allReviewItems: QCReviewItem[] = [];
  private readonly submittingReviewKeys = new Set<string>();

  private destroy$ = new Subject<void>();

  constructor(
    private pagesDataService: PagesDataService,
    private appAuthService: AppAuthService,
    private cachedMetadataSearchService: CachedMetadataService,
    private observationService: ObservationsService,
    private qcAssessmentsService: QCAssessmentsService,
    private observationAnomalyAssessmentsService: ObservationAnomalyAssessmentsService,
    private qcReviewWorkflowService: QCReviewWorkflowService,
    private lmsAiService: LmsAiService,
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
    this.loadedObservationCount = 0;
    this.loadedRuleFailedObservationCount = 0;
    this.loadedAnomalyAssessmentCount = 0;
    this.emptyWorkspaceMessage = 'Try widening the date range or removing some filters.';
    this.selectedReviewKey = null;
    this.reviewerNotesDraft = '';
    this.correctedValueDraft = null;
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
    this.correctedValueDraft = null;
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
    this.correctedValueDraft = reviewItem?.correctedValue ?? null;
  }

  protected async onSelectDecision(decision: ReviewerDecision): Promise<void> {
    const selectedReviewItem = this.selectedReviewItem;
    if (!selectedReviewItem || decision === 'pending') {
      return;
    }

    this.submittingReviewKeys.add(selectedReviewItem.key);

    try {
      const record = await this.qcReviewWorkflowService.submitDecision({
        decision,
        context: this.buildWorkflowContext(selectedReviewItem),
        reviewerNotes: this.reviewerNotesDraft.trim(),
        reviewerUserId: this.currentUserEmail || null,
        correctedValue: this.correctedValueDraft,
      });

      selectedReviewItem.reviewerDecision = record.finalDecision;
      selectedReviewItem.reviewerNotes = record.reviewerNotes;
      selectedReviewItem.correctedValue = record.correctedValue;
      selectedReviewItem.reviewedAt = record.reviewedAt;
      selectedReviewItem.reviewedByEmail = record.reviewerUserId;
      selectedReviewItem.workflowStatus = record.workflowStatus;
      selectedReviewItem.promotionError = record.promotionError;
      if (record.reviewedValue !== null) {
        selectedReviewItem.observationValue = record.reviewedValue;
      }

      this.updateVisibleReviewItems();
      this.pagesDataService.showToast({
        title: 'QC Review Workspace',
        message: `Reviewer decision saved as ${this.formatDecision(decision)}.`,
        type: ToastEventTypeEnum.SUCCESS
      });
    } catch (err) {
      this.pagesDataService.showToast({
        title: 'QC Review Workspace',
        message: `${err}`,
        type: ToastEventTypeEnum.ERROR
      });
    } finally {
      this.submittingReviewKeys.delete(selectedReviewItem.key);
    }
  }

  protected async onSaveReviewerNotes(): Promise<void> {
    const selectedReviewItem = this.selectedReviewItem;
    if (!selectedReviewItem) {
      return;
    }

    try {
      const record = await this.qcReviewWorkflowService.saveDraftReview({
        context: this.buildWorkflowContext(selectedReviewItem),
        reviewerNotes: this.reviewerNotesDraft.trim(),
        reviewerUserId: this.currentUserEmail || null,
        correctedValue: this.correctedValueDraft,
      });

      selectedReviewItem.reviewerNotes = record.reviewerNotes;
      selectedReviewItem.correctedValue = record.correctedValue;
      selectedReviewItem.reviewedAt = record.reviewedAt;
      selectedReviewItem.reviewedByEmail = record.reviewerUserId;
      selectedReviewItem.workflowStatus = record.workflowStatus;
      selectedReviewItem.promotionError = record.promotionError;

      this.updateVisibleReviewItems();
      this.pagesDataService.showToast({
        title: 'QC Review Workspace',
        message: 'Reviewer notes saved.',
        type: ToastEventTypeEnum.SUCCESS
      });
    } catch (err) {
      this.pagesDataService.showToast({
        title: 'QC Review Workspace',
        message: `${err}`,
        type: ToastEventTypeEnum.ERROR
      });
    }
  }

  protected get selectedDecisionSubmitting(): boolean {
    return this.selectedReviewKey ? this.submittingReviewKeys.has(this.selectedReviewKey) : false;
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

      const [allObservations, allAnomalyAssessments, lmsReviewRows, reviewState] = await Promise.all([
        this.fetchAllObservations(baseQuery),
        this.fetchAllAnomalyAssessments(baseQuery),
        this.fetchLmsReviewRows(baseQuery),
        this.loadReviewState(),
      ]);

      console.info('[QC Review Workspace] Unified review source counts', {
        processedObservationsCount: allObservations.length,
        anomalyAssessmentsCount: allAnomalyAssessments.length,
        lmsReviewRowsCount: lmsReviewRows.length,
        persistedReviewCount: Object.keys(reviewState.reviews).length,
      });

      this.loadedObservationCount = allObservations.length;
      this.loadedAnomalyAssessmentCount = allAnomalyAssessments.length;

      const observationEntries = allObservations.map(observation => this.createObservationEntry(observation));
      const observationEntryMap = new Map<string, ObservationEntry>();
      const ruleReviewObservationKeys: string[] = [];
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

        if (entry.observation.qcStatus === QCStatusEnum.FAILED || (entry.qcTestsFailed?.length ?? 0) > 0) {
          ruleReviewObservationKeys.push(observationKey);
        }
      }
      this.loadedRuleFailedObservationCount = ruleReviewObservationKeys.length;

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
        ...ruleReviewObservationKeys,
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
        const awsReviewRowLoaded = !!aiAssessment;
        const reviewed = !!persistedReview;

        if (!(awsReviewRowLoaded || ruleFailed || aiFlagged || reviewed)) {
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
          reviewSource: aiAssessment ? 'shared_observation_ai' : (ruleFailed ? 'rule_qc' : 'review_state'),
          reviewReason: aiAssessment?.reasons?.join('; ') ?? failedChecks.join('; ') ?? '',
          recommendedReviewerAction: this.getSuggestedReviewerActionFromAssessment(aiAssessment),
          reviewerDecision: persistedReview?.decision ?? 'pending',
          reviewerNotes: persistedReview?.notes ?? '',
          correctedValue: persistedReview?.correctedValue ?? null,
          reviewedAt: persistedReview?.reviewedAt ?? null,
          reviewedByEmail: persistedReview?.reviewedByEmail ?? null,
          workflowStatus: persistedReview?.workflowStatus ?? 'pending_review',
          promotionError: persistedReview?.promotionError ?? null,
        });
      }

      for (const row of lmsReviewRows) {
        const key = this.getLmsReviewKey(row);
        const persistedReview = reviewState.reviews[key];
        this.allReviewItems.push(this.buildLmsReviewItem(row, key, persistedReview));
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
        this.emptyWorkspaceMessage = this.buildEmptyWorkspaceMessage();
        this.pagesDataService.showToast({ title: 'QC Review Workspace', message: this.emptyWorkspaceMessage, type: ToastEventTypeEnum.INFO });
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
        .map(qcLogItem => {
          try {
            return this.cachedMetadataSearchService.getQCTest(qcLogItem.qcTestId);
          } catch {
            return {
              id: qcLogItem.qcTestId,
              name: `QC Test #${qcLogItem.qcTestId}`,
              description: 'QC test metadata is not yet available in the local cache.',
              elementId: observation.elementId,
              observationLevel: observation.level,
              observationInterval: observation.interval,
              observationIntervalName: IntervalsUtil.getIntervalName(observation.interval),
              qcTestType: 'range_threshold' as any,
              qcTestTypeName: 'Range Threshold',
              parameters: {} as any,
              formattedParameters: 'Metadata not loaded',
              disabled: false,
              comment: '',
            };
          }
        }) : [];

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

  private buildEmptyWorkspaceMessage(): string {
    if (this.loadedObservationCount === 0 && this.loadedAnomalyAssessmentCount === 0) {
      return 'No observations or review-ready anomaly records matched the selected filters.';
    }

    if (this.loadedObservationCount > 0 && this.loadedRuleFailedObservationCount === 0 && this.loadedAnomalyAssessmentCount === 0) {
      return 'Observations matched the selected filters, but none are review-ready. Passed or not-run observations do not appear here unless they have failed rule-based QC, ML suspect/failed output, or a saved reviewer decision.';
    }

    return 'No failed rule-based QC, ML suspect/failed output, or saved reviewer decision matched the selected filters.';
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

  private getSuggestedReviewerActionFromAssessment(aiAssessment: ViewObservationAnomalyAssessmentModel | null): string {
    return aiAssessment?.generativeExplanation?.suggestedReviewerAction
      ?? aiAssessment?.externalReviewMetadata?.recommendedAction
      ?? 'Review the record and capture the final reviewer decision.';
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
    const persistedReviews = await this.qcReviewWorkflowService.listDecisionRecords();
    const reviews = persistedReviews.reduce<Record<string, PersistedQCReviewDecision>>((accumulator, record) => {
      accumulator[record.reviewKey] = {
        decision: record.finalDecision,
        notes: record.reviewerNotes,
        correctedValue: record.correctedValue,
        reviewedAt: record.reviewedAt,
        reviewedByEmail: record.reviewerUserId ?? undefined,
        workflowStatus: record.workflowStatus,
        promotionError: record.promotionError,
      };
      return accumulator;
    }, {});

    return { reviews };
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
    const anomalyQuery = this.getUnifiedAnomalyQueryWindow(query);
    return this.fetchPagedAnomalyAssessments(query, anomalyQuery);
  }

  private async fetchLmsReviewRows(query: ViewObservationQueryModel): Promise<Record<string, string>[]> {
    const pageSize = 5000;
    const maxPages = 100;
    const rows: Record<string, string>[] = [];
    const lmsQuery = this.getLmsReviewQuery(query);
    let offset = 0;

    for (let page = 0; page < maxPages; page++) {
      const result = await firstValueFrom(this.lmsAiService.qcReview({ ...lmsQuery, limit: pageSize, offset }).pipe(take(1)));
      rows.push(...result.rows);

      if (result.rows.length === 0 || offset + result.rows.length >= result.total) {
        return rows;
      }

      offset += result.rows.length;
    }

    console.warn('[QC Review Workspace] LMS review row pagination stopped at safety limit', {
      loadedRows: rows.length,
      pageSize,
      maxPages,
    });
    return rows;
  }

  private getLmsReviewQuery(query: ViewObservationQueryModel): LmsAiQuery {
    const elementCodes = (query.elementIds ?? [])
      .map(elementId => this.cachedMetadataSearchService.getElement(elementId)?.abbreviation)
      .filter((elementCode): elementCode is string => !!elementCode);

    const lmsQuery: LmsAiQuery = {
      stationIds: query.stationIds && query.stationIds.length > 0 ? query.stationIds : undefined,
      elementCodes: elementCodes.length > 0 ? elementCodes : undefined,
      dateFrom: query.fromDate,
      dateTo: query.toDate,
    };

    if (elementCodes.length === 1) {
      lmsQuery.elementCode = elementCodes[0];
    }

    return lmsQuery;
  }

  private getLmsReviewKey(row: Record<string, string>): string {
    return ['lms', row['stationId'], row['elementCode'], row['observationDatetime'], row['value']].join('|');
  }

  private buildLmsReviewItem(
    row: Record<string, string>,
    key: string,
    persistedReview?: PersistedQCReviewDecision,
  ): QCReviewItem {
    const confidence = Number(row['confidence'] || 0);
    const normalizedConfidence = confidence <= 1 ? Math.round(confidence * 100) : Math.round(confidence);
    const outcome = `${row['outcome'] || row['finalDecision'] || 'suspect'}`.toLowerCase() as any;
    const severity = `${row['severity'] || 'medium'}`.toLowerCase() as any;
    const aiAssessment: ViewObservationAnomalyAssessmentModel = {
      id: 0,
      stationId: row['stationId'],
      elementId: 0,
      level: 0,
      datetime: row['observationDatetime'],
      interval: 1440,
      sourceId: 0,
      assessmentType: 'backfill',
      modelId: row['agreeingModels'] || 'LMS Ensemble',
      modelFamily: 'lms_ai_pipeline',
      modelVersion: row['pipelineRunId'] || 'lms-historical',
      anomalyScore: Number(row['anomalyScore'] || 0),
      confidenceScore: confidence,
      severity,
      outcome,
      reasons: [row['reviewReason'] || row['explanation'] || 'LMS AI review handoff row'],
      featureSnapshot: { modelAgreementCount: row['modelAgreementCount'], reviewSource: row['reviewSource'] },
      contributingSignals: [],
      generativeExplanation: {
        summary: row['explanation'] || row['reviewReason'] || '',
        abnormalPatterns: [row['reviewReason'] || row['explanation'] || 'LMS AI anomaly evidence'],
        failedQcChecks: row['ruleQcTriggered'] === 'true' ? [row['reviewReason'] || 'Rule QC triggered'] : [],
        suggestedReviewerAction: row['recommendedReviewerAction'] || 'Review LMS source record and nearby daily sequence.',
        reviewerGuidance: row['reviewReason'] || 'Use LMS source records and nearby values to confirm the observation.',
      },
      reviewQueue: {
        ruleBasedQc: row['ruleQcTriggered'] === 'true' ? 'Failed' : 'Not Run',
        failedChecks: row['ruleQcTriggered'] === 'true' ? [row['reviewReason']] : [],
        aiScore: Number(row['anomalyScore'] || 0),
        aiConfidence: normalizedConfidence,
        aiExplanation: row['explanation'],
        finalDecision: row['finalDecision'] || row['outcome'],
      },
      rawObservationData: {
        value: Number(row['value'] || 0),
        flag: null,
        qcStatus: row['ruleQcTriggered'] === 'true' ? QCStatusEnum.FAILED : QCStatusEnum.NONE,
        comment: row['reviewReason'],
        deleted: false,
      },
      ruleBasedQcResults: {
        status: row['ruleQcTriggered'] === 'true' ? 'Failed' : 'Not Run',
        failedChecks: row['ruleQcTriggered'] === 'true' ? [row['reviewReason']] : [],
        qcTestLog: [],
      },
      mlAnomalyOutputs: {
        modelId: row['agreeingModels'] || 'LMS Ensemble',
        modelFamily: 'lms_ai_pipeline',
        modelVersion: row['pipelineRunId'] || 'lms-historical',
        anomalyStatus: outcome,
        anomalyScore: Number(row['anomalyScore'] || 0),
        confidenceScore: confidence,
        severity,
        contributingSignals: [],
        featureSnapshot: { modelAgreementCount: row['modelAgreementCount'], reviewSource: row['reviewSource'] },
      },
      externalReviewMetadata: {
        recordId: key,
        stationId: row['stationId'],
        observationDatetime: row['observationDatetime'],
        elementCode: row['elementCode'],
        value: row['value'],
        qcStatus: row['ruleQcTriggered'] === 'true' ? 'failed' : 'not_run',
        mlStatus: outcome,
        finalDecision: row['finalDecision'] || row['outcome'],
        severity,
        anomalyType: row['reviewSource'] || 'lms_ai',
        explanationSummary: row['explanation'],
        recommendedAction: row['recommendedReviewerAction'],
        modelVersion: row['pipelineRunId'] || 'lms-historical',
        engineVersion: 'lms-ai-pipeline',
        runTimestamp: row['processedAt'],
      },
      createdByUserId: null,
      createdAt: row['processedAt'] || row['observationDatetime'],
    };

    return {
      key,
      observationEntry: null,
      stationId: row['stationId'],
      elementId: 0,
      level: 0,
      interval: 1440,
      sourceId: 0,
      observationDatetime: row['observationDatetime'],
      stationName: row['stationName'] || row['stationId'],
      elementName: row['elementName'] || row['elementCode'],
      sourceName: 'LMS Historical Daily CSV',
      formattedDatetime: row['observationDatetime'],
      intervalName: 'Daily',
      observationValue: Number(row['value'] || 0),
      observationFlag: null,
      observationComment: row['reviewReason'],
      ruleStatus: row['ruleQcTriggered'] === 'true' ? 'Failed' : 'Not Run',
      failedChecks: row['ruleQcTriggered'] === 'true' ? [row['reviewReason']] : [],
      aiAssessment,
      aiConfidence: normalizedConfidence,
      aiExplanation: row['explanation'] || row['reviewReason'],
      reviewSource: row['reviewSource'] || 'lms_ai',
      reviewReason: row['reviewReason'] || row['explanation'],
      recommendedReviewerAction: row['recommendedReviewerAction'] || 'Review LMS source record and nearby daily sequence.',
      reviewerDecision: persistedReview?.decision ?? 'pending',
      reviewerNotes: persistedReview?.notes ?? '',
      correctedValue: persistedReview?.correctedValue ?? null,
      reviewedAt: persistedReview?.reviewedAt ?? null,
      reviewedByEmail: persistedReview?.reviewedByEmail ?? null,
      workflowStatus: persistedReview?.workflowStatus ?? 'pending_review',
      promotionError: persistedReview?.promotionError ?? null,
    };
  }

  private async fetchPagedAnomalyAssessments(
    query: ViewObservationQueryModel,
    anomalyQuery: { fromDate?: string; toDate?: string },
  ): Promise<ViewObservationAnomalyAssessmentModel[]> {
    const pageSize = 500;
    const results: ViewObservationAnomalyAssessmentModel[] = [];
    let page = 1;

    while (true) {
      const request = {
        stationIds: query.stationIds,
        elementIds: query.elementIds,
        intervals: query.intervals,
        level: query.level,
        sourceIds: query.sourceIds,
        fromDate: anomalyQuery.fromDate,
        toDate: anomalyQuery.toDate,
        page,
        pageSize,
      };
      const batch = await firstValueFrom(
        this.observationAnomalyAssessmentsService.find(request).pipe(take(1))
      );
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

  private buildWorkflowContext(reviewItem: QCReviewItem) {
    let resolvedElementCode = reviewItem.aiAssessment?.externalReviewMetadata?.elementCode ?? '';
    if (!resolvedElementCode) {
      try {
        resolvedElementCode = this.cachedMetadataSearchService.getElement(reviewItem.elementId).abbreviation;
      } catch {
        resolvedElementCode = `${reviewItem.elementId}`;
      }
    }

    return {
      reviewKey: reviewItem.key,
      recordId: reviewItem.aiAssessment?.externalReviewMetadata?.recordId ?? reviewItem.key,
      stationId: reviewItem.stationId,
      observationDatetime: reviewItem.observationDatetime,
      elementCode: resolvedElementCode,
      elementId: reviewItem.elementId,
      level: reviewItem.level,
      interval: reviewItem.interval,
      sourceId: reviewItem.sourceId,
      sourceName: reviewItem.sourceName,
      originalValue: reviewItem.observationValue,
      observationFlag: reviewItem.observationFlag,
      observationComment: reviewItem.observationComment,
      modelVersion: reviewItem.aiAssessment?.externalReviewMetadata?.modelVersion ?? reviewItem.aiAssessment?.modelVersion ?? null,
      engineVersion: reviewItem.aiAssessment?.externalReviewMetadata?.engineVersion ?? null,
      runTimestamp: reviewItem.aiAssessment?.externalReviewMetadata?.runTimestamp ?? null,
      sourceReviewRecordPresent: !!reviewItem.aiAssessment?.externalReviewMetadata,
    };
  }
}
