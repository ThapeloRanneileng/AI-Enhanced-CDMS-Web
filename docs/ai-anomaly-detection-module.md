# AI Observation Anomaly Detection

## Architecture Decision

The AI anomaly layer is a shared observation intelligence layer for AI-Enhanced CDMS. It is source-agnostic and operates on the shared observations path used by manual forms, manual CSV import, and future automated ingestion.

It is not an AWS ingestion component. Future AWS ingestion should save observations into the shared observation pipeline and then trigger this module the same way every other source does.

## Supported Observation Origins

The module is designed to score observations from:

- manual hourly form
- manual daily form
- manual monthly form
- manual CSV import
- future AWS ingestion

Source/origin is metadata for filtering, diagnosis, and explainability. It is not the architectural identity of the anomaly engine.

## Module Boundary

Backend module:

- `back-end/api/src/observation-ai/observation-ai.module.ts`

Core responsibilities:

- prepare training datasets from the shared observation store
- support temporary public proxy datasets for cold-start training
- build model-ready features
- resolve model families by element, interval, level, and station/station-group scope
- score observations
- generate explanations
- persist anomaly assessments in `observation_anomaly_assessments`
- expose outputs to QC Review Workspace

## Internal Services

- `AnomalyTrainingDataPreparationService`
  - prepares training rows from shared observations
  - filters by station, element code, interval, level, source, and date range
  - supports `TEMP`, `RH`, `PRES`, `RN`, `WS`, and `WD`

- `AnomalyProxyTrainingSourceService`
  - declares temporary public training sources:
    - ERA5
    - ERA5-Land
    - GHCN-Daily
    - CHIRPS
    - Meteostat for quick demo/prototype support
  - keeps these sources as replaceable training inputs, not engine ownership

- `AnomalyModelTrainingService`
  - builds a training plan
  - declares candidate model families:
    - `seasonal_gaussian_ensemble`
    - `isolation_forest`
    - `one_class_svm`
  - groups training by element, interval, level, and station/station-group scope

- `AnomalyFeatureBuilderService`
  - performs feature engineering for inference
  - currently builds rolling and seasonal features from shared observations

- `AnomalyModelRegistryService`
  - resolves model metadata by observation characteristics
  - source-aware through observation metadata, but not source-dependent

- `ObservationAnomalyDetectionService`
  - scores observations and returns model output

- `ObservationAnomalyAssessmentService`
  - persists results for QC/review compatibility

## Training Preparation API

Training preparation endpoints:

- `POST /observation-ai/training/dataset-preview`
- `POST /observation-ai/training/plan`
- `POST /observation-ai/training/run`
- `GET /observation-ai/training/proxy-sources`

Example request:

```json
{
  "stationIds": ["09"],
  "elementCodes": ["TEMP", "RH"],
  "intervals": [60, 1440],
  "level": 0,
  "fromDate": "2026-01-01T00:00:00.000Z",
  "toDate": "2026-04-15T23:59:59.000Z"
}
```

`POST /observation-ai/training/run` trains baseline models, persists the training run, persists model metadata/state, and registers the models for scoring.

The first executable baseline model families are:

- `isolation_forest`
- `one_class_svm`

The initial implementation uses lightweight TypeScript baseline approximations around normalized feature distance. This gives AI-Enhanced CDMS an executable source-agnostic training and scoring path now, while keeping the service boundary ready for a Python/scikit-learn worker later.

Persisted metadata tables:

- `observation_anomaly_training_runs`
- `observation_anomaly_models`

Persisted model metadata includes:

- `model_id`
- `model_name`
- `model_version`
- `station_id`
- `element_id`
- `interval`
- `level`
- `training_range_from`
- `training_range_to`
- `training_rows`
- `training_dataset_kind`
- `feature_schema_version`
- `created_at`

The current baseline scorer also stores compact `model_state` so the API can reload trained baselines on startup. `AnomalyModelRegistryLoaderService` ensures the tables exist and reloads the latest persisted model per station/element/interval/level/model into the runtime registry.

## Feature Pipeline

Training and scoring features are prepared from shared observation records:

- `value`
- `previousValue`
- `differenceFromPrevious`
- `rollingMean`
- `rollingStdDev`
- `rollingZScore`
- `month`
- `season`
- `hour` for sub-daily intervals

Training groups are currently:

- station
- element
- interval
- level

This can be widened to station groups when station-network metadata is ready for model grouping.

## Model Output Contract

The anomaly result remains compatible with the current QC/review workflow and exposes neutral output names:

- `anomalyScore`
- `confidenceScore`
- `modelId`
- `modelName`
- `modelFamily`
- `modelVersion`
- `finalDecision`
- `explanation`
- `severity`
- `outcome`
- `reasons`
- `featureSnapshot`
- `contributingSignals`

Persisted results remain in:

- `observation_anomaly_assessments`

## QC/Review Integration

The QC Review Workspace should read from:

- `GET /observation-anomaly-assessments/review-workspace`

This path returns anomaly assessments generated from the shared observation pipeline. It is not AWS-specific.

Review-visible records can originate from manual form data, manual CSV import, or future automated ingestion as long as they were saved into shared observations and assessed by the AI anomaly layer.

## Future AWS Ingestion Integration

AWS ingestion should later plug in by:

1. normalizing AWS observations into the shared observation model
2. saving them through the same observation persistence path
3. emitting the existing `observations.saved` event
4. allowing `ObservationAnomalyJobService` to assess those observations
5. using `sourceId` and origin labels only as metadata

AWS does not own the anomaly engine. It will be one source that benefits from the shared anomaly layer.
