# AWS Anomaly Engine

This folder contains a student-friendly, modular Python pipeline for automatic weather station (AWS) ingestion, anomaly detection, review queue preparation, and summary reporting.

The pipeline starts with raw AWS station data, validates and normalizes it, prepares it for QC, runs a baseline anomaly engine, generates reviewer-friendly explanations, writes review-ready CSV outputs, and then produces a simple text and CSV summary for engineering review.

## Pipeline Overview

The full flow is:

1. `AWS raw input`
   Raw observations are read from `data/raw/aws_sample_observations.csv`.

2. `Ingestion`
   `src/aws_ingestion.py` parses the source file, standardizes station IDs and timestamps, and reshapes each AWS row into normalized observation rows.

3. `Validation and rejection`
   Invalid rows are rejected if they fail basic checks such as missing values, bad timestamps, unknown stations, invalid humidity, negative rainfall, or invalid wind direction.

4. `QC handoff`
   `src/aws_qc_handoff.py` takes the cleaned normalized observations and adds workflow fields like `qc_status`, `ml_status`, and `review_status`.

5. `Feature engineering`
   `src/features.py` computes reusable time-series features such as previous value, difference from previous, rolling mean, rolling standard deviation, hour of day, and month.

6. `Model engine`
   `src/models.py` runs two baseline anomaly models:
   `Isolation Forest` and `One-Class SVM`.

7. `Decision engine`
   `src/decision.py` combines the two model outputs into one final review decision:
   `NORMAL`, `SUSPECT`, or `FAILED`.

8. `Explanation engine`
   `src/explain.py` generates readable anomaly explanations, anomaly types, severity labels, and element-specific recommended actions.

9. `Review queue output`
   `src/aws_anomaly_detection.py` writes a review-ready CSV that combines normalized observation fields, engineered features, model outputs, final decisions, explanations, and audit metadata.

10. `Summary and reporting`
    `src/report_summary.py` reads the review queue and creates a simple engineering summary report and grouped counts output.

## How the Engine Works

### Feature Engineering

The anomaly engine adds lightweight sequence-aware features for each `station_id` and `element_code` series:

- `previous_value`: the most recent prior observation in that station-element series
- `difference_from_previous`: current value minus previous value
- `rolling_mean_3`: mean of the current row plus up to two previous rows
- `rolling_std_3`: standard deviation over the same rolling window
- `hour_of_day`: extracted from the observation timestamp
- `month`: extracted from the observation timestamp

These features give the models local context instead of relying only on the raw observation value.

### Baseline Models

The engine uses two simple baseline anomaly models.

`Isolation Forest`
- Good for identifying unusual rows in a mixed feature space
- Works by isolating observations that are easier to separate from normal patterns

`One-Class SVM`
- Learns a boundary around what looks normal in the feature space
- Flags rows that fall outside that boundary

The project keeps both models because this makes the baseline engine more robust and also easier to explain. Reviewers can see whether one model flagged a row or whether both models agreed.

### Final Decision Logic

The decision engine does not expose raw model predictions directly as the final answer.

Instead, it converts the two model outputs into one review status:

- `NORMAL`: the row does not have enough model evidence to justify review escalation
- `SUSPECT`: there is some anomaly evidence, but not enough for a strict failure
- `FAILED`: both models agree and the anomaly signal is strong enough to justify a stricter review outcome

This makes `FAILED` intentionally stricter than `SUSPECT`.

### Explanation Summaries

The explanation engine uses:

- current value
- previous value
- rolling mean
- rolling standard deviation
- model labels
- model scores
- final decision
- `element_code`

It then generates:

- `anomaly_type`
- `severity`
- `explanation_summary`
- `recommended_action`

The explanation text is element-aware. For example:

- `RH` rows mention humidity or moisture change
- `RAIN` rows mention rainfall spikes or rainfall surges
- `PRES` rows mention pressure movement relative to recent trend
- `WSPD` rows mention wind-speed jumps or instability
- `WDIR` rows mention wind-direction shifts
- `TEMP` rows mention temperature spikes or drops

### Audit Fields

To improve traceability, the anomaly outputs include:

- `record_id`: stable identifier built from station, element, and timestamp
- `run_timestamp`: timestamp for the anomaly engine run
- `model_version`: version label for the baseline model bundle
- `engine_version`: version label for the anomaly engine logic
- `pipeline_stage`: identifies the stage that produced the output

These fields help with debugging, reproducibility, downstream review workflows, and later backend integration.

## Output Files

### `data/processed/aws_cleaned_output.csv`

Cleaned and normalized AWS observations after validation. Each raw station row is reshaped into separate normalized observation rows such as `TEMP`, `RAIN`, `RH`, `PRES`, `WSPD`, and `WDIR`.

### `outputs/aws_qc_input.csv`

QC-ready observation rows with workflow fields added:

- `qc_status`
- `ml_status`
- `review_status`

This file is the handoff from ingestion into the anomaly pipeline.

### `outputs/aws_anomaly_output.csv`

Anomaly-engine output with:

