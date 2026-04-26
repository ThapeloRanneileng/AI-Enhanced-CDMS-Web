from __future__ import annotations

import csv
from pathlib import Path

import pytest

import aws_ingestion


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def valid_source_row(**overrides: object) -> dict[str, object]:
    row: dict[str, object] = {
        "station_id": "Mapoteng",
        "observation_datetime": "2026-04-09 00:00",
        "temperature": "18.4",
        "rainfall": "0.0",
        "humidity": "74",
        "pressure": "1015.2",
        "wind_speed": "3.6",
        "wind_direction": "125",
    }
    row.update(overrides)
    return row


def test_check_required_columns_rejects_missing_field() -> None:
    headers = [column for column in aws_ingestion.REQUIRED_COLUMNS if column != "humidity"]

    with pytest.raises(ValueError, match="Missing required columns: humidity"):
        aws_ingestion.check_required_columns(headers)


def test_standardize_station_id_uppercases_and_trims() -> None:
    assert aws_ingestion.standardize_station_id("  mapoteng  ") == "MAPOTENG"


def test_parse_timestamp_normalizes_supported_formats() -> None:
    assert aws_ingestion.parse_timestamp("2026/04/09 01:30") == "2026-04-09 01:30:00"


def test_parse_numeric_fields_converts_values_to_float() -> None:
    parsed = aws_ingestion.parse_numeric_fields(valid_source_row())

    assert parsed["temperature"] == 18.4
    assert parsed["humidity"] == 74.0
    assert parsed["wind_direction"] == 125.0


@pytest.mark.parametrize(
    ("overrides", "expected_message"),
    [
        ({"station_id": "UNKNOWN"}, "station_id 'UNKNOWN' is not allowed"),
        ({"rainfall": "-0.5"}, "rainfall cannot be negative"),
        ({"humidity": "105"}, "humidity must be between 0 and 100"),
        ({"wind_direction": "361"}, "wind_direction must be between 0 and 360"),
    ],
)
def test_validate_row_rejects_expected_bad_rows(
    overrides: dict[str, object], expected_message: str
) -> None:
    cleaned_row, error_message = aws_ingestion.validate_row(valid_source_row(**overrides))

    assert cleaned_row is None
    assert error_message == expected_message


def test_normalize_records_creates_observations_for_each_element() -> None:
    cleaned_row = {
        "station_id": "MAPOTENG",
        "observation_datetime": "2026-04-09 00:00:00",
        "temperature": 18.4,
        "rainfall": 0.0,
        "humidity": 74.0,
        "pressure": 1015.2,
        "wind_speed": 3.6,
        "wind_direction": 125.0,
    }

    records = aws_ingestion.normalize_records(cleaned_row)

    assert len(records) == 6
    assert records[0]["station_id"] == "MAPOTENG"
    assert {row["element_code"] for row in records} == {"TEMP", "RAIN", "RH", "PRES", "WSPD", "WDIR"}
    assert all(row["source"] == "AWS" for row in records)
    assert all(row["interval"] == "hourly" for row in records)


def test_ingest_aws_data_writes_processed_and_rejected_files(tmp_path: Path) -> None:
    input_file = tmp_path / "raw.csv"
    processed_file = tmp_path / "processed" / "aws_cleaned_output.csv"
    rejected_file = tmp_path / "rejected" / "aws_rejected_rows.csv"

    rows = [
        valid_source_row(),
        valid_source_row(station_id="UNKNOWN"),
        valid_source_row(rainfall="-0.2"),
        valid_source_row(humidity="101"),
        valid_source_row(wind_direction="400"),
    ]
    write_csv(input_file, aws_ingestion.REQUIRED_COLUMNS, rows)

    valid_count, rejected_count = aws_ingestion.ingest_aws_data(
        input_path=input_file,
        processed_output_path=processed_file,
        rejected_output_path=rejected_file,
    )

    processed_rows = read_csv(processed_file)
    rejected_rows = read_csv(rejected_file)

    assert valid_count == 6
    assert rejected_count == 4
    assert len(processed_rows) == 6
    assert len(rejected_rows) == 4
    assert processed_rows[0]["station_id"] == "MAPOTENG"
    assert {row["rejection_reason"] for row in rejected_rows} == {
        "station_id 'UNKNOWN' is not allowed",
        "rainfall cannot be negative",
        "humidity must be between 0 and 100",
        "wind_direction must be between 0 and 360",
    }
