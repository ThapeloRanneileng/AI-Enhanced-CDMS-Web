from __future__ import annotations

from typing import Dict, List

from .config import (
    AUTOENCODER_PREDICTIONS_FILE,
    AUTOENCODER_HISTORY_FILE,
    AUTOENCODER_STATUS_FILE,
    COMBINED_PREDICTIONS_FILE,
    ENSEMBLE_PREDICTIONS_FILE,
    ISOLATION_FOREST_PREDICTIONS_FILE,
    MODEL_METADATA_FILE,
    NORMALIZED_FILE,
    ONE_CLASS_SVM_PREDICTIONS_FILE,
    QC_HANDOFF_FILE,
    RANDOM_FOREST_STATUS_FILE,
    TEST_SPLIT_FILE,
    TRAIN_SPLIT_FILE,
    TRAIN_TEST_SUMMARY_FILE,
    VALIDATION_WARNINGS_FILE,
    ZSCORE_PREDICTIONS_FILE,
)
from .core import FEATURE_FIELDS, NORMALIZED_FIELDS, calculate_feature_rows, group_series, prepare, split_train_test
from .ensemble import ENSEMBLE_FIELDS, ensemble_predictions
from .io import read_csv, write_csv
from .models import (
    AUTOENCODER_HISTORY_FIELDS,
    AUTOENCODER_STATUS_FIELDS,
    AutoencoderConfig,
    PREDICTION_FIELDS,
    autoencoder_predictions,
    isolation_forest_predictions,
    model_status_rows,
    one_class_svm_predictions,
    random_forest_status_rows,
    zscore_predictions,
)
from .reporting import generate_model_evaluation_report
from .visualisations import generate_visualisations
from .genai import generate_genai_outputs


def train_models() -> int:
    if not NORMALIZED_FILE.exists():
        prepare()
    normalized = read_csv(NORMALIZED_FILE)
    if not normalized:
        raise ValueError("No normalized LMS observations are available for training. Run prepare and check station mapping and CSV headers.")
    train_rows, test_rows, summary = split_train_test(normalized)
    if not train_rows or not test_rows:
        raise ValueError("LMS train/test split is empty. Need at least two clean observations per station-element series.")
    train_features = calculate_feature_rows(train_rows, train_rows)
    test_features = calculate_feature_rows(test_rows, train_rows)
    if not train_features or not test_features:
        raise ValueError("LMS feature generation produced empty train or test data.")
    write_csv(TRAIN_SPLIT_FILE, train_features, FEATURE_FIELDS)
    write_csv(TEST_SPLIT_FILE, test_features, FEATURE_FIELDS)
    write_csv(TRAIN_TEST_SUMMARY_FILE, summary, [
        "stationId", "elementCode", "totalRows", "trainRows", "testRows", "trainFrom", "trainTo", "testFrom", "testTo",
    ])
    status_rows = model_status_rows() + insufficient_series_status_rows(summary)
    write_csv(MODEL_METADATA_FILE, status_rows, ["modelName", "status", "message"])
    return len(train_features)


def predict_anomalies(config: AutoencoderConfig | None = None) -> int:
    if not TEST_SPLIT_FILE.exists():
        train_models()
    test_rows = read_csv(TEST_SPLIT_FILE)
    if not test_rows:
        raise ValueError("No LMS test rows are available for prediction. Run train and check the train/test split.")
    z_rows = zscore_predictions(test_rows)
    if_rows = isolation_forest_predictions(test_rows)
    svm_rows = one_class_svm_predictions(test_rows)
    train_rows = read_csv(TRAIN_SPLIT_FILE)
    ae_rows, ae_history_rows, ae_status_rows = autoencoder_predictions(train_rows, test_rows, config)
    rf_status = random_forest_status_rows()

    write_csv(ZSCORE_PREDICTIONS_FILE, z_rows, PREDICTION_FIELDS)
    write_csv(ISOLATION_FOREST_PREDICTIONS_FILE, if_rows, PREDICTION_FIELDS)
    write_csv(ONE_CLASS_SVM_PREDICTIONS_FILE, svm_rows, PREDICTION_FIELDS)
    write_csv(AUTOENCODER_PREDICTIONS_FILE, ae_rows, PREDICTION_FIELDS)
    write_csv(AUTOENCODER_HISTORY_FILE, ae_history_rows, AUTOENCODER_HISTORY_FIELDS)
    write_csv(AUTOENCODER_STATUS_FILE, ae_status_rows, AUTOENCODER_STATUS_FIELDS)
    write_csv(RANDOM_FOREST_STATUS_FILE, rf_status, ["modelName", "status", "reason", "requiredInput"])

    combined = z_rows + if_rows + svm_rows + ae_rows
    write_csv(COMBINED_PREDICTIONS_FILE, combined, PREDICTION_FIELDS)
    ensemble = ensemble_predictions(combined)
    write_csv(ENSEMBLE_PREDICTIONS_FILE, ensemble, ENSEMBLE_FIELDS)
    write_qc_handoff(ensemble)
    return len(combined)


def write_qc_handoff(ensemble_rows: List[Dict[str, object]]) -> None:
    warnings = read_csv(VALIDATION_WARNINGS_FILE) if VALIDATION_WARNINGS_FILE.exists() else []
    review_rows: List[Dict[str, object]] = []
    for row in ensemble_rows:
        if row["outcome"] in {"SUSPECT", "FAILED"}:
            review_rows.append({**row, "reviewReason": "MODEL_ANOMALY"})
    for warning in warnings:
        if warning.get("warningType") in {"TMIN_GREATER_THAN_TMAX", "NEGATIVE_RAINFALL", "EXTREME_VALUE", "IQR_OUTLIER", "SUSPICIOUS_CONSTANT_SEQUENCE", "DUPLICATE_CONFLICT"}:
            review_rows.append({
                "stationId": warning.get("stationId", ""),
                "stationName": warning.get("stationName", ""),
                "district": warning.get("district", ""),
                "stationType": warning.get("stationType", ""),
                "observationDatetime": warning.get("observationDatetime", ""),
                "elementCode": warning.get("elementCode", ""),
                "elementName": "",
                "value": warning.get("value", ""),
                "unit": "",
                "modelAgreementCount": 0,
                "agreeingModels": "validation",
                "anomalyScore": "",
                "confidence": "0.80",
                "severity": "MEDIUM",
                "outcome": "SUSPECT",
                "explanation": warning.get("message", ""),
                "recommendedReviewerAction": "Check LMS source record before approval.",
                "reviewReason": warning.get("warningType", ""),
            })
    write_csv(QC_HANDOFF_FILE, review_rows, ENSEMBLE_FIELDS + ["reviewReason"])


def insufficient_series_status_rows(summary: List[Dict[str, object]]) -> List[Dict[str, object]]:
    rows: List[Dict[str, object]] = []
    for item in summary:
        if int(item.get("testRows", 0) or 0) == 0 or int(item.get("trainRows", 0) or 0) == 0:
            rows.append({
                "modelName": "Data sufficiency",
                "status": "skipped_series",
                "message": (
                    f"{item.get('stationId', '')}/{item.get('elementCode', '')} has "
                    f"{item.get('totalRows', 0)} clean rows and was not usable for train/test modelling."
                ),
            })
    return rows


def run_all(config: AutoencoderConfig | None = None) -> int:
    prepare()
    train_models()
    prediction_count = predict_anomalies(config)
    generate_model_evaluation_report()
    generate_visualisations()
    generate_genai_outputs()
    return prediction_count
