from __future__ import annotations

from .config import NORMALIZED_FILE
from .core import prepare
from .cli import run_command


def main() -> None:
    count = prepare()
    print(f"Saved normalized LMS training input to: {NORMALIZED_FILE}")
    print(f"Wrote {count} normalized observation rows.")


if __name__ == "__main__":
    run_command(main)
