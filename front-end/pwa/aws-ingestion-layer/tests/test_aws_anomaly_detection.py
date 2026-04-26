from __future__ import annotations

import csv
from pathlib import Path
from datetime import datetime

import aws_anomaly_detection


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def build_qc_rows() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    measurements = [
        ("MAPOTENG", "TEMP", ["18.0", "18.2", "18.1"]),
        ("MAPOTENG", "RH", ["72.0", "73.0", "71.5"]),
        ("OXBOW", "TEMP", ["9.0", "9.2", "25.0"]),
        ("OXBOW", "RH", ["88.0", "89.0", "87.5"]),
    ]

    for station_id, element_code, values in measurements:
        for hour, value in enumerate(values):
            rows.append(
                {
                    "station_id": station_id,
                    "observation_datetime": f"2026-04-09 0{hour}:00:00",
                    "element_code": element_code,
                    "value": value,
                    "source": "AWS",
                    "interval": "hourly",
                    "qc_status": "pending_qc",
                    "ml_status": "pending_ml_check",
                    "review_status": "pending_review",
                }
            )
    return rows


def test_prepare_features_returns_one_row_per_qc_record() -> None:
    rows = build_qc_rows()

    features = aws_anomaly_detection.prepare_features(rows)

    assert features.shape[0] == len(rows)
    assert features.shape[1] == 7 + 2 + 2


def test_add_temporal_features_includes_previous_and_rolling_values() -> None:
    rows = build_qc_rows()

    enriched_rows = aws_anomaly_detection.add_temporal_features(rows)
    first_temp_row = enriched_rows[0]
    second_temp_row = enriched_rows[1]

    assert first_temp_row["previous_value"] == "18.000000"
    assert first_temp_row["difference_from_previous"] == "0.000000"
    assert second_temp_row["previous_value"] == "18.000000"
    assert second_temp_row["difference_from_previous"] == "0.200000"
    assert second_temp_row["rolling_mean_3"] == "18.100000"
    assert second_temp_row["hour_of_day"] == "1"
    assert second_temp_row["month"] == "4"


def test_detect_anomalies_creates_output_file_with_expected_fields(tmp_path: Path) -> None:
    qc_input = tmp_path / "outputs" / "aws_qc_input.csv"
    anomaly_output = tmp_path / "outputs" / "aws_anomaly_output.csv"
    rows = build_qc_rows()
    write_csv(qc_input, aws_anomaly_detection.REQUIRED_FIELDS, rows)

    row_count = aws_anomaly_detection.detect_anomalies(qc_input, anomaly_output)
    output_rows = read_csv(anomaly_output)

    assert row_count == len(rows)
    assert len(output_rows) == len(rows)
    assert list(output_rows[0].keys()) == aws_anomaly_detection.OUTPUT_FIELDS
    assert {row["model_name"] for row in output_rows} == {"IsolationForest+OneClassSVM"}
    assert {row["anomaly_label"] for row in output_rows}.issubset({"normal", "anomaly"})
    assert {row["final_decision"] for row in output_rows}.issubset({"NORMAL", "SUSPECT", "FAILED"})
    assert all(row["anomaly_type"] != "" for row in output_rows)
    assert {row["severity"] for row in output_rows}.issubset({"LOW", "MEDIUM", "HIGH"})
    assert all(row["anomaly_score"] != "" for row in output_rows)
    assert all(row["isolation_forest_score"] != "" for row in output_rows)
    assert all(row["one_class_svm_score"] != "" for row in output_rows)
    assert {row["isolation_forest_label"] for row in output_rows}.issubset({"normal", "anomaly"})
    assert {row["one_class_svm_label"] for row in output_rows}.issubset({"normal", "anomaly"})
    assert all(row["delta_from_previous"] != "" for row in output_rows)
    assert all(row["delta_from_rolling_mean"] != "" for row in output_rows)
    assert all(row["explanation_summary"] != "" for row in output_rows)
    assert all(row["recommended_action"] != "" for row in output_rows)
    assert all(row["record_id"] != "" for row in output_rows)
    assert len({row["record_id"] for row in output_rows}) == len(output_rows)
    assert {row["model_version"] for row in output_rows} == {aws_anomaly_detection.MODEL_VERSION}
    assert {row["engine_version"] for row in output_rows} == {aws_anomaly_detection.ENGINE_VERSION}
    assert {row["pipeline_stage"] for row in output_rows} == {aws_anomaly_detection.PIPELINE_STAGE}
    assert len({row["run_timestamp"] for row in output_rows}) == 1
    datetime.fromisoformat(output_rows[0]["run_timestamp"])
    assert any(row["ml_status"] == "flagged_by_model" for row in output_rows)
    assert all(
        row["anomaly_type"] == "NORMAL_PATTERN"
        for row in output_rows
        if row["final_decision"] == "NORMAL"
    )


def test_build_record_id_returns_stable_traceable_identifier() -> None:
    row = {
        "station_id": "MAPOTENG",
        "observation_datetime": "2026-04-09 01:00:00",
        "element_code": "TEMP",
    }

    record_id = aws_anomaly_detection.build_record_id(row)

    assert record_id == "MAPOTENG_TEMP_20260409T010000"