- normalized observation fields
- audit metadata
- engineered features
- model labels and model scores
- final decision fields
- explanation fields

This is the main anomaly-detection output.

### `outputs/aws_review_queue.csv`

Review-ready queue output for downstream analyst workflows. It contains the same review-facing anomaly fields as the anomaly output and is intended to be the clean bridge into a later QC review workspace.

### `outputs/aws_summary_report.txt`

Plain-text engineering summary generated from the review queue. It includes:

- total row count
- counts by final decision
- counts by severity
- counts by anomaly type
- counts by station
- counts by element
- top suspicious rows
- top failed rows when present

### `outputs/aws_summary_counts.csv`

Grouped count summary in CSV format for lightweight reporting or downstream inspection.

## How to Run

Run from the project root:

### Ingestion

```bash
python3 src/aws_ingestion.py
```

### QC Handoff

```bash
python3 src/aws_qc_handoff.py
```

### Anomaly Detection

```bash
python3 src/aws_anomaly_detection.py
```

### Full Pipeline

```bash
python3 -m src.run_pipeline
```

### Summary Reporting

```bash
python3 -m src.report_summary
```

### Tests

```bash
python3 -m pytest -q
```

Note:
The anomaly engine depends on `numpy` and `scikit-learn`, and the test command depends on `pytest`.

## LMS AI Pipeline

The LMS AI pipeline supports the broader AI-Enhanced Climate Data Management System by preparing historical Lesotho Meteorological Services observations for AI-assisted quality-control review. It validates and normalizes LMS daily CSV observations, creates station-element time-series features, runs baseline anomaly models, trains the TensorFlow/Keras Autoencoder when available, combines model outputs into an ensemble review decision, and writes supervisor-friendly audit outputs.

The AI layer does not automatically decide that values are wrong. It prioritizes unusual observations for human QC review and records evidence such as model agreement, anomaly scores, threshold calibration, explanations, and review reasons.

### Environment

Use the virtual environment under this folder:

```bash
cd front-end/pwa/aws-ingestion-layer
PYTHONPATH=src ./.venv/bin/python -m pytest -q tests
```

### Run Tests

From the repository root:

```bash
PYTHONPATH=front-end/pwa/aws-ingestion-layer/src front-end/pwa/aws-ingestion-layer/.venv/bin/python -m pytest -q front-end/pwa/aws-ingestion-layer/tests
```

### Run the Full LMS AI Pipeline

```bash
cd front-end/pwa/aws-ingestion-layer
LMS_GENAI_PROVIDER=template PYTHONPATH=src ./.venv/bin/python -m src.lms_ai_pipeline.run_all \
  --epochs 20 \
  --batch-size 128 \
  --patience 5 \
  --contamination 0.03 \
  --autoencoder-calibration station_element_quantile \
  --autoencoder-suspect-quantile 0.99 \
  --autoencoder-failed-quantile 0.999
```

Important CLI options:

- `--epochs`: maximum Autoencoder training epochs.
- `--batch-size`: Autoencoder training batch size.
- `--patience`: early-stopping patience for Autoencoder training.
- `--contamination`: expected anomaly proportion used by baseline models and threshold calibration.
- `--autoencoder-calibration`: Autoencoder threshold mode. Use `station_element_quantile` for station-element thresholds with fallback to element and global thresholds.
- `--autoencoder-suspect-quantile`: train-error quantile used for SUSPECT Autoencoder thresholds.
- `--autoencoder-failed-quantile`: train-error quantile used for FAILED Autoencoder thresholds.

### Generated LMS Outputs

LMS generated outputs are written under `front-end/pwa/data/lms/outputs/` and rejected/missing raw-value support files under `front-end/pwa/data/lms/rejected/`.

Key outputs include:

- `lms_all_station_training_input_normalized.csv`: cleaned normalized LMS rows with provenance fields.
- `lms_zscore_predictions.csv`, `lms_isolation_forest_predictions.csv`, `lms_one_class_svm_predictions.csv`, `lms_autoencoder_predictions.csv`: per-model predictions with explanations and provenance.
- `lms_ensemble_anomaly_predictions.csv`: ensemble model agreement and final review decision.
- `lms_qc_review_handoff.csv`: reviewer handoff rows with `reviewSource`, trigger flags, and human-readable `reviewReason`.
- `lms_model_evaluation_summary.json`, `.csv`, `.md`: model metrics, anomaly rates, station/element summaries, and calibration warnings.
- `lms_pipeline_run_manifest.json`: run ID, runtime metadata, Git/Python/platform details, input/output file metadata, row counts, and Autoencoder settings.
- `lms_supervisor_summary.md`: concise supervisor-facing overview of the run, model results, review queue, interpretation notes, and recommended next actions.

Do not commit generated LMS CSVs, reports, charts, model files, or raw data. They should stay under ignored `data/lms/outputs/` or data/rejected locations.

### Troubleshooting TensorFlow CPU/GPU Warnings

