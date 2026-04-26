"""Prepare AWS cleaned observations for QC and ML review."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Dict, List


BASE_DIR = Path(__file__).resolve().parents[1]
CLEANED_FILE = BASE_DIR / "data" / "processed" / "aws_cleaned_output.csv"
QC_OUTPUT_FILE = BASE_DIR / "outputs" / "aws_qc_input.csv"

INPUT_FIELDS = [
    "station_id",
    "observation_datetime",
    "element_code",
    "value",
    "source",
    "interval",
]

OUTPUT_FIELDS = INPUT_FIELDS + ["qc_status", "ml_status", "review_status"]


def load_cleaned_rows(csv_path: Path) -> List[Dict[str, str]]:
    """Load cleaned observation records from CSV."""
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        headers = reader.fieldnames or []
        missing = [field for field in INPUT_FIELDS if field not in headers]
        if missing:
            missing_list = ", ".join(missing)
            raise ValueError(f"Cleaned input is missing columns: {missing_list}")
        return list(reader)


def build_qc_rows(cleaned_rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Append default workflow statuses for QC and anomaly detection."""
    qc_rows: List[Dict[str, str]] = []
    for row in cleaned_rows:
        qc_rows.append(
            {
                **row,
                "qc_status": "pending_qc",
                "ml_status": "pending_ml_check",
                "review_status": "pending_review",
            }
        )
    return qc_rows


def save_qc_rows(rows: List[Dict[str, str]], output_path: Path) -> None:
    """Save QC handoff rows to CSV."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def prepare_qc_handoff(input_path: Path = CLEANED_FILE, output_path: Path = QC_OUTPUT_FILE) -> int:
    """Run the QC handoff step and return the number of rows written."""
    cleaned_rows = load_cleaned_rows(input_path)
    qc_rows = build_qc_rows(cleaned_rows)
    save_qc_rows(qc_rows, output_path)
    return len(qc_rows)


def main() -> None:
    row_count = prepare_qc_handoff()
    print(f"Created {row_count} QC-ready rows.")
    print(f"QC handoff output: {QC_OUTPUT_FILE}")


if __name__ == "__main__":
    main()
