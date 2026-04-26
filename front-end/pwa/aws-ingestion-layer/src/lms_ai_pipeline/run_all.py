from __future__ import annotations

from .config import QC_HANDOFF_FILE
from .cli import run_command
from .pipeline import run_all


def main() -> None:
    count = run_all()
    print(f"LMS AI pipeline complete. Prediction rows: {count}")
    print(f"QC review handoff: {QC_HANDOFF_FILE}")


if __name__ == "__main__":
    run_command(main)
