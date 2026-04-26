from __future__ import annotations

from .config import MODEL_METADATA_FILE, TRAIN_SPLIT_FILE, TEST_SPLIT_FILE
from .cli import run_command
from .pipeline import train_models


def main() -> None:
    count = train_models()
    print(f"Saved train split to: {TRAIN_SPLIT_FILE}")
    print(f"Saved test split to: {TEST_SPLIT_FILE}")
    print(f"Saved model status to: {MODEL_METADATA_FILE}")
    print(f"Prepared {count} training rows.")


if __name__ == "__main__":
    run_command(main)