TensorFlow may print messages such as missing CUDA drivers, CPU instruction optimization, or failed GPU initialization. These warnings usually mean the run is using CPU instead of GPU. CPU execution is acceptable for local validation; check the Autoencoder status CSV and run manifest to confirm whether training completed. If training is slow, reduce `--epochs`, lower `--batch-size`, or use a machine with a compatible TensorFlow GPU setup.

## Project Modules

- `src/aws_ingestion.py`: raw AWS ingestion, validation, rejection, and normalization
- `src/aws_qc_handoff.py`: QC handoff preparation
- `src/features.py`: reusable feature engineering
- `src/models.py`: baseline anomaly model runners
- `src/decision.py`: final anomaly decision rules
- `src/explain.py`: explanation, anomaly typing, severity, and recommended actions
- `src/aws_anomaly_detection.py`: anomaly pipeline entry point and CSV output generation
- `src/run_pipeline.py`: one-command pipeline runner
- `src/report_summary.py`: summary report generation

## Manual Import Prototype

The AI-Enhanced CDMS Manual Import prototype adds a simple CSV-based workflow for importing common data without using the full legacy Climsoft V4 import system. It is designed as a demo-ready bridge between user-supplied files, AI-Enhanced CDMS metadata, raw observations, and the existing QC workflow.

The first implemented import types are:

- `Station Metadata Import`
- `Observation Data Import`

Both import screens follow the same basic flow:

1. Select an import type from the Manual Import page.
2. Upload a CSV or text file.
3. Choose the delimiter when needed.
4. Preview detected headers and the first rows.
5. Map CSV columns to AI-Enhanced CDMS fields.
6. Click `Import`.
7. Review the imported count and rejected rows with reasons.

### Station Metadata Import

Station Metadata Import creates new station records from a CSV file. It is intended for small, practical metadata imports where the user has a spreadsheet of stations and wants to load only valid rows.

Supported fields:

- `id`
- `name`
- `description`
- `latitude`
- `longitude`
- `elevation`
- `wmoId`
- `wigosId`
- `icaoId`
- `comment`

Validation rules:

- `id` is required.
- `name` is required.
- `latitude`, `longitude`, and `elevation` must be numeric when provided.
- Duplicate station IDs are rejected.
- Invalid rows are skipped; valid rows are still imported.

The result summary shows total rows, imported rows, and rejected rows. Each rejected row includes the CSV row number, station ID when available, and validation reasons.

### Observation Data Import

Observation Data Import loads raw observation values for existing stations and elements. It is a minimal import path for data that should enter AI-Enhanced CDMS before QC.

Required mappings:

- `stationId`
- `element`
- `observationDatetime`
- `value`

Optional mappings:

- `level`
- `interval`
- `source`
- `comment`

Validation rules:

- `stationId` is required and must already exist in station metadata.
- `element` is required and must match an existing element by ID, abbreviation, or name.
- `observationDatetime` is required and must parse as a valid date/time.
- `value` is required and must be numeric.
- `level` and `interval` must be integers when provided.
- `source` may be a source ID or source name. If omitted, the backend uses an active import source when available.
- Invalid rows are skipped; valid rows are still imported.

The result summary shows total rows, imported rows, and rejected rows. Each rejected row includes the CSV row number, station ID, element, and validation reasons.

### QC Workflow Note

Imported observations are saved into the normal `observations` table with `qcStatus = NONE`. This means they are treated as raw, not-yet-quality-controlled observations.

After import, the observations can be processed through the existing QC workflow. QC can then update their status, flag suspect values, and make them available to downstream review, reporting, and anomaly workflows.

### Demo Steps

Station metadata demo:

1. Open Manual Import.
2. Select `Station Metadata Import`.
3. Upload a CSV with headers such as `id,name,latitude,longitude,elevation,wmoId,comment`.
4. Confirm or adjust the column mapping.
5. Click `Import`.
6. Review imported and rejected rows.

Observation data demo:

1. Open Manual Import.
2. Select `Observation Data Import`.
3. Upload a CSV with headers such as `stationId,element,observationDatetime,value,level,interval,source,comment`.
4. Confirm or adjust the column mapping.
5. Click `Import`.
6. Review imported and rejected rows.
7. Run the normal QC workflow for the imported observations.

### Known Limitations and Future Work

- Add more legacy import types beyond stations and observations.
- Provide downloadable CSV templates for each import type.
- Add richer validation, including coordinate ranges, duplicate observation checks, and source-specific rules.
- Save reusable import mappings for repeated files from the same source.
- Integrate import summaries with broader reporting and audit views.

## Integration Path

`aws_review_queue.csv` is designed to feed a later QC Review Workspace.

The idea is to keep this repository focused on the backend and ML preparation layer:

- ingest and normalize AWS observations
- enrich rows with feature context
- run baseline anomaly models
- convert model output into review-friendly decisions
- generate explanation text and recommended actions
- provide traceable audit metadata

A future QC Review Workspace can then consume `aws_review_queue.csv` as a separate downstream integration step. That workspace can focus on human review, approval, rejection, and workflow management without needing to reimplement ingestion or anomaly logic.

In other words, this repository acts as the backend/ML layer, while the future review application can act as the user-facing review layer.
