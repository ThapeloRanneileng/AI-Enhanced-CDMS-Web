from __future__ import annotations

import csv
from pathlib import Path
from typing import Dict, Iterable, List

from .config import INPUT_FILE, OUTPUT_DIR, REJECTED_DIR

REQUIRED_COLUMNS = ["id", "year", "month", "day", "rain", "tmax", "tmin"]


def ensure_output_dirs() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    REJECTED_DIR.mkdir(parents=True, exist_ok=True)


def require_input_file(path: Path = INPUT_FILE) -> None:
    if not path.exists():
        raise FileNotFoundError(
            f"LMS raw CSV not found at {path}. Place "
            "NULClimsofttext.csv in data/lms/observations/."
        )


def normalize_field_name(field_name: str | None, lowercase: bool = False) -> str:
    normalized = str(field_name or "").replace("\ufeff", "").strip()
    return normalized.lower() if lowercase else normalized


def validate_required_columns(fieldnames: List[str]) -> None:
    missing = [column for column in REQUIRED_COLUMNS if column not in fieldnames]
    if missing:
        raise ValueError(
            "LMS CSV is missing required columns. "
            f"Required columns: {', '.join(REQUIRED_COLUMNS)}. "
            f"Actual columns found: {', '.join(fieldnames) if fieldnames else '(none)'}."
        )


def read_csv(path: Path) -> List[Dict[str, str]]:
    require_input_file(path)
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        is_raw_lms_input = path.name == INPUT_FILE.name
        normalized_fieldnames = [normalize_field_name(field, lowercase=is_raw_lms_input) for field in (reader.fieldnames or [])]
        if is_raw_lms_input:
            validate_required_columns(normalized_fieldnames)

        rows: List[Dict[str, str]] = []
        for row in reader:
            normalized_row: Dict[str, str] = {}
            for raw_key, value in row.items():
                key = normalize_field_name(raw_key, lowercase=is_raw_lms_input)
                if key:
                    normalized_row[key] = "" if value is None else str(value).strip()
            rows.append(normalized_row)
        return rows


def write_csv(path: Path, rows: Iterable[Dict[str, object]], fieldnames: List[str]) -> None:
    ensure_output_dirs()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def csv_row_count(path: Path) -> int | None:
    if not path.exists() or path.suffix.lower() != ".csv":
        return None
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        try:
            next(reader)
        except StopIteration:
            return 0
        return sum(1 for _ in reader)


def file_metadata(path: Path) -> Dict[str, object]:
    exists = path.exists()
    return {
        "path": str(path),
        "exists": exists,
        "sizeBytes": path.stat().st_size if exists else 0,
        "rowCount": csv_row_count(path) if exists else None,
    }
