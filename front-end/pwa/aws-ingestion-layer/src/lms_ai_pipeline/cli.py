from __future__ import annotations

import sys
from typing import Callable


def run_command(command: Callable[[], None]) -> None:
    try:
        command()
    except (FileNotFoundError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1) from error
