from __future__ import annotations

import csv
from pathlib import Path

import report_summary


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
            "run_timestamp": "2026-04-11T09:00:00+00:00",
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
            "explanation_summary": "Normal temperature pattern.",
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
            "run_timestamp": "2026-04-11T09:00:00+00:00",
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
        {
            "station_id": "OXBOW",
            "observation_datetime": "2026-04-09 02:00:00",
            "element_code": "RH",
            "value": "40.0",
            "source": "AWS",
            "interval": "hourly",
            "qc_status": "pending_qc",
            "ml_status": "flagged_by_model",
            "review_status": "pending_review",
            "record_id": "OXBOW_RH_20260409T020000",
            "run_timestamp": "2026-04-11T09:00:00+00:00",
            "model_version": "iforest-ocsvm-v1",
            "engine_version": "aws-anomaly-engine-v1",
            "pipeline_stage": "anomaly_detection",
            "previous_value": "78.0",
            "difference_from_previous": "-38.0",
            "delta_from_previous": "-38.0",
            "rolling_mean_3": "70.0",
            "rolling_std_3": "10.0",
            "delta_from_rolling_mean": "-30.0",
            "hour_of_day": "2",
            "month": "4",
            "isolation_forest_label": "normal",
            "isolation_forest_score": "-0.01",
            "one_class_svm_label": "anomaly",
            "one_class_svm_score": "0.11",
            "final_decision": "SUSPECT",
            "anomaly_type": "SUDDEN_DROP",
            "severity": "MEDIUM",
            "explanation_summary": "Humidity shows a sudden drop or unusual moisture loss.",
            "recommended_action": "Inspect the humidity sensor and check for abrupt environmental moisture change.",
            "anomaly_label": "anomaly",
            "anomaly_score": "0.110000",
            "model_name": "IsolationForest+OneClassSVM",
        },
    ]


def test_generate_summary_report_writes_text_and_counts_outputs(tmp_path: Path) -> None:
    input_file = tmp_path / "outputs" / "aws_review_queue.csv"
    summary_report_file = tmp_path / "outputs" / "aws_summary_report.txt"
    summary_counts_file = tmp_path / "outputs" / "aws_summary_counts.csv"
    rows = build_review_rows()
    write_csv(input_file, list(rows[0].keys()), rows)

    row_count = report_summary.generate_summary_report(
        input_path=input_file,
        summary_report_path=summary_report_file,
        summary_counts_path=summary_counts_file,
    )

    count_rows = read_csv(summary_counts_file)
    report_text = summary_report_file.read_text(encoding="utf-8")

    assert row_count == 3
    assert summary_report_file.exists()
    assert summary_counts_file.exists()
    assert {"group_name", "group_value", "count"} == set(count_rows[0].keys())
    assert "Total rows: 3" in report_text
    assert "Counts by final_decision:" in report_text
    assert "- FAILED: 1" in report_text
    assert "- SUSPECT: 1" in report_text
    assert "- NORMAL: 1" in report_text
    assert "Top suspicious rows by anomaly_score:" in report_text
    assert "Top FAILED rows by anomaly_score:" in report_text
    assert "OXBOW 2026-04-09 01:00:00 RAIN" in report_text


def test_top_suspicious_rows_are_sorted_by_anomaly_score() -> None:
    rows = build_review_rows()

    top_rows = report_summary.top_suspicious_rows(rows, limit=2)

    assert [row["anomaly_score"] for row in top_rows] == ["0.610000", "0.110000"]


def test_build_count_rows_includes_grouped_counts() -> None:
    rows = build_review_rows()

    count_rows = report_summary.build_count_rows(rows)

    assert {"group_name": "final_decision", "group_value": "FAILED", "count": "1"} in count_rows
    assert {"group_name": "severity", "group_value": "HIGH", "count": "1"} in count_rows
    assert {"group_name": "station_id", "group_value": "OXBOW", "count": "2"} in count_rows
    assert {"group_name": "element_code", "group_value": "RAIN", "count": "1"} in count_rows
