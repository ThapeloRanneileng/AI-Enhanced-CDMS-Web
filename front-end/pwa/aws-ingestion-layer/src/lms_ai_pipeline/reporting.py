from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Dict, List, Sequence

from .config import (
    AUTOENCODER_HISTORY_FILE,
    AUTOENCODER_STATUS_FILE,
    ENSEMBLE_PREDICTIONS_FILE,
    MODEL_EVALUATION_SUMMARY_CSV,
    MODEL_EVALUATION_SUMMARY_JSON,
    MODEL_EVALUATION_SUMMARY_MD,
    MODEL_METADATA_FILE,
    NORMALIZED_FILE,
    RANDOM_FOREST_STATUS_FILE,
    TEST_SPLIT_FILE,
    TRAIN_SPLIT_FILE,
)
from .io import read_csv, write_csv

SUMMARY_FIELDS = ["section", "metric", "key", "value"]


def safe_read_csv(path: Path) -> List[Dict[str, str]]:
    return read_csv(path) if path.exists() else []


def count_by(rows: Sequence[Dict[str, str]], field: str) -> Dict[str, int]:
    return dict(sorted(Counter(row.get(field, "") for row in rows).items()))


def add_count_rows(output: List[Dict[str, object]], section: str, metric: str, counts: Dict[str, int]) -> None:
    for key, value in counts.items():
        output.append({"section": section, "metric": metric, "key": key, "value": value})


def decision_counts(rows: Sequence[Dict[str, str]]) -> Dict[str, int]:
    field = "finalDecision" if rows and "finalDecision" in rows[0] else "outcome"
    return count_by(rows, field)


