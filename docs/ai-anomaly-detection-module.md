# AI Anomaly Detection Module Design

## Objective

Add an AI-assisted anomaly detection capability for climate observations that complements, rather than replaces, the existing rule-based QC pipeline.

The module should:

- run on newly ingested observations and on-demand QC selections
- produce explainable anomaly scores and reasons
- write results back into the existing observation QC model
- remain compatible with the current event-driven observation workflow

## Current Pipeline In This Codebase

The current backend flow is split across two main paths:

1. Observation ingestion
   - Manual/API entry hits [back-end/api/src/observation/controllers/observations.controller.ts](/home/thapelo6041/climsoft-web/back-end/api/src/observation/controllers/observations.controller.ts) via `PUT /observations/data-entry` or `PUT /observations/data-entry-qc`
   - Import uploads hit the same controller via `POST /observations/upload/:sourceid` and `POST /observations/upload/:sourceid/:stationid`
   - File imports are transformed in [back-end/api/src/observation/services/observations-import.service.ts](/home/thapelo6041/climsoft-web/back-end/api/src/observation/services/observations-import.service.ts)
   - Manual/API saves are persisted in [back-end/api/src/observation/services/observations.service.ts](/home/thapelo6041/climsoft-web/back-end/api/src/observation/services/observations.service.ts)
   - Both paths emit `observations.saved`

2. Rule-based quality control
   - On-demand QC is triggered by `POST /quality-control/perform-qc` in [back-end/api/src/observation/controllers/quality-control.controller.ts](/home/thapelo6041/climsoft-web/back-end/api/src/observation/controllers/quality-control.controller.ts)
   - Execution is handled by [back-end/api/src/observation/services/qc-test-assessments.service.ts](/home/thapelo6041/climsoft-web/back-end/api/src/observation/services/qc-test-assessments.service.ts)
   - Rule execution is implemented in PostgreSQL functions in [back-end/api/src/sql-scripts/qc-tests/qc-tests-functions.sql](/home/thapelo6041/climsoft-web/back-end/api/src/sql-scripts/qc-tests/qc-tests-functions.sql)
   - Results are stored on `observations.qc_status` and `observations.qc_test_log` in [back-end/api/src/observation/entities/observation.entity.ts](/home/thapelo6041/climsoft-web/back-end/api/src/observation/entities/observation.entity.ts)
   - QC completion emits `observations.quality-controlled`

## Proposed Module

Add a new NestJS feature module:

- `back-end/api/src/observation-ai/observation-ai.module.ts`

Core services:

- `AnomalyFeatureBuilderService`
  - builds model-ready features from raw observations, station metadata, element metadata, seasonality context, neighbour context, and recent history
- `AnomalyModelRegistryService`
  - resolves which model/version applies for a station, network, element, interval, and level
- `ObservationAnomalyDetectionService`
  - performs inference and returns anomaly score, severity, and explainability payload
- `ObservationAnomalyAssessmentService`
  - merges AI results with existing QC semantics and persists them
- `ObservationAnomalyJobService`
  - processes event-driven or batch requests asynchronously

Suggested DTO/result shape:

```ts
interface ObservationAnomalyResult {
  stationId: string;
  elementId: number;
  level: number;
  interval: number;
  sourceId: number;
  datetime: string;
  modelId: string;
  modelVersion: string;
  anomalyScore: number; // 0..1
  severity: 'low' | 'medium' | 'high';
  outcome: 'passed' | 'suspect' | 'failed' | 'not_applicable';
  reasons: string[];
  featureSnapshot: Record<string, number | string | null>;
}
```

## Detection Approach

Use a hybrid design:

1. Existing deterministic QC remains the first gate.
2. AI anomaly detection adds probabilistic detection for patterns that static thresholds miss.

Recommended model family by maturity:

1. Phase 1
   - robust seasonal z-score and rolling climatology baselines
   - isolation forest or local outlier factor on derived features
2. Phase 2
   - sequence model per element/interval using lag windows and seasonality embeddings
3. Phase 3
   - graph/spatial models using nearby stations and elevation-aware neighbour comparisons

Feature groups:

- raw value
- lag deltas and rolling variance
- same-hour and same-day climatology deviation
- month/season deviation
- station neighbour deviation
- source disagreement indicator
- metadata context: station elevation, environment, network, observing method
- missingness and flatness history

## Storage Model

Do not overload `qc_test_log` with AI-specific detail. Add a parallel persistence model.

### New table

`observation_anomaly_assessments`

Suggested columns:

- `id`
- `station_id`
- `element_id`
- `level`
- `date_time`
- `interval`
- `source_id`
- `assessment_type` (`ingestion`, `on_demand_qc`, `recheck`, `backfill`)
- `model_id`
- `model_version`
- `anomaly_score`
- `severity`
- `outcome`
- `reasons` `jsonb`
- `feature_snapshot` `jsonb`
- `created_by_user_id` nullable
- `created_at`

### Minimal change to `observations`

Keep existing `qc_status`, but add optional AI summary fields:

- `ai_qc_status`
- `ai_anomaly_score`
- `ai_assessment_time`

If schema change must stay smaller, keep all AI output in the new table and compute summaries in queries/views.

## Integration Points

### 1. Ingestion path

#### Manual/API entry

After successful save in [back-end/api/src/observation/services/observations.service.ts](/home/thapelo6041/climsoft-web/back-end/api/src/observation/services/observations.service.ts), keep `this.eventEmitter.emit('observations.saved')` as the trigger point.

Integration:

- add an event listener in the AI module:
  - `@OnEvent('observations.saved')`
- enqueue anomaly assessment for only the newly saved observation keys

