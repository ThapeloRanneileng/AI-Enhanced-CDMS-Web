from __future__ import annotations

from .core import inspect
from .config import INSPECTION_SUMMARY_FILE
from .cli import run_command


def main() -> None:
    summary = inspect()
    print(f"Saved LMS inspection summary to: {INSPECTION_SUMMARY_FILE}")
    for row in summary:
        print(
            f"{row['stationId']}: {row['rawRows']} raw rows, "
            f"{row['normalizedObservationRows']} normalized observations, "
            f"{row['dateFrom']} to {row['dateTo']}"
        )


if __name__ == "__main__":
    run_command(main)
