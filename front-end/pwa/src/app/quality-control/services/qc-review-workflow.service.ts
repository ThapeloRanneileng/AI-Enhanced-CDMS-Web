import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AppDatabase, QCReviewDecisionRecordModel, QCReviewWorkflowStatus } from 'src/app/app-database';
import { CreateObservationModel } from 'src/app/data-ingestion/models/create-observation.model';
import { FlagEnum } from 'src/app/data-ingestion/models/flag.enum';
import { ObservationsService } from 'src/app/data-ingestion/services/observations.service';

export type QCReviewerDecision = 'pending' | 'approved' | 'overridden' | 'escalated';

export interface QCReviewWorkflowContext {
  reviewKey: string;
  recordId: string;
  stationId: string;
  observationDatetime: string;
  elementCode: string;
  elementId: number;
  level: number;
  interval: number;
  sourceId: number;
  sourceName: string | null;
  originalValue: number | null;
  observationFlag: string | null;
  observationComment: string | null;
  modelVersion: string | null;
  engineVersion: string | null;
  runTimestamp: string | null;
  sourceReviewRecordPresent: boolean;
}

export interface SaveQCReviewDraftRequest {
  context: QCReviewWorkflowContext;
  reviewerNotes: string;
  reviewerUserId: string | null;
  correctedValue: number | null;
}

export interface SubmitQCReviewDecisionRequest extends SaveQCReviewDraftRequest {
  decision: Extract<QCReviewerDecision, 'approved' | 'overridden' | 'escalated'>;
}

@Injectable({
  providedIn: 'root'
})
export class QCReviewWorkflowService {
  constructor(
    private observationsService: ObservationsService,
  ) {}

  public async listDecisionRecords(): Promise<QCReviewDecisionRecordModel[]> {
    return AppDatabase.instance.qcReviewDecisions.toArray();
  }

  public async getDecisionRecord(reviewKey: string): Promise<QCReviewDecisionRecordModel | undefined> {
    return AppDatabase.instance.qcReviewDecisions.get(reviewKey);
  }

  public async saveDraftReview(request: SaveQCReviewDraftRequest): Promise<QCReviewDecisionRecordModel> {
    this.validateAuditContext(request.context);
    const existingRecord = await this.getDecisionRecord(request.context.reviewKey);
    const draftRecord = this.buildDecisionRecord({
      ...request,
      decision: existingRecord?.finalDecision ?? 'pending',
      workflowStatus: existingRecord?.workflowStatus ?? 'reviewed',
      reviewedAt: existingRecord?.reviewedAt ?? new Date().toISOString(),
      promotedToFinalStorage: existingRecord?.promotedToFinalStorage ?? false,
      promotedAt: existingRecord?.promotedAt ?? null,
      promotionError: existingRecord?.promotionError ?? null,
    });

    await AppDatabase.instance.qcReviewDecisions.put(draftRecord);
    return draftRecord;
  }

  public async submitDecision(request: SubmitQCReviewDecisionRequest): Promise<QCReviewDecisionRecordModel> {
    this.validateAuditContext(request.context);
    const workflowStatus = this.getWorkflowStatus(request.decision);
    const reviewedValue = this.getReviewedValue(
      request.decision,
      request.context.originalValue,
      request.correctedValue,
    );
    const submissionFingerprint = this.buildSubmissionFingerprint(
      request.context.reviewKey,
      request.decision,
      reviewedValue,
      request.reviewerNotes,
      request.reviewerUserId,
    );
    const existingRecord = await this.getDecisionRecord(request.context.reviewKey);

    if (
      existingRecord
      && existingRecord.submissionFingerprint === submissionFingerprint
      && existingRecord.workflowStatus === workflowStatus
      && existingRecord.promotedToFinalStorage === (request.decision !== 'escalated')
      && !existingRecord.promotionError
    ) {
      return existingRecord;
    }

    const reviewedAt = new Date().toISOString();
    const baseRecord = this.buildDecisionRecord({
      ...request,
      workflowStatus,
      reviewedAt,
      promotedToFinalStorage: false,
      promotedAt: null,
      promotionError: null,
      submissionFingerprint,
    });

    if (request.decision === 'escalated') {
      await AppDatabase.instance.qcReviewDecisions.put(baseRecord);
      return baseRecord;
    }

    this.validatePromotionContext(request.context);

    try {
      await firstValueFrom(
        this.observationsService.bulkPutDataFromQCAssessment([
          this.buildFinalObservation(request.context, reviewedValue, request.decision, request.reviewerNotes),
        ])
      );

      const promotedRecord: QCReviewDecisionRecordModel = {
        ...baseRecord,
        promotedToFinalStorage: true,
        promotedAt: reviewedAt,
      };
      await AppDatabase.instance.qcReviewDecisions.put(promotedRecord);
      return promotedRecord;
    } catch (error) {
      const failedRecord: QCReviewDecisionRecordModel = {
        ...baseRecord,
        promotionError: error instanceof Error ? error.message : `${error}`,
      };
      await AppDatabase.instance.qcReviewDecisions.put(failedRecord);
      throw error;
    }
  }

