# LMS Historical AI Pipeline

This pipeline prepares cleaned LMS historical daily observations for AI anomaly testing and QC review handoff.

## Input File

Place the cleaned row-complete CSV here:

```text
data/lms/observations/lms_cleaned_row_complete_wide_LESBUT01_LESLER01.csv
```

Expected columns:

```text
id,year,month,day,rain,tmax,tmin
```

If the file is missing, the LMS commands stop with a clear message showing this path.

## Cleaning Statistics

The input is already cleaned before this pipeline runs. A daily row was kept only when `rain`, `tmax`, and `tmin` were all present.

- Before cleaning: 12,600 daily rows, 37,800 possible observation values
- After cleaning: 10,548 complete daily rows, 31,644 clean observation values
- Removed: 2,052 incomplete daily rows
- LESBUT01: 5,566 complete rows, 460 removed
- LESLER01: 4,982 complete rows, 1,592 removed

## Mappings

Stations:

- `LESBUT01` -> `Butha-Buthe Station 01`
- `LESLER01` -> `Leribe Station 01`

Elements:

- `rain` -> `Rainfall`, `mm`
- `tmax` -> `Maximum Temperature`, `degC`
- `tmin` -> `Minimum Temperature`, `degC`

Source:

- `LMS Historical Daily CSV`

## Normalized Training Format

The wide daily rows are normalized to long rows with:

- `stationId`
- `stationName`
- `observationDatetime`
- `elementCode`
- `elementName`
- `value`
- `unit`
- `source`
- `dataType`
- `originalRowNumber`

## Train/Test Split

The split is time-based, never shuffled. Each station-element series is split separately:

- earliest 80% -> training
- latest 20% -> testing

## Features

The pipeline creates:

- `value`
- station and element encodings
- `year`, `month`, `day`, `dayOfYear`
- monthly mean and standard deviation
- `z_score`, `seasonal_z_score`
- 7-day and 30-day rolling mean/std
- previous value
- value difference
- `missing_indicator`

## Models

- Z-score: always available.
- Isolation Forest: uses scikit-learn if installed; otherwise a deterministic seasonal-distance fallback is written so the pipeline stays runnable.
- One-Class SVM: uses scikit-learn if installed; otherwise a deterministic seasonal-distance fallback is written.
- Autoencoder: optional. If TensorFlow/Keras is unavailable, `lms_autoencoder_predictions.csv` is created with headers only and model status says unavailable.
- Random Forest: not trained because this cleaned LMS CSV has no reliable `NORMAL`, `SUSPECT`, or `FAILED` labels. `lms_random_forest_status.csv` documents the requirement for future QC-reviewed labels.

Prediction is never done by GenAI. Explanations are deterministic templates for now and can later be replaced by a Copilot/OpenAI-compatible explanation adapter.

## Outputs

Outputs are written under:

```text
data/lms/outputs/
```

Key files:

- `lms_inspection_summary.csv`
- `lms_training_input_normalized.csv`
- `lms_training_validation_summary.csv`
- `lms_training_validation_warnings.csv`
- `lms_train_split.csv`
- `lms_test_split.csv`
- `lms_train_test_summary.csv`
- `lms_zscore_predictions.csv`
- `lms_isolation_forest_predictions.csv`
- `lms_one_class_svm_predictions.csv`
- `lms_autoencoder_predictions.csv`
- `lms_random_forest_status.csv`
- `lms_anomaly_predictions.csv`
- `lms_ensemble_anomaly_predictions.csv`
- `lms_qc_review_handoff.csv`

Rejected rows, if any, are written to:

```text
data/lms/rejected/lms_training_rejected_rows.csv
```

## Commands

Run from `aws-ingestion-layer`:

```bash
python3 -m src.lms_ai_pipeline.inspect
python3 -m src.lms_ai_pipeline.prepare
python3 -m src.lms_ai_pipeline.train
python3 -m src.lms_ai_pipeline.predict
python3 -m src.lms_ai_pipeline.run_all
```

The QC Review handoff contains `SUSPECT`, `FAILED`, model-agreement anomalies, and validation warnings such as `tmin > tmax`. It supports the existing workflow:

```text
AI detects -> AI flags -> QC reviewer decides
```
