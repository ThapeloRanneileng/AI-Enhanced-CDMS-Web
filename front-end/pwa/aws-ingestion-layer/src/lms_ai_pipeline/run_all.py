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
    parser.add_argument(
        "--autoencoder-calibration",
        choices=["global_quantile", "station_element_quantile", "element_quantile"],
        default="station_element_quantile",
    )
    parser.add_argument("--autoencoder-suspect-quantile", type=float, default=0.99)
    parser.add_argument("--autoencoder-failed-quantile", type=float, default=0.999)
    parser.add_argument("--autoencoder-min-group-rows", type=int, default=500)
    parser.add_argument("--autoencoder-min-element-rows", type=int, default=2000)
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
        calibration=args.autoencoder_calibration,
        suspect_quantile=args.autoencoder_suspect_quantile,
        failed_quantile=args.autoencoder_failed_quantile,
        min_group_rows=args.autoencoder_min_group_rows,
        min_element_rows=args.autoencoder_min_element_rows,
    )
    count = run_all(config)
    print(f"LMS AI pipeline complete. Prediction rows: {count}")
    print(f"QC review handoff: {QC_HANDOFF_FILE}")


if __name__ == "__main__":
    run_command(main)
