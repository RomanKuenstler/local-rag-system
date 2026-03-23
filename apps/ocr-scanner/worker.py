#!/usr/bin/env python3
"""Example OCR scanner worker entrypoint.

This is intentionally small for step one. It demonstrates:
1) polling-style worker lifecycle
2) file type detection for OCR-eligible inputs
3) structured log output other services can integrate with later
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path


SUPPORTED_EXTENSIONS = {
    ".pdf",
    ".png",
    ".jpg",
    ".jpeg",
    ".tif",
    ".tiff",
    ".bmp",
    ".webp",
}


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_event(event: str, **fields: object) -> None:
    payload = {"timestamp": utc_timestamp(), "event": event, **fields}
    print(json.dumps(payload, ensure_ascii=False))


def can_attempt_ocr(path: Path) -> bool:
    return path.suffix.lower() in SUPPORTED_EXTENSIONS


def run_example_scan_cycle(input_dir: Path) -> None:
    if not input_dir.exists():
        log_event("ocr.input_dir_missing", input_dir=str(input_dir))
        return

    candidates = sorted(
        path for path in input_dir.iterdir() if path.is_file() and can_attempt_ocr(path)
    )
    log_event(
        "ocr.scan_cycle_finished",
        input_dir=str(input_dir),
        discovered=len(candidates),
        candidates=[path.name for path in candidates[:10]],
    )


def main() -> None:
    poll_seconds = int(os.getenv("OCR_POLL_INTERVAL_SECONDS", "10"))
    input_dir = Path(os.getenv("OCR_INPUT_DIR", "/app/data"))
    log_event(
        "ocr.worker_started",
        poll_interval_seconds=poll_seconds,
        input_dir=str(input_dir),
        supported_extensions=sorted(SUPPORTED_EXTENSIONS),
    )

    while True:
        run_example_scan_cycle(input_dir)
        time.sleep(poll_seconds)


if __name__ == "__main__":
    main()
