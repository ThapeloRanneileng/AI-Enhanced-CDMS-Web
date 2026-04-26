"""AWS anomaly detection entry point backed by modular engine components."""

from __future__ import annotations

import csv
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Sequence

import numpy as np

try:
    from .decision import decide_final_status, normalize_model_label
    from .explain import build_explanation
    from .features import engineer_temporal_features, prepare_feature_matrix
    from .models import run_isolation_forest, run_one_class_svm
except ImportError:
    from decision import decide_final_status, normalize_model_label
    from explain import build_explanation
    from features import engineer_temporal_features, prepare_feature_matrix
    from models import run_isolation_forest, run_one_class_svm


BASE_DIR = Path(__file__).resolve().parents[1]
INPUT_FILE = BASE_DIR / "outputs" / "aws_qc_input.csv"
OUTPUT_FILE = BASE_DIR / "outputs" / "aws_anomaly_output.csv"
MODEL_VERSION = "iforest-ocsvm-v1"
ENGINE_VERSION = "aws-anomaly-engine-v1"
PIPELINE_STAGE = "anomaly_detection"

REQUIRED_FIELDS = [
    "station_id",
    "observation_datetime",
    "element_code",
    "value",
    "source",
    "interval",
    "qc_status",
    "ml_status",
    "review_status",
]

OUTPUT_FIELDS = REQUIRED_FIELDS + [
    "record_id",
    "run_timestamp",
    "model_version",
    "engine_version",
    "pipeline_stage",
    "previous_value",
    "difference_from_previous",
    "delta_from_previous",
    "rolling_mean_3",
    "rolling_std_3",
    "delta_from_rolling_mean",
    "hour_of_day",
    "month",
    "isolation_forest_label",
    "isolation_forest_score",
    "one_class_svm_label",
    "one_class_svm_score",
    "final_decision",
    "anomaly_type",
    "severity",
    "explanation_summary",
    "recommended_action",
    "anomaly_label",
    "anomaly_score",
    "model_name",
]


def build_record_id(row: Dict[str, str]) -> str:
    """Create a stable per-row identifier for audit and traceability."""
    normalized_timestamp = row["observation_datetime"].replace(" ", "T").replace(":", "").replace("-", "")
    return f"{row['station_id']}_{row['element_code']}_{normalized_timestamp}"