  private buildDecisionRecord(input: {
    context: QCReviewWorkflowContext;
    decision: QCReviewerDecision;
    workflowStatus: QCReviewWorkflowStatus;
    reviewerNotes: string;
    reviewerUserId: string | null;
    correctedValue: number | null;
    reviewedAt: string;
    promotedToFinalStorage: boolean;
    promotedAt: string | null;
    promotionError: string | null;
    submissionFingerprint?: string;
  }): QCReviewDecisionRecordModel {
    const reviewedValue = input.decision === 'overridden'
      ? input.correctedValue
      : input.context.originalValue;

    return {
      reviewKey: input.context.reviewKey,
      recordId: input.context.recordId,
      stationId: input.context.stationId,
      observationDatetime: input.context.observationDatetime,
      elementCode: input.context.elementCode,
      elementId: input.context.elementId,
      level: input.context.level,
      interval: input.context.interval,
      sourceId: input.context.sourceId,
      sourceName: input.context.sourceName,
      originalValue: input.context.originalValue,
      correctedValue: input.correctedValue,
      reviewedValue,
      workflowStatus: input.workflowStatus,
      finalDecision: input.decision,
      reviewerNotes: input.reviewerNotes.trim(),
      reviewerUserId: input.reviewerUserId,
      reviewedAt: input.reviewedAt,
      modelVersion: input.context.modelVersion,
      engineVersion: input.context.engineVersion,
      runTimestamp: input.context.runTimestamp,
      submissionFingerprint: input.submissionFingerprint ?? this.buildSubmissionFingerprint(
        input.context.reviewKey,
        input.decision,
        reviewedValue,
        input.reviewerNotes,
        input.reviewerUserId,
      ),
      promotedToFinalStorage: input.promotedToFinalStorage,
      promotedAt: input.promotedAt,
      promotionError: input.promotionError,
      sourceReviewRecordPresent: input.context.sourceReviewRecordPresent,
    };
  }

  private buildFinalObservation(
    context: QCReviewWorkflowContext,
    reviewedValue: number | null,
    decision: Extract<QCReviewerDecision, 'approved' | 'overridden'>,
    reviewerNotes: string,
  ): CreateObservationModel {
    const existingComment = context.observationComment?.trim();
    const traceabilityComment = [
      existingComment,
      `AWS review record ${context.recordId}`,
      `workflow ${this.getWorkflowStatus(decision)}`,
      reviewerNotes.trim() ? `notes ${reviewerNotes.trim()}` : '',
    ].filter(part => part && part.length > 0).join(' | ');

    return {
      stationId: context.stationId,
      elementId: context.elementId,
      sourceId: context.sourceId,
      level: context.level,
      interval: context.interval,
      datetime: context.observationDatetime,
      value: reviewedValue,
      flag: this.normalizeFlag(context.observationFlag),
      comment: traceabilityComment || null,
    };
  }

  private getReviewedValue(
    decision: Extract<QCReviewerDecision, 'approved' | 'overridden' | 'escalated'>,
    originalValue: number | null,
    correctedValue: number | null,
  ): number | null {
    if (decision === 'overridden') {
      if (correctedValue === null || Number.isNaN(correctedValue)) {
        throw new Error('Override requires a corrected value before approval.');
      }
      return correctedValue;
    }

    if (decision === 'approved' && (originalValue === null || Number.isNaN(originalValue))) {
      throw new Error('Approve requires a source observation value.');
    }

    return originalValue;
  }

  private getWorkflowStatus(
    decision: Extract<QCReviewerDecision, 'approved' | 'overridden' | 'escalated'>,
  ): QCReviewWorkflowStatus {
    switch (decision) {
      case 'approved':
        return 'approved_to_final';
      case 'overridden':
        return 'corrected_and_approved';
      case 'escalated':
        return 'rejected_escalated';
    }
  }

  private buildSubmissionFingerprint(
    reviewKey: string,
    decision: QCReviewerDecision,
    reviewedValue: number | null,
    reviewerNotes: string,
    reviewerUserId: string | null,
  ): string {
    return [
      reviewKey,
      decision,
      reviewedValue ?? 'null',
      reviewerNotes.trim(),
      reviewerUserId ?? '',
    ].join('|');
  }

  private normalizeFlag(flag: string | null): FlagEnum | null {
    if (!flag) {
      return null;
    }

    return Object.values(FlagEnum).includes(flag as FlagEnum)
      ? flag as FlagEnum
      : null;
  }

  private validateAuditContext(context: QCReviewWorkflowContext): void {
    if (!context.reviewKey.trim()) {
      throw new Error('Review key is required before saving reviewer state.');
    }
    if (!context.stationId.trim()) {
      throw new Error('Station mapping is required before saving reviewer state.');
    }
    if (!context.elementCode.trim()) {
      throw new Error('Element mapping is required before saving reviewer state.');
    }
  }

  private validatePromotionContext(context: QCReviewWorkflowContext): void {
    if (!Number.isFinite(context.elementId) || context.elementId <= 0) {
      throw new Error('Element id mapping is required before promoting to final storage.');
    }
    if (!Number.isFinite(context.sourceId) || context.sourceId <= 0) {
      throw new Error('Source id mapping is required before promoting to final storage.');
    }
    if (!context.observationDatetime.trim()) {
      throw new Error('Observation datetime is required before promoting to final storage.');
    }
    if (!Number.isFinite(context.interval) || context.interval < 0) {
      throw new Error('Observation interval is required before promoting to final storage.');
    }
  }
}
