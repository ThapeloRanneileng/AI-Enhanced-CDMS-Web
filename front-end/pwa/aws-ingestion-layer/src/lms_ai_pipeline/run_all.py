from __future__ import annotations

import argparse

from .config import QC_HANDOFF_FILE
from .cli import run_command
from .models import AutoencoderConfig
from .pipeline import run_all


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the LMS AI pipeline.")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--validation-split", type=float, default=0.2)
    parser.add_argument("--patience", type=int, default=5)
    parser.add_argument("--contamination", type=float, default=0.05)
    parser.add_argument("--max-training-rows", type=int, default=50000)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = AutoencoderConfig(
        epochs=args.epochs,
        batch_size=args.batch_size,
        validation_split=args.validation_split,
        patience=args.patience,
        contamination=args.contamination,
        max_training_rows=args.max_training_rows,
    )
    count = run_all(config)
    print(f"LMS AI pipeline complete. Prediction rows: {count}")
    print(f"QC review handoff: {QC_HANDOFF_FILE}")


if __name__ == "__main__":
    run_command(main)
