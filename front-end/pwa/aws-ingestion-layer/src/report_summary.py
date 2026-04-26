"""Generate a simple engineering summary from the AWS review queue."""

from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path
from typing import Dict, Iterable, List, Sequence


BASE_DIR = Path(__file__).resolve().parents[1]
INPUT_FILE = BASE_DIR / "outputs" / "aws_review_queue.csv"
SUMMARY_REPORT_FILE = BASE_DIR / "outputs" / "aws_summary_report.txt"
SUMMARY_COUNTS_FILE = BASE_DIR / "outputs" / "aws_summary_counts.csv"

COUNT_GROUP_FIELDS = [
    "final_decision",
    "severity",
    "anomaly_type",
    "station_id",
    "element_code",
]

TOP_ROW_FIELDS = [
    "station_id",
    "observation_datetime",
    "element_code",
    "value",
    "final_decision",
    "severity",
    "anomaly_type",
    "anomaly_score",
]


def load_review_rows(csv_path: Path) -> List[Dict[str, str]]:
    """Load review rows and validate the minimum required columns."""
    with csv_path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        headers = reader.fieldnames or []
        required_fields = [
            "station_id",
            "observation_datetime",
            "element_code",
            "final_decision",
            "severity",
            "anomaly_type",
            "anomaly_score",
        ]
        missing = [field for field in required_fields if field not in headers]
        if missing:
            missing_list = ", ".join(missing)
            raise ValueError(f"Review queue is missing columns: {missing_list}")
        return list(reader)


def build_count_rows(rows: Sequence[Dict[str, str]]) -> List[Dict[str, str]]:
    """Build grouped count rows for CSV export."""
    count_rows: List[Dict[str, str]] = []
    for field_name in COUNT_GROUP_FIELDS:
        counts = Counter(row[field_name] for row in rows)
        for value, count in sorted(counts.items()):
            count_rows.append(
                {
                    "group_name": field_name,
                    "group_value": value,
                    "count": str(count),
                }
            )
    return count_rows


def sort_by_anomaly_score(rows: Iterable[Dict[str, str]]) -> List[Dict[str, str]]:
    """Sort rows by anomaly score descending."""
    return sorted(rows, key=lambda row: float(row["anomaly_score"]), reverse=True)


def top_suspicious_rows(rows: Sequence[Dict[str, str]], limit: int = 10) -> List[Dict[str, str]]:
    """Return the top suspicious rows by anomaly score."""
    non_normal_rows = [row for row in rows if row["final_decision"] != "NORMAL"]
    return sort_by_anomaly_score(non_normal_rows)[:limit]


def top_failed_rows(rows: Sequence[Dict[str, str]], limit: int = 10) -> List[Dict[str, str]]:
    """Return the top failed rows by anomaly score."""
    failed_rows = [row for row in rows if row["final_decision"] == "FAILED"]
    return sort_by_anomaly_score(failed_rows)[:limit]


def format_top_row(row: Dict[str, str]) -> str:
    """Format one top row for the summary text report."""
    return (
        f"- {row['station_id']} {row['observation_datetime']} {row['element_code']} "
        f"value={row['value']} decision={row['final_decision']} severity={row['severity']} "
        f"type={row['anomaly_type']} score={float(row['anomaly_score']):.6f}"
    )


def build_summary_report(rows: Sequence[Dict[str, str]]) -> str:
    """Build a readable plain-text engineering summary."""
    total_rows = len(rows)
    counts_by_field = {
        field_name: Counter(row[field_name] for row in rows) for field_name in COUNT_GROUP_FIELDS
    }
    suspicious_rows = top_suspicious_rows(rows)
    failed_rows = top_failed_rows(rows)

    lines = [
        "AWS Anomaly Engine Summary",
        "==========================",
        f"Total rows: {total_rows}",
        "",
        "Counts by final_decision:",
    ]
    lines.extend(
        f"- {value}: {count}" for value, count in sorted(counts_by_field["final_decision"].items())
    )
    lines.extend(["", "Counts by severity:"])
    lines.extend(
        f"- {value}: {count}" for value, count in sorted(counts_by_field["severity"].items())
    )
    lines.extend(["", "Counts by anomaly_type:"])
    lines.extend(
        f"- {value}: {count}" for value, count in sorted(counts_by_field["anomaly_type"].items())
    )
    lines.extend(["", "Counts by station_id:"])
    lines.extend(
        f"- {value}: {count}" for value, count in sorted(counts_by_field["station_id"].items())
    )
    lines.extend(["", "Counts by element_code:"])
    lines.extend(
        f"- {value}: {count}" for value, count in sorted(counts_by_field["element_code"].items())
    )
    lines.extend(["", "Top suspicious rows by anomaly_score:"])
    if suspicious_rows:
        lines.extend(format_top_row(row) for row in suspicious_rows)
    else:
        lines.append("- None")

    if failed_rows:
        lines.extend(["", "Top FAILED rows by anomaly_score:"])
        lines.extend(format_top_row(row) for row in failed_rows)

    return "\n".join(lines) + "\n"


def save_counts_csv(rows: Sequence[Dict[str, str]], output_path: Path) -> None:
    """Save grouped counts as a CSV."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["group_name", "group_value", "count"])
        writer.writeheader()
        writer.writerows(rows)


def save_summary_report(report_text: str, output_path: Path) -> None:
    """Save the plain-text summary report."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(report_text, encoding="utf-8")


def generate_summary_report(
    input_path: Path = INPUT_FILE,
    summary_report_path: Path = SUMMARY_REPORT_FILE,
    summary_counts_path: Path = SUMMARY_COUNTS_FILE,
) -> int:
    """Generate text and CSV summary outputs from the review queue."""
    rows = load_review_rows(input_path)
    count_rows = build_count_rows(rows)
    report_text = build_summary_report(rows)
    save_counts_csv(count_rows, summary_counts_path)
    save_summary_report(report_text, summary_report_path)
    return len(rows)


def main() -> None:
    row_count = generate_summary_report()
    print(f"Read {row_count} review rows.")
    print(f"Saved summary report to: {SUMMARY_REPORT_FILE}")
    print(f"Saved summary counts to: {SUMMARY_COUNTS_FILE}")


if __name__ == "__main__":
    main()
