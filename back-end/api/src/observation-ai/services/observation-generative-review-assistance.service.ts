import { Injectable } from '@nestjs/common';
import { ObservationEntity, QCTestLogVo } from 'src/observation/entities/observation.entity';
import { QCStatusEnum } from 'src/observation/enums/qc-status.enum';
import { ObservationAnomalyDetectionResult } from './observation-anomaly-detection.service';
import { ObservationGenerativeExplanation, ObservationAnomalyOutcomeEnum } from '../entities/observation-anomaly-assessment.entity';

@Injectable()
export class ObservationGenerativeReviewAssistanceService {
  public generateExplanation(
    observation: ObservationEntity,
    detectionResult: ObservationAnomalyDetectionResult,
  ): ObservationGenerativeExplanation {
    const failedQcChecks = this.extractFailedQcChecks(observation.qcTestLog);
    const abnormalPatterns = detectionResult.contributingSignals.map((signal) => {
      const expectation = signal.expectedValue === null ? 'historical baseline' : `expected ${signal.expectedValue}`;
      return `${signal.signal} indicates ${signal.feature} is ${signal.direction} than ${expectation}`;
    });

    return {
      summary: this.buildSummary(observation, detectionResult, failedQcChecks),
      abnormalPatterns,
      failedQcChecks,
      suggestedReviewerAction: this.buildSuggestedAction(detectionResult.outcome, failedQcChecks.length > 0),
      reviewerGuidance: this.buildReviewerGuidance(detectionResult.outcome, failedQcChecks),
      provider: 'backend_ml_template',
    };
  }

  private buildSummary(
    observation: ObservationEntity,
    detectionResult: ObservationAnomalyDetectionResult,
    failedQcChecks: string[],
  ): string {
    if (detectionResult.outcome === ObservationAnomalyOutcomeEnum.NOT_APPLICABLE) {
      return `ML anomaly detection could not score station ${observation.stationId} element ${observation.elementId} because historical training context was insufficient or the value was missing.`;
    }

    const qcFragment = failedQcChecks.length > 0
      ? ` Rule-based QC also reported ${failedQcChecks.length} failed check${failedQcChecks.length > 1 ? 's' : ''}.`
      : '';

    return `ML anomaly detection marked this observation as ${detectionResult.outcome} with score ${detectionResult.anomalyScore} and confidence ${detectionResult.confidenceScore}.${qcFragment}`;
  }

  private buildSuggestedAction(
    outcome: ObservationAnomalyOutcomeEnum,
    hasFailedQcChecks: boolean,
  ): string {
    if (outcome === ObservationAnomalyOutcomeEnum.FAILED || hasFailedQcChecks) {
      return 'Review the source record, compare with neighbouring observations, and confirm whether the value should be corrected, flagged, or rejected.';
    }

    if (outcome === ObservationAnomalyOutcomeEnum.SUSPECT) {
      return 'Inspect the observation in context before accepting it; focus on the strongest ML signals and any related QC test failures.';
    }

    if (outcome === ObservationAnomalyOutcomeEnum.NOT_APPLICABLE) {
      return 'Use rule-based QC and manual review because the ML layer did not have enough context to issue a reliable anomaly decision.';
    }

    return 'No immediate anomaly action is required, but the reviewer can accept or annotate the observation after a quick context check.';
  }

  private buildReviewerGuidance(
    outcome: ObservationAnomalyOutcomeEnum,
    failedQcChecks: string[],
  ): string {
    if (outcome === ObservationAnomalyOutcomeEnum.FAILED) {
      return `Prioritize this record in the review queue. ${failedQcChecks.length > 0 ? 'Cross-check the failed QC items against station history before making the final reviewer decision.' : 'Validate the observation against recent and seasonal history before making the final reviewer decision.'}`;
    }

    if (outcome === ObservationAnomalyOutcomeEnum.SUSPECT) {
      return 'Use the ML contributing signals as reviewer decision support, then confirm whether the rule-based QC status should stand or be overridden.';
    }

    if (outcome === ObservationAnomalyOutcomeEnum.NOT_APPLICABLE) {
      return 'The generative explanation is advisory only because no reliable ML anomaly score was available.';
    }

    return 'The ML layer considers the value consistent with learned patterns. Reviewer controls remain available if domain context suggests otherwise.';
  }

  private extractFailedQcChecks(qcTestLog: QCTestLogVo[] | null): string[] {
    if (!qcTestLog) {
      return [];
    }

    return qcTestLog
      .filter((entry) => entry.qcStatus === QCStatusEnum.FAILED)
      .map((entry) => `QC Test ${entry.qcTestId}`);
  }
}
