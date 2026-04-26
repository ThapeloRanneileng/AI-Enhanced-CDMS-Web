import { of } from 'rxjs';
import { AppDatabase } from 'src/app/app-database';
import { ObservationsService } from 'src/app/data-ingestion/services/observations.service';
import {
  QCReviewWorkflowContext,
  QCReviewWorkflowService,
} from './qc-review-workflow.service';

describe('QCReviewWorkflowService', () => {
  let service: QCReviewWorkflowService;
  let observationsServiceSpy: jasmine.SpyObj<ObservationsService>;

  const baseContext: QCReviewWorkflowContext = {
    reviewKey: 'MAPOTENG|2|1|2026-04-09T00:00:00.000Z|1|7',
    recordId: 'MAPOTENG_TEMP_20260409T000000',
    stationId: 'MAPOTENG',
    observationDatetime: '2026-04-09T00:00:00.000Z',
    elementCode: 'TEMP',
    elementId: 2,
    level: 1,
    interval: 1,
    sourceId: 7,
    sourceName: 'AWS',
    originalValue: 18.4,
    observationFlag: null,
    observationComment: 'Initial AWS import value.',
    modelVersion: 'iforest-ocsvm-v1',
    engineVersion: 'aws-anomaly-engine-v1',
    runTimestamp: '2026-04-12T12:42:24+00:00',
    sourceReviewRecordPresent: true,
  };

  beforeEach(async () => {
    observationsServiceSpy = jasmine.createSpyObj<ObservationsService>('ObservationsService', [
      'bulkPutDataFromQCAssessment',
    ]);
    service = new QCReviewWorkflowService(observationsServiceSpy);
    await AppDatabase.instance.qcReviewDecisions.clear();
  });

  it('approve upserts the reviewed value into final observation storage', async () => {
    observationsServiceSpy.bulkPutDataFromQCAssessment.and.returnValue(of({ message: 'success' }));

    const record = await service.submitDecision({
      decision: 'approved',
      context: baseContext,
      reviewerNotes: 'Reviewed against nearby stations.',
      reviewerUserId: 'reviewer@example.com',
      correctedValue: null,
    });

    expect(observationsServiceSpy.bulkPutDataFromQCAssessment).toHaveBeenCalledOnceWith([
      jasmine.objectContaining({
        stationId: 'MAPOTENG',
        elementId: 2,
        sourceId: 7,
        datetime: '2026-04-09T00:00:00.000Z',
        value: 18.4,
      }),
    ]);
    expect(record.workflowStatus).toBe('approved_to_final');
    expect(record.promotedToFinalStorage).toBeTrue();
    expect(record.reviewedValue).toBe(18.4);
  });

  it('allows interval 0 when promoting a reviewed observation', async () => {
    observationsServiceSpy.bulkPutDataFromQCAssessment.and.returnValue(of({ message: 'success' }));

    await service.submitDecision({
      decision: 'approved',
      context: {
        ...baseContext,
        reviewKey: 'MAPOTENG|2|1|2026-04-09T00:00:00.000Z|0|7',
        interval: 0,
      },
      reviewerNotes: 'Reviewed zero interval observation.',
      reviewerUserId: 'reviewer@example.com',
      correctedValue: null,
    });

    expect(observationsServiceSpy.bulkPutDataFromQCAssessment).toHaveBeenCalledOnceWith([
      jasmine.objectContaining({
        interval: 0,
      }),
    ]);
  });

  it('rejects missing or invalid intervals during promotion', async () => {
    observationsServiceSpy.bulkPutDataFromQCAssessment.and.returnValue(of({ message: 'success' }));

    await expectAsync(service.submitDecision({
      decision: 'approved',
      context: {
        ...baseContext,
        interval: Number.NaN,
      },
      reviewerNotes: 'Invalid interval.',
      reviewerUserId: 'reviewer@example.com',
      correctedValue: null,
    })).toBeRejectedWithError('Observation interval is required before promoting to final storage.');

    expect(observationsServiceSpy.bulkPutDataFromQCAssessment).not.toHaveBeenCalled();
  });

  it('override saves the corrected value and promotes the corrected observation', async () => {
    observationsServiceSpy.bulkPutDataFromQCAssessment.and.returnValue(of({ message: 'success' }));

    const record = await service.submitDecision({
      decision: 'overridden',
      context: baseContext,
      reviewerNotes: 'Field sheet confirms a lower value.',
      reviewerUserId: 'reviewer@example.com',
      correctedValue: 17.1,
    });

    expect(observationsServiceSpy.bulkPutDataFromQCAssessment).toHaveBeenCalledOnceWith([
      jasmine.objectContaining({
        value: 17.1,
      }),
    ]);
    expect(record.workflowStatus).toBe('corrected_and_approved');
    expect(record.correctedValue).toBe(17.1);
    expect(record.reviewedValue).toBe(17.1);
    expect(record.originalValue).toBe(18.4);
  });

  it('escalate persists the review decision without promoting to final storage', async () => {
    const record = await service.submitDecision({
      decision: 'escalated',
      context: baseContext,
      reviewerNotes: 'Needs supervisor verification.',
      reviewerUserId: 'reviewer@example.com',
      correctedValue: null,
    });

    expect(observationsServiceSpy.bulkPutDataFromQCAssessment).not.toHaveBeenCalled();
    expect(record.workflowStatus).toBe('rejected_escalated');
    expect(record.promotedToFinalStorage).toBeFalse();
    expect(record.reviewedValue).toBe(18.4);
  });

  it('persists audit metadata for approved and overridden reviews', async () => {
    observationsServiceSpy.bulkPutDataFromQCAssessment.and.returnValue(of({ message: 'success' }));

    await service.submitDecision({
      decision: 'overridden',
      context: baseContext,
      reviewerNotes: 'Override accepted after metadata check.',
      reviewerUserId: 'reviewer@example.com',
      correctedValue: 18.1,
    });

    const savedRecord = await AppDatabase.instance.qcReviewDecisions.get(baseContext.reviewKey);

    expect(savedRecord).toEqual(jasmine.objectContaining({
      reviewKey: baseContext.reviewKey,
      recordId: 'MAPOTENG_TEMP_20260409T000000',
      stationId: 'MAPOTENG',
      observationDatetime: '2026-04-09T00:00:00.000Z',
      elementCode: 'TEMP',
      originalValue: 18.4,
      correctedValue: 18.1,
      finalDecision: 'overridden',
      reviewerNotes: 'Override accepted after metadata check.',
      reviewerUserId: 'reviewer@example.com',
      modelVersion: 'iforest-ocsvm-v1',
      engineVersion: 'aws-anomaly-engine-v1',
      runTimestamp: '2026-04-12T12:42:24+00:00',
      sourceId: 7,
      sourceName: 'AWS',
      promotedToFinalStorage: true,
      sourceReviewRecordPresent: true,
    }));
    expect(savedRecord?.reviewedAt).toMatch(/^202/);
  });

  it('treats repeat approval submissions as idempotent when the payload is unchanged', async () => {
    observationsServiceSpy.bulkPutDataFromQCAssessment.and.returnValue(of({ message: 'success' }));

    await service.submitDecision({
      decision: 'approved',
      context: baseContext,
      reviewerNotes: 'Approved after review.',
      reviewerUserId: 'reviewer@example.com',
      correctedValue: null,
    });
    await service.submitDecision({
      decision: 'approved',
      context: baseContext,
      reviewerNotes: 'Approved after review.',
      reviewerUserId: 'reviewer@example.com',
      correctedValue: null,
    });

    expect(observationsServiceSpy.bulkPutDataFromQCAssessment).toHaveBeenCalledTimes(1);
  });
});
