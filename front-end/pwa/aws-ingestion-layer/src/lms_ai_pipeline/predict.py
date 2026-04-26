from __future__ import annotations

from .config import COMBINED_PREDICTIONS_FILE, ENSEMBLE_PREDICTIONS_FILE, QC_HANDOFF_FILE
from .cli import run_command
from .pipeline import predict_anomalies


def main() -> None:
    count = predict_anomalies()
    print(f"Saved combined predictions to: {COMBINED_PREDICTIONS_FILE}")
    print(f"Saved ensemble predictions to: {ENSEMBLE_PREDICTIONS_FILE}")
    print(f"Saved QC handoff to: {QC_HANDOFF_FILE}")
    print(f"Wrote {count} model prediction rows.")


if __name__ == "__main__":
    run_command(main)
