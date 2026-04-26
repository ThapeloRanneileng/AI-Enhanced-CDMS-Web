from __future__ import annotations

import csv
from pathlib import Path

import aws_qc_handoff


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def test_prepare_qc_handoff_writes_expected_columns_and_statuses(tmp_path: Path) -> None:
    cleaned_input = tmp_path / "data" / "processed" / "aws_cleaned_output.csv"
    qc_output = tmp_path / "outputs" / "aws_qc_input.csv"

    cleaned_rows = [
        {
            "station_id": "MAPOTENG",
            "observation_datetime": "2026-04-09 00:00:00",
            "element_code": "TEMP",
            "value": "18.4",
            "source": "AWS",
            "interval": "hourly",
        }
    ]
    write_csv(cleaned_input, aws_qc_handoff.INPUT_FIELDS, cleaned_rows)

    row_count = aws_qc_handoff.prepare_qc_handoff(cleaned_input, qc_output)
    qc_rows = read_csv(qc_output)

    assert row_count == 1
    assert list(qc_rows[0].keys()) == aws_qc_handoff.OUTPUT_FIELDS
    assert qc_rows[0]["qc_status"] == "pending_qc"
    assert qc_rows[0]["ml_status"] == "pending_ml_check"
    assert qc_rows[0]["review_status"] == "pending_review"
