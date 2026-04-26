from __future__ import annotations

import csv
from pathlib import Path

import export_review_workspace


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def build_review_rows() -> list[dict[str, str]]:
    return [
        {
            "station_id": "MAPOTENG",
            "observation_datetime": "2026-04-09 00:00:00",
            "element_code": "TEMP",
            "value": "18.4",
            "source": "AWS",
            "interval": "hourly",
            "qc_status": "pending_qc",
            "ml_status": "passed_baseline_model",
            "review_status": "pending_review",
            "record_id": "MAPOTENG_TEMP_20260409T000000",
            "run_timestamp": "2026-04-12T08:00:00+00:00",
            "model_version": "iforest-ocsvm-v1",
            "engine_version": "aws-anomaly-engine-v1",
            "pipeline_stage": "anomaly_detection",
            "previous_value": "18.2",
            "difference_from_previous": "0.2",
            "delta_from_previous": "0.2",
            "rolling_mean_3": "18.3",
            "rolling_std_3": "0.1",
            "delta_from_rolling_mean": "0.1",
            "hour_of_day": "0",
            "month": "4",
            "isolation_forest_label": "normal",
            "isolation_forest_score": "-0.05",
            "one_class_svm_label": "normal",
            "one_class_svm_score": "-0.02",
            "final_decision": "NORMAL",
            "anomaly_type": "NORMAL_PATTERN",
            "severity": "LOW",
            "explanation_summary": "Temperature is following the expected pattern.",
            "recommended_action": "No action needed; keep in the normal review flow.",
            "anomaly_label": "normal",
            "anomaly_score": "-0.020000",
            "model_name": "IsolationForest+OneClassSVM",
        },
        {
            "station_id": "OXBOW",
            "observation_datetime": "2026-04-09 01:00:00",
            "element_code": "RAIN",
            "value": "30.0",
            "source": "AWS",
            "interval": "hourly",
            "qc_status": "pending_qc",
            "ml_status": "flagged_by_model",
            "review_status": "pending_review",
            "record_id": "OXBOW_RAIN_20260409T010000",
            "run_timestamp": "2026-04-12T08:00:00+00:00",
            "model_version": "iforest-ocsvm-v1",
            "engine_version": "aws-anomaly-engine-v1",
            "pipeline_stage": "anomaly_detection",
            "previous_value": "0.0",
            "difference_from_previous": "30.0",
            "delta_from_previous": "30.0",
            "rolling_mean_3": "5.0",
            "rolling_std_3": "4.0",
            "delta_from_rolling_mean": "25.0",
            "hour_of_day": "1",
            "month": "4",
            "isolation_forest_label": "anomaly",
            "isolation_forest_score": "0.61",
            "one_class_svm_label": "anomaly",
            "one_class_svm_score": "0.48",
            "final_decision": "FAILED",
            "anomaly_type": "MODEL_AGREEMENT_ANOMALY",
            "severity": "HIGH",
            "explanation_summary": "Rainfall looks abnormal to both models.",
            "recommended_action": "Hold for manual review and verify against nearby stations, radar, or storm context.",
            "anomaly_label": "anomaly",
            "anomaly_score": "0.610000",
            "model_name": "IsolationForest+OneClassSVM",
        },
    ]


def test_build_workspace_rows_selects_expected_fields_only() -> None:
    rows = build_review_rows()

    workspace_rows = export_review_workspace.build_workspace_rows(rows)

    assert list(workspace_rows[0].keys()) == export_review_workspace.OUTPUT_FIELDS
    assert workspace_rows[0]["record_id"] == "MAPOTENG_TEMP_20260409T000000"
    assert workspace_rows[0]["final_decision"] == "NORMAL"
    assert workspace_rows[1]["severity"] == "HIGH"
    assert workspace_rows[1]["recommended_action"].startswith("Hold for manual review")


def test_export_review_workspace_writes_workspace_ready_csv(tmp_path: Path) -> None:
    input_file = tmp_path / "outputs" / "aws_review_queue.csv"
    output_file = tmp_path / "outputs" / "aws_review_workspace_input.csv"
    rows = build_review_rows()
    write_csv(input_file, list(rows[0].keys()), rows)

    row_count = export_review_workspace.export_review_workspace(input_file, output_file)
    output_rows = read_csv(output_file)

    assert row_count == 2
    assert len(output_rows) == 2
    assert list(output_rows[0].keys()) == export_review_workspace.OUTPUT_FIELDS
    assert output_rows[0]["model_version"] == "iforest-ocsvm-v1"
    assert output_rows[1]["engine_version"] == "aws-anomaly-engine-v1"
    assert output_rows[1]["anomaly_type"] == "MODEL_AGREEMENT_ANOMALY"
