#!/usr/bin/env python3
"""Audio transcription microservice for chat and embedding audio jobs."""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile

from flask import Flask, jsonify, request

SUPPORTED_AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a"}
REQUEST_TYPES = {"chat_input", "audio_embedding"}

app = Flask(__name__)


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_event(event: str, **fields: object) -> None:
    payload = {"timestamp": utc_timestamp(), "event": event, **fields}
    print(json.dumps(payload, ensure_ascii=False))


def safe_join(base_dir: Path, relative_path: str) -> Path:
    candidate = (base_dir / relative_path).resolve()
    if base_dir == candidate or base_dir in candidate.parents:
        return candidate
    raise ValueError("Relative path escapes allowed base directory")


def is_allowed_audio(path: Path) -> bool:
    return path.suffix.lower() in SUPPORTED_AUDIO_EXTENSIONS


def resolve_audio_path_for_request(payload: dict[str, object]) -> tuple[Path, str, bool]:
    request_type = str(payload.get("request_type") or "").strip()
    if request_type not in REQUEST_TYPES:
        raise ValueError("request_type must be one of: chat_input, audio_embedding")

    content_dir = Path(os.getenv("AUDIO_CONTENT_DIR", "/app/data")).resolve()
    upload_dir = Path(os.getenv("AUDIO_UPLOAD_DIR", "/app/upload")).resolve()

    if request_type == "audio_embedding":
        relative_path = str(payload.get("audio_relative_path") or "").strip()
        if not relative_path:
            raise ValueError("audio_embedding requires audio_relative_path")
        return safe_join(content_dir, relative_path), request_type, False

    chat_relative_path = str(payload.get("chat_audio_relative_path") or "").strip()
    audio_base64 = str(payload.get("audio_base64") or "").strip()

    has_relative_path = bool(chat_relative_path)
    has_base64 = bool(audio_base64)
    if has_relative_path == has_base64:
        raise ValueError("chat_input requires exactly one of chat_audio_relative_path or audio_base64")

    if has_relative_path:
        return safe_join(upload_dir, chat_relative_path), request_type, False

    with NamedTemporaryFile(delete=False, suffix=".wav") as tmp:
        tmp.write(base64.b64decode(audio_base64))
        return Path(tmp.name), request_type, True


def transcribe_audio(_audio_path: Path) -> dict[str, object]:
    # Placeholder implementation: model wiring will be added in follow-up changes.
    return {
        "text": "",
        "language": None,
        "segments": [],
    }


@app.get("/healthz")
def healthz() -> tuple[object, int]:
    return jsonify({"status": "ok", "service": "audio-transcription"}), 200


@app.post("/audio/transcribe")
def transcribe_route() -> tuple[object, int]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error_code": "invalid_json", "error": "Body must be a JSON object"}), 400

    is_temp_file = False
    audio_path = None
    request_type = ""

    try:
        audio_path, request_type, is_temp_file = resolve_audio_path_for_request(payload)
        if not audio_path.exists() or not audio_path.is_file():
            raise FileNotFoundError(f"Audio file not found: {audio_path}")
        if not is_allowed_audio(audio_path):
            allowed = ", ".join(sorted(SUPPORTED_AUDIO_EXTENSIONS))
            raise ValueError(f"Unsupported audio extension '{audio_path.suffix.lower()}'; allowed: {allowed}")

        transcription = transcribe_audio(audio_path)
        response = {
            "ok": True,
            "request_type": request_type,
            "audio_file": audio_path.name,
            "model": {
                "endpoint": os.getenv("MODEL_RUNNER_BASE_URL"),
                "name": os.getenv("MODEL_RUNNER_LLM_AUDIO"),
            },
            "transcription": transcription,
        }
        log_event("audio.transcription_completed", request_type=request_type, file=audio_path.name)
        return jsonify(response), 200
    except FileNotFoundError as exc:
        log_event("audio.transcription_failed", error=str(exc), error_code="file_not_found")
        return jsonify({"ok": False, "error_code": "file_not_found", "error": str(exc)}), 404
    except ValueError as exc:
        log_event("audio.transcription_failed", error=str(exc), error_code="invalid_request")
        return jsonify({"ok": False, "error_code": "invalid_request", "error": str(exc)}), 400
    except Exception as exc:  # pragma: no cover - defensive guard for runtime surprises
        log_event("audio.transcription_failed", error=str(exc), error_code="transcription_failed")
        return jsonify({"ok": False, "error_code": "transcription_failed", "error": str(exc)}), 500
    finally:
        if is_temp_file and audio_path and audio_path.exists():
            try:
                audio_path.unlink(missing_ok=True)
            except OSError:
                pass


if __name__ == "__main__":
    host = os.getenv("AUDIO_API_HOST", "0.0.0.0")
    port = int(os.getenv("AUDIO_API_PORT", "3400"))
    log_event(
        "audio.service_started",
        host=host,
        port=port,
        request_types=sorted(REQUEST_TYPES),
        supported_extensions=sorted(SUPPORTED_AUDIO_EXTENSIONS),
    )
    app.run(host=host, port=port)
