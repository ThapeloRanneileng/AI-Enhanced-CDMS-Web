"""Simple AWS ingestion prototype.

This script reads machine-generated AWS data from a CSV file, validates the
rows, separates rejected records, and reshapes valid rows into normalized
observation records that are ready for QC and ML processing.
"""

from __future__ import annotations

import csv
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Tuple


BASE_DIR = Path(__file__).resolve().parents[1]
RAW_FILE = BASE_DIR / "data" / "raw" / "aws_sample_observations.csv"
PROCESSED_FILE = BASE_DIR / "data" / "processed" / "aws_cleaned_output.csv"
REJECTED_FILE = BASE_DIR / "data" / "rejected" / "aws_rejected_rows.csv"

REQUIRED_COLUMNS = [
    "station_id",
    "observation_datetime",
    "temperature",
    "rainfall",
    "humidity",
    "pressure",
    "wind_speed",
    "wind_direction",
]

ALLOWED_STATIONS = {"MAPOTENG", "OXBOW", "LERIBE", "MASERU", "QUTHING"}

ELEMENT_MAPPING = {
    "temperature": "TEMP",
    "rainfall": "RAIN",
    "humidity": "RH",
    "pressure": "PRES",
    "wind_speed": "WSPD",
    "wind_direction": "WDIR",
}

NUMERIC_FIELDS = list(ELEMENT_MAPPING.keys())


def load_rows(csv_path: Path) -> Tuple[List[Dict[str, str]], List[str]]:
    """Load rows from a CSV file and return both rows and headers."""
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        headers = reader.fieldnames or []
        rows = list(reader)
    return rows, headers


def check_required_columns(headers: Iterable[str]) -> None:
    """Stop early if the input file is missing any required columns."""
    missing = [column for column in REQUIRED_COLUMNS if column not in headers]
    if missing:
        missing_list = ", ".join(missing)
        raise ValueError(f"Missing required columns: {missing_list}")


def standardize_station_id(station_id: str) -> str:
    """Normalize station identifiers to uppercase without extra spaces."""
    return station_id.strip().upper()


def parse_timestamp(raw_timestamp: str) -> str:
    """Parse an input timestamp and return a normalized ISO-like string."""
    cleaned = raw_timestamp.strip()
    supported_formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y/%m/%d %H:%M:%S",
        "%Y/%m/%d %H:%M",
    ]

    for fmt in supported_formats:
        try:
            parsed = datetime.strptime(cleaned, fmt)
            return parsed.strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue

    raise ValueError("invalid observation_datetime format")


def parse_numeric_fields(row: Dict[str, str]) -> Dict[str, float]:
    """Convert numeric fields from text to floats."""
    numeric_values: Dict[str, float] = {}
    for field in NUMERIC_FIELDS:
        raw_value = row.get(field, "").strip()
        if raw_value == "":
            raise ValueError(f"{field} is empty")
        try:
            numeric_values[field] = float(raw_value)
        except ValueError as exc:
            raise ValueError(f"{field} is not numeric") from exc
    return numeric_values


def validate_row(row: Dict[str, str]) -> Tuple[Dict[str, object] | None, str | None]:
    """Validate and clean one source row."""
    try:
        station_id = standardize_station_id(row.get("station_id", ""))
        if not station_id:
            raise ValueError("station_id is empty")
        if station_id not in ALLOWED_STATIONS:
            raise ValueError(f"station_id '{station_id}' is not allowed")

        observation_datetime = parse_timestamp(row.get("observation_datetime", ""))
        numeric_values = parse_numeric_fields(row)

        if not 0 <= numeric_values["humidity"] <= 100:
            raise ValueError("humidity must be between 0 and 100")
        if numeric_values["rainfall"] < 0:
            raise ValueError("rainfall cannot be negative")
        if not 0 <= numeric_values["wind_direction"] <= 360:
            raise ValueError("wind_direction must be between 0 and 360")

        cleaned_row: Dict[str, object] = {
            "station_id": station_id,
            "observation_datetime": observation_datetime,
            **numeric_values,
        }
        return cleaned_row, None
    except ValueError as exc:
        return None, str(exc)


def normalize_records(cleaned_row: Dict[str, object]) -> List[Dict[str, object]]:
    """Convert one cleaned AWS row into multiple normalized observations."""
    normalized = []
    for field_name, element_code in ELEMENT_MAPPING.items():
        normalized.append(
            {
                "station_id": cleaned_row["station_id"],
                "observation_datetime": cleaned_row["observation_datetime"],
                "element_code": element_code,
                "value": cleaned_row[field_name],
                "source": "AWS",
                "interval": "hourly",
            }
        )
    return normalized


def save_csv(rows: List[Dict[str, object]], output_path: Path, fieldnames: List[str]) -> None:
    """Write rows to CSV, always including a header."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def ingest_aws_data(
    input_path: Path = RAW_FILE,
    processed_output_path: Path = PROCESSED_FILE,
    rejected_output_path: Path = REJECTED_FILE,
) -> Tuple[int, int]:
    """Run the full ingestion flow and return valid/rejected counts."""
    source_rows, headers = load_rows(input_path)
    check_required_columns(headers)

    normalized_rows: List[Dict[str, object]] = []
    rejected_rows: List[Dict[str, object]] = []

    for row in source_rows:
        cleaned_row, error_message = validate_row(row)
        if cleaned_row is None:
            rejected_rows.append({**row, "rejection_reason": error_message})
            continue
        normalized_rows.extend(normalize_records(cleaned_row))

    save_csv(
        normalized_rows,
        processed_output_path,
        ["station_id", "observation_datetime", "element_code", "value", "source", "interval"],
    )
    save_csv(rejected_rows, rejected_output_path, REQUIRED_COLUMNS + ["rejection_reason"])

    return len(normalized_rows), len(rejected_rows)


def main() -> None:
    valid_count, rejected_count = ingest_aws_data()
    print(f"Created {valid_count} normalized observation records.")
    print(f"Rejected {rejected_count} source rows.")
    print(f"Cleaned output: {PROCESSED_FILE}")
    print(f"Rejected rows: {REJECTED_FILE}")


if __name__ == "__main__":
    main()
