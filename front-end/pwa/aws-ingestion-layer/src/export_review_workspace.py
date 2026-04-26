"""Export AWS review queue rows into a QC Review Workspace-ready CSV."""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Dict, List, Sequence


BASE_DIR = Path(__file__).resolve().parents[1]
INPUT_FILE = BASE_DIR / "outputs" / "aws_review_queue.csv"
OUTPUT_FILE = BASE_DIR / "outputs" / "aws_review_workspace_input.csv"

INPUT_FIELDS = [
    "record_id",
    "station_id",
    "observation_datetime",
    "element_code",
    "value",
    "qc_status",
    "ml_status",
    "final_decision",
    "severity",
    "anomaly_type",
    "explanation_summary",
    "recommended_action",
    "model_version",
    "engine_version",
    "run_timestamp",
]

OUTPUT_FIELDS = list(INPUT_FIELDS)


def load_review_rows(csv_path: Path) -> List[Dict[str, str]]:
    """Load review queue rows and validate required fields."""
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        headers = reader.fieldnames or []
        missing = [field for field in INPUT_FIELDS if field not in headers]
        if missing:
            missing_list = ", ".join(missing)
            raise ValueError(f"Review queue is missing columns: {missing_list}")
        return list(reader)


def build_workspace_rows(rows: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    """Select and reorder review queue fields for the QC Review Workspace."""
    workspace_rows: List[Dict[str, str]] = []
    for row in rows:
        workspace_rows.append({field: row[field] for field in OUTPUT_FIELDS})
    return workspace_rows


def save_workspace_rows(rows: Sequence[Dict[str, str]], output_path: Path) -> None:
    """Save workspace-ready rows to CSV."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def export_review_workspace(
    input_path: Path = INPUT_FILE,
    output_path: Path = OUTPUT_FILE,
) -> int:
    """Export the review queue into a QC Review Workspace-ready input file."""
    review_rows = load_review_rows(input_path)
    workspace_rows = build_workspace_rows(review_rows)
    save_workspace_rows(workspace_rows, output_path)
    return len(workspace_rows)


def main() -> None:
    row_count = export_review_workspace()
    print(f"Read {row_count} review queue rows.")
    print(f"Saved workspace-ready output to: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