Reason:

- avoids slowing `PUT /observations/data-entry`
- matches the existing event-driven sync pattern already used by [back-end/api/src/observation/services/climsoft-web-to-v4-sync.service.ts](/home/thapelo6041/climsoft-web/back-end/api/src/observation/services/climsoft-web-to-v4-sync.service.ts)

#### File import

After `ObservationImportService.importProcessedFileToDatabase()` completes in [back-end/api/src/observation/services/observations-import.service.ts](/home/thapelo6041/climsoft-web/back-end/api/src/observation/services/observations-import.service.ts), the same `observations.saved` event should enqueue AI checks.

For large imports:

- chunk by station/element/date range
- process asynchronously in the existing queue subsystem under `back-end/api/src/queue`
- persist progress so the UI can display assessment status separately from import completion

### 2. Quality-control path

#### On-demand QC

Extend [back-end/api/src/observation/services/qc-test-assessments.service.ts](/home/thapelo6041/climsoft-web/back-end/api/src/observation/services/qc-test-assessments.service.ts) so `performQC()` orchestrates two stages:

1. execute existing SQL rule tests
2. optionally execute AI anomaly assessment on the same filtered selection

Recommended API change:

- keep `POST /quality-control/perform-qc`
- add request options such as:

```ts
{
  runRuleQc: true,
  runAiQc: true,
  persistAiResults: true
}
```

If backward compatibility is more important, add:

- `POST /quality-control/perform-ai-qc`

#### QC result merge policy

Use a deterministic merge policy:

- rule-based `failed` remains `failed`
- AI `high` severity anomaly upgrades `ai_qc_status` to `failed`
- AI `medium` severity anomaly marks `ai_qc_status` as `suspect`
- final operator-facing status can be:
  - `failed` if either rules fail or AI high-severity fails
  - `passed` if rules pass and AI score is below threshold
  - `suspect` if rules pass but AI says review

This keeps AI advisory at first, then allows stricter enforcement later.

### 3. Observation review UI

The current frontend QC and observation views already expose QC status and logs. Surface AI output alongside them instead of mixing it into the existing rule log.

Best integration points:

- [front-end/pwa/src/app/quality-control/qc-data-checks/qc-assessment.component.ts](/home/thapelo6041/climsoft-web/front-end/pwa/src/app/quality-control/qc-data-checks/qc-assessment.component.ts)
- [front-end/pwa/src/app/quality-control/services/qc-assessments.service.ts](/home/thapelo6041/climsoft-web/front-end/pwa/src/app/quality-control/services/qc-assessments.service.ts)
- [front-end/pwa/src/app/observations/value-flag-input/value-flag-input.component.html](/home/thapelo6041/climsoft-web/front-end/pwa/src/app/observations/value-flag-input/value-flag-input.component.html)

Show:

- anomaly score
- severity
- top reasons
- model version
- neighbour/context indicators
- operator action: accept, override, mark sensor issue, request retraining candidate

## Recommended Execution Flow

### Near-real-time ingestion flow

```text
ObservationsController
  -> ObservationsService.bulkPut / ObservationImportService.importProcessedFileToDatabase
  -> emit observations.saved
  -> ObservationAnomalyJobService queues keys
  -> ObservationAnomalyDetectionService builds features + runs model
  -> ObservationAnomalyAssessmentService stores results
  -> emit observations.ai-quality-controlled
```

### On-demand QC flow

```text
QualityControlController.performQC
  -> QCTestAssessmentsService.performQC
  -> existing PostgreSQL rule QC
  -> ObservationAnomalyAssessmentService.runForQuery(query, userId)
  -> merge rule + AI outcomes
  -> return counts for rule fails, AI suspects, AI fails
```

## Model Governance

Add explicit model governance from the start.

Required model metadata:

- training data range
- supported stations/elements/intervals
- feature schema version
- metrics by element and station class
- approval status
- rollback target version

Operational controls:

- configurable thresholds in general settings or dedicated model settings
- shadow mode for initial rollout
- station/element allow-list before full rollout
- full audit log for every persisted AI assessment

## Failure Handling

The module must fail open for ingestion.

Rules:

- observation save/import must succeed even if AI inference fails
- AI errors should be logged and retried asynchronously
- no observation should be marked `failed` solely because the model service was unavailable

Recommended statuses:

- `pending`
- `completed`
- `failed_inference`
- `skipped_no_model`

## Why This Placement Fits The Existing Code

- `observations.saved` already exists as the cleanest post-persist hook
- `performQC()` already centralizes batch QC execution and is the right orchestration point for combined QC runs
- current rule QC lives in SQL functions, so AI inference is better placed in NestJS services rather than in PostgreSQL
- the queue module already provides a pattern for background processing of heavier work
- the `observations` entity already separates current QC summary from detailed logs, which makes a parallel AI assessment table a natural extension

## Incremental Delivery Plan

### Phase 1

- add persistence table for anomaly assessments
- add AI module in shadow mode
- trigger from `observations.saved`
- expose score and reasons in read APIs only

### Phase 2

- add `runAiQc` option to QC execution
- expose AI review in frontend QC screens
- support operator feedback capture

### Phase 3

- add retraining pipeline from operator-labelled anomalies
- add spatial and sequence models
- optionally fold AI outcome into final operational QC status

## Minimal First Implementation

If the goal is to ship quickly with low risk, implement:

1. event listener on `observations.saved`
2. background feature builder using recent same-station history
3. simple seasonal baseline model with anomaly score
4. `observation_anomaly_assessments` table
5. read-only UI panel showing AI score and reasons

That delivers value without disturbing the current SQL QC logic.