def build_run_timestamp() -> str:
    """Create one run-level timestamp for the full anomaly output batch."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_qc_rows(csv_path: Path) -> List[Dict[str, str]]:
    """Load QC-ready rows and verify the required columns exist."""
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        headers = reader.fieldnames or []
        missing = [field for field in REQUIRED_FIELDS if field not in headers]
        if missing:
            missing_list = ", ".join(missing)
            raise ValueError(f"QC input is missing columns: {missing_list}")
        return list(reader)


def add_temporal_features(rows: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    """Backward-compatible wrapper around the new feature module."""
    return engineer_temporal_features(rows)


def prepare_features(rows: Sequence[Dict[str, str]]) -> np.ndarray:
    """Backward-compatible wrapper around the new feature module."""
    return prepare_feature_matrix(rows)


def choose_contamination(rows: Sequence[Dict[str, str]]) -> float:
    """Pick a simple contamination rate for a small student demo."""
    row_count = len(rows)
    if row_count < 20:
        return 0.1
    if row_count < 100:
        return 0.15
    return 0.1


def build_output_rows(
    rows: Sequence[Dict[str, str]],
    enriched_rows: Sequence[Dict[str, str]],
    isolation_predictions: np.ndarray,
    isolation_scores: np.ndarray,
    svm_predictions: np.ndarray,
    svm_scores: np.ndarray,
    run_timestamp: str,
) -> List[Dict[str, str]]:
    """Attach anomaly results to each QC-ready observation row."""
    output_rows: List[Dict[str, str]] = []

    for row, enriched_row, if_prediction, if_score, svm_prediction, svm_score in zip(
        rows,
        enriched_rows,
        isolation_predictions,
        isolation_scores,
        svm_predictions,
        svm_scores,
    ):
        isolation_label = normalize_model_label(int(if_prediction))
        svm_label = normalize_model_label(int(svm_prediction))
        decision = decide_final_status(
            element_code=row["element_code"],
            isolation_forest_label=isolation_label,
            one_class_svm_label=svm_label,
            isolation_forest_score=float(if_score),
            one_class_svm_score=float(svm_score),
        )
        explanation = build_explanation(
            element_code=row["element_code"],
            current_value=row["value"],
            previous_value=enriched_row["previous_value"],
            rolling_mean_3=enriched_row["rolling_mean_3"],
            rolling_std_3=enriched_row["rolling_std_3"],
            isolation_forest_label=isolation_label,
            isolation_forest_score=float(if_score),
            one_class_svm_label=svm_label,
            one_class_svm_score=float(svm_score),
            final_decision=decision["final_decision"],
        )

        output_rows.append(
            {
                **row,
                "record_id": build_record_id(row),
                "run_timestamp": run_timestamp,
                "model_version": MODEL_VERSION,
                "engine_version": ENGINE_VERSION,
                "pipeline_stage": PIPELINE_STAGE,
                "previous_value": enriched_row["previous_value"],
                "difference_from_previous": enriched_row["difference_from_previous"],
                "delta_from_previous": explanation["delta_from_previous"],
                "rolling_mean_3": enriched_row["rolling_mean_3"],
                "rolling_std_3": enriched_row["rolling_std_3"],
                "delta_from_rolling_mean": explanation["delta_from_rolling_mean"],
                "hour_of_day": enriched_row["hour_of_day"],
                "month": enriched_row["month"],
                "ml_status": decision["ml_status"],
                "isolation_forest_label": isolation_label,
                "isolation_forest_score": f"{float(if_score):.6f}",
                "one_class_svm_label": svm_label,
                "one_class_svm_score": f"{float(svm_score):.6f}",
                "final_decision": decision["final_decision"],
                "anomaly_type": explanation["anomaly_type"],
                "severity": explanation["severity"],
                "explanation_summary": explanation["explanation_summary"],
                "recommended_action": explanation["recommended_action"],
                "anomaly_label": decision["anomaly_label"],
                "anomaly_score": decision["anomaly_score"],
                "model_name": decision["model_name"],
            }
        )

    return output_rows


def save_output(rows: Sequence[Dict[str, str]], output_path: Path) -> None:
    """Save anomaly detection results to CSV."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def summarize_results(rows: Sequence[Dict[str, str]]) -> str:
    """Create a short console summary for quick verification."""
    counts = Counter(row["final_decision"] for row in rows)
    return (
        f"NORMAL={counts.get('NORMAL', 0)}, "
        f"SUSPECT={counts.get('SUSPECT', 0)}, "
        f"FAILED={counts.get('FAILED', 0)}"
    )


def detect_anomalies(input_path: Path = INPUT_FILE, output_path: Path = OUTPUT_FILE) -> int:
    """Run the baseline anomaly workflow and return the number of rows written."""
    qc_rows = load_qc_rows(input_path)
    enriched_rows = add_temporal_features(qc_rows)
    features = prepare_features(qc_rows)
    contamination = choose_contamination(qc_rows)
    run_timestamp = build_run_timestamp()
    if_predictions, if_scores = run_isolation_forest(features, contamination)
    svm_predictions, svm_scores = run_one_class_svm(features, contamination)
    output_rows = build_output_rows(
        qc_rows,
        enriched_rows,
        if_predictions,
        if_scores,
        svm_predictions,
        svm_scores,
        run_timestamp,
    )
    save_output(output_rows, output_path)

    return len(output_rows)


def main() -> None:
    row_count = detect_anomalies()
    qc_rows = load_qc_rows(INPUT_FILE)
    output_rows = load_qc_rows(OUTPUT_FILE)

    print(f"Loaded {len(qc_rows)} QC-ready observations.")
    print(f"Used contamination={choose_contamination(qc_rows):.2f} for the baseline model.")
    print(f"Saved anomaly results to: {OUTPUT_FILE}")
    print(f"Wrote {row_count} rows.")
    print(f"Summary: {summarize_results(output_rows)}")


if __name__ == "__main__":
    main()