def anomaly_rows(rows: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    return [row for row in rows if row.get("finalDecision", row.get("outcome", "")) in {"SUSPECT", "FAILED"}]


def load_prediction_rows(output_dir: Path) -> Dict[str, List[Dict[str, str]]]:
    files = {
        "Z-score": output_dir / "lms_zscore_predictions.csv",
        "Isolation Forest": output_dir / "lms_isolation_forest_predictions.csv",
        "One-Class SVM": output_dir / "lms_one_class_svm_predictions.csv",
        "Autoencoder": output_dir / "lms_autoencoder_predictions.csv",
        "Ensemble": ENSEMBLE_PREDICTIONS_FILE,
    }
    return {name: safe_read_csv(path) for name, path in files.items()}


def top_anomaly_examples(rows: Sequence[Dict[str, str]], limit: int = 20) -> List[Dict[str, str]]:
    return sorted(
        anomaly_rows(rows),
        key=lambda row: float(row.get("anomalyScore") or 0.0),
        reverse=True,
    )[:limit]


def rate_warning(model_name: str, rate: float) -> str:
    return (
        f"{model_name} anomaly rate is {rate:.4f}, above 0.2000. "
        "High anomaly rate means threshold calibration requires review, not necessarily model failure."
    )


def build_report_payload() -> Dict[str, object]:
    normalized = safe_read_csv(NORMALIZED_FILE)
    train = safe_read_csv(TRAIN_SPLIT_FILE)
    test = safe_read_csv(TEST_SPLIT_FILE)
    model_status = safe_read_csv(MODEL_METADATA_FILE)
    rf_status = safe_read_csv(RANDOM_FOREST_STATUS_FILE)
    autoencoder_status = safe_read_csv(AUTOENCODER_STATUS_FILE)
    autoencoder_history = safe_read_csv(AUTOENCODER_HISTORY_FILE)
    prediction_rows = load_prediction_rows(MODEL_EVALUATION_SUMMARY_CSV.parent)
    ensemble = prediction_rows["Ensemble"]
    anomalies = anomaly_rows(ensemble)
    anomaly_rates = {
        name: (len(anomaly_rows(rows)) / len(rows) if rows else 0.0)
        for name, rows in prediction_rows.items()
    }
    calibration_status = autoencoder_status[0] if autoencoder_status else {}
    warnings = []
    if float(anomaly_rates.get("Autoencoder", 0.0)) > 0.20:
        warnings.append(rate_warning("Autoencoder", float(anomaly_rates["Autoencoder"])))
    if float(anomaly_rates.get("Ensemble", 0.0)) > 0.20:
        warnings.append(rate_warning("Ensemble", float(anomaly_rates["Ensemble"])))

    final_history = autoencoder_history[-1] if autoencoder_history else {}
    return {
        "totalNormalizedRows": len(normalized),
        "trainRows": len(train),
        "testRows": len(test),
        "modelStatus": model_status,
        "rowsPredictedPerModel": {name: len(rows) for name, rows in prediction_rows.items()},
        "decisionCountsPerModel": {name: decision_counts(rows) for name, rows in prediction_rows.items()},
        "anomalyRatePerModel": anomaly_rates,
        "stationAnomalyCounts": count_by(anomalies, "stationId"),
        "elementAnomalyCounts": count_by(anomalies, "elementCode"),
        "modelAgreementDistribution": count_by(ensemble, "modelAgreementCount"),
        "topAnomalyExamples": top_anomaly_examples(ensemble),
        "autoencoderStatus": autoencoder_status,
        "autoencoderFinalLoss": final_history.get("loss", ""),
        "autoencoderFinalValidationLoss": final_history.get("validationLoss", ""),
        "autoencoderCalibrationMode": calibration_status.get("calibrationMode", ""),
        "autoencoderSuspectThreshold": calibration_status.get("globalSuspectThreshold", ""),
        "autoencoderFailedThreshold": calibration_status.get("globalFailedThreshold", ""),
        "calibrationWarnings": warnings,
        "randomForestStatus": rf_status,
        "randomForestExplanation": "Random Forest is not trained because the LMS training data does not include reviewer-approved NORMAL/SUSPECT/FAILED labels.",
    }


def payload_to_summary_rows(payload: Dict[str, object]) -> List[Dict[str, object]]:
    rows: List[Dict[str, object]] = [
        {"section": "dataset", "metric": "totalNormalizedRows", "key": "all", "value": payload["totalNormalizedRows"]},
        {"section": "dataset", "metric": "trainRows", "key": "all", "value": payload["trainRows"]},
        {"section": "dataset", "metric": "testRows", "key": "all", "value": payload["testRows"]},
        {"section": "autoencoder", "metric": "finalLoss", "key": "loss", "value": payload["autoencoderFinalLoss"]},
        {"section": "autoencoder", "metric": "finalValidationLoss", "key": "val_loss", "value": payload["autoencoderFinalValidationLoss"]},
        {"section": "autoencoder", "metric": "calibrationMode", "key": "mode", "value": payload["autoencoderCalibrationMode"]},
        {"section": "autoencoder", "metric": "suspectThreshold", "key": "global", "value": payload["autoencoderSuspectThreshold"]},
        {"section": "autoencoder", "metric": "failedThreshold", "key": "global", "value": payload["autoencoderFailedThreshold"]},
        {"section": "randomForest", "metric": "notTrainedReason", "key": "labels", "value": payload["randomForestExplanation"]},
    ]
    for name, count in dict(payload["rowsPredictedPerModel"]).items():
        rows.append({"section": "models", "metric": "rowsPredicted", "key": name, "value": count})
    for name, counts in dict(payload["decisionCountsPerModel"]).items():
        add_count_rows(rows, "models", f"{name} decisionCounts", dict(counts))
    for name, rate in dict(payload["anomalyRatePerModel"]).items():
        rows.append({"section": "models", "metric": "anomalyRate", "key": name, "value": f"{float(rate):.6f}"})
    for warning in payload.get("calibrationWarnings", []):
        rows.append({"section": "warnings", "metric": "highAnomalyRate", "key": "calibration", "value": warning})
    add_count_rows(rows, "stations", "anomalyCounts", dict(payload["stationAnomalyCounts"]))
    add_count_rows(rows, "elements", "anomalyCounts", dict(payload["elementAnomalyCounts"]))
    add_count_rows(rows, "ensemble", "modelAgreementDistribution", dict(payload["modelAgreementDistribution"]))
    return rows


def build_markdown(payload: Dict[str, object]) -> str:
    lines = [
        "# LMS Model Evaluation Summary",
        "",
        f"- Total normalized rows: {payload['totalNormalizedRows']}",
        f"- Train rows: {payload['trainRows']}",
        f"- Test rows: {payload['testRows']}",
        "",
        "## Model Status",
    ]
    for row in payload["modelStatus"]:
        lines.append(f"- {row.get('modelName', '')}: {row.get('status', '')} - {row.get('message', '')}")
    lines.extend(["", "## Rows Predicted Per Model"])
    for name, count in dict(payload["rowsPredictedPerModel"]).items():
        lines.append(f"- {name}: {count}")
    lines.extend(["", "## Anomaly Rates"])
    for name, rate in dict(payload["anomalyRatePerModel"]).items():
        lines.append(f"- {name}: {float(rate):.4f}")
    lines.extend(["", "## Autoencoder"])
    for status in payload["autoencoderStatus"]:
        lines.append(f"- Status: {status.get('status', '')}; epochs={status.get('epochs', '')}; batch_size={status.get('batchSize', '')}; validation_split={status.get('validationSplit', '')}; patience={status.get('patience', '')}; contamination={status.get('contamination', '')}")
        lines.append(f"- Calibration: mode={status.get('calibrationMode', '')}; global_suspect_threshold={status.get('globalSuspectThreshold', '')}; global_failed_threshold={status.get('globalFailedThreshold', '')}")
    lines.append(f"- Final loss: {payload['autoencoderFinalLoss'] or 'not available'}")
    lines.append(f"- Final validation loss: {payload['autoencoderFinalValidationLoss'] or 'not available'}")
    if payload.get("calibrationWarnings"):
        lines.extend(["", "## Calibration Warnings"])
        for warning in payload["calibrationWarnings"]:
            lines.append(f"- {warning}")
    lines.extend(["", "## Random Forest", str(payload["randomForestExplanation"]), "", "## Top 20 Anomaly Examples"])
    for row in payload["topAnomalyExamples"]:
        lines.append(
            f"- {row.get('stationId', '')} {row.get('observationDatetime', '')} {row.get('elementCode', '')} "
            f"value={row.get('value', '')} decision={row.get('finalDecision', row.get('outcome', ''))} score={row.get('anomalyScore', '')}"
        )
    if not payload["topAnomalyExamples"]:
        lines.append("- None")
    return "\n".join(lines) + "\n"


def generate_model_evaluation_report() -> Dict[str, object]:
    payload = build_report_payload()
    write_csv(MODEL_EVALUATION_SUMMARY_CSV, payload_to_summary_rows(payload), SUMMARY_FIELDS)
    MODEL_EVALUATION_SUMMARY_MD.write_text(build_markdown(payload), encoding="utf-8")
    MODEL_EVALUATION_SUMMARY_JSON.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload
