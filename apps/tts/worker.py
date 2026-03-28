#!/usr/bin/env python3
"""TTS microservice that proxies synthesis to a model runner and streams audio."""

from __future__ import annotations

import json
import os
import base64
from datetime import datetime, timezone

import requests
from flask import Flask, Response, jsonify, request, stream_with_context

MODEL_RUNNER_BASE_URL = (os.getenv("MODEL_RUNNER_BASE_URL", "http://model-runner.docker.internal").rstrip("/")
                         or "http://model-runner.docker.internal")
MODEL_RUNNER_TTS_MODEL = os.getenv("MODEL_RUNNER_LLM_TTS", "hf.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base").strip() or "hf.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base"
TTS_DEFAULT_FORMAT = os.getenv("TTS_AUDIO_FORMAT", "wav").strip().lower() or "wav"
REQUEST_TIMEOUT_SECONDS = float(os.getenv("TTS_UPSTREAM_TIMEOUT_SECONDS", "180"))

app = Flask(__name__)


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_event(event: str, **fields: object) -> None:
    payload = {"timestamp": utc_timestamp(), "event": event, **fields}
    print(json.dumps(payload, ensure_ascii=False))


def model_runner_url(path: str) -> str:
    base = MODEL_RUNNER_BASE_URL.rstrip("/")
    clean_path = path.lstrip("/")
    if base.endswith("/v1"):
        return f"{base}/{clean_path}"
    return f"{base}/v1/{clean_path}"


def parse_request_payload(payload: object) -> tuple[str, str, str, float | None]:
    if not isinstance(payload, dict):
        raise ValueError("Body must be a JSON object")

    text = str(payload.get("text") or "").strip()
    if not text:
        raise ValueError("Field 'text' is required")

    voice = str(payload.get("voice") or "").strip()
    audio_format = str(payload.get("audio_format") or TTS_DEFAULT_FORMAT).strip().lower() or TTS_DEFAULT_FORMAT
    speed = payload.get("speed")

    parsed_speed = None
    if speed is not None:
        parsed_speed = float(speed)
        if parsed_speed <= 0:
            raise ValueError("Field 'speed' must be greater than zero")

    return text, voice, audio_format, parsed_speed


@app.get("/healthz")
def healthz() -> tuple[object, int]:
    return jsonify({
        "status": "ok",
        "service": "tts",
        "model": {
            "endpoint": MODEL_RUNNER_BASE_URL,
            "name": MODEL_RUNNER_TTS_MODEL,
        },
    }), 200


@app.post("/tts/synthesize")
def synthesize() -> Response | tuple[object, int]:
    payload = request.get_json(silent=True)

    try:
        text, voice, audio_format, speed = parse_request_payload(payload)
    except ValueError as exc:
        return jsonify({"ok": False, "error_code": "invalid_request", "error": str(exc)}), 400

    upstream_payload = {
        "model": MODEL_RUNNER_TTS_MODEL,
        "input": text,
        "format": audio_format,
    }
    if voice:
        upstream_payload["voice"] = voice
    if speed is not None:
        upstream_payload["speed"] = speed

    log_event("tts.synthesis_started", model=MODEL_RUNNER_TTS_MODEL, format=audio_format)

    def stream_audio_speech() -> Response | tuple[object, int] | None:
        try:
            upstream_response = requests.post(
                model_runner_url("audio/speech"),
                headers={"Content-Type": "application/json"},
                data=json.dumps(upstream_payload),
                stream=True,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            log_event("tts.synthesis_failed", error_code="upstream_unavailable", error=str(exc))
            return jsonify({"ok": False, "error_code": "upstream_unavailable", "error": str(exc)}), 502

        if upstream_response.status_code == 404:
            upstream_response.close()
            return None

        if upstream_response.status_code >= 400:
            try:
                error_payload = upstream_response.json()
            except Exception:
                error_payload = {"error": upstream_response.text[:500]}
            message = str(error_payload.get("error") or error_payload)
            log_event(
                "tts.synthesis_failed",
                error_code="upstream_rejected",
                status_code=upstream_response.status_code,
                error=message,
            )
            return jsonify({"ok": False, "error_code": "upstream_rejected", "error": message}), 502

        content_type = upstream_response.headers.get("content-type") or f"audio/{audio_format}"

        def generate():
            try:
                for chunk in upstream_response.iter_content(chunk_size=8192):
                    if chunk:
                        yield chunk
            finally:
                upstream_response.close()
                log_event("tts.synthesis_completed", model=MODEL_RUNNER_TTS_MODEL, format=audio_format, endpoint="/v1/audio/speech")

        return Response(stream_with_context(generate()), status=200, content_type=content_type)

    def chat_completions_fallback() -> Response | tuple[object, int]:
        fallback_payload = {
            "model": MODEL_RUNNER_TTS_MODEL,
            "messages": [{"role": "user", "content": text}],
            "modalities": ["audio"],
            "audio": {
                "voice": voice or "alloy",
                "format": audio_format,
            },
        }
        if speed is not None:
            fallback_payload["audio"]["speed"] = speed

        try:
            response = requests.post(
                model_runner_url("chat/completions"),
                headers={"Content-Type": "application/json"},
                data=json.dumps(fallback_payload),
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
        except requests.RequestException as exc:
            log_event("tts.synthesis_failed", error_code="upstream_unavailable", error=str(exc))
            return jsonify({"ok": False, "error_code": "upstream_unavailable", "error": str(exc)}), 502

        if response.status_code >= 400:
            try:
                error_payload = response.json()
            except Exception:
                error_payload = {"error": response.text[:500]}
            message = str(error_payload.get("error") or error_payload)
            log_event(
                "tts.synthesis_failed",
                error_code="upstream_rejected",
                status_code=response.status_code,
                error=message,
            )
            return jsonify({"ok": False, "error_code": "upstream_rejected", "error": message}), 502

        payload = response.json()
        audio_b64 = (
            payload.get("choices", [{}])[0]
            .get("message", {})
            .get("audio", {})
            .get("data")
        )
        if not audio_b64:
            return jsonify({"ok": False, "error_code": "invalid_response", "error": "No audio data in chat completion response"}), 502

        audio_bytes = base64.b64decode(audio_b64)
        log_event("tts.synthesis_completed", model=MODEL_RUNNER_TTS_MODEL, format=audio_format, endpoint="/v1/chat/completions")
        return Response(audio_bytes, status=200, content_type=f"audio/{audio_format}")

    primary_response = stream_audio_speech()
    if primary_response is None:
        log_event("tts.fallback_to_chat_completions", model=MODEL_RUNNER_TTS_MODEL)
        primary_response = chat_completions_fallback()

    if isinstance(primary_response, tuple):
        return primary_response

    response = primary_response
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-TTS-Model"] = MODEL_RUNNER_TTS_MODEL
    return response


if __name__ == "__main__":
    host = os.getenv("TTS_API_HOST", "0.0.0.0")
    port = int(os.getenv("TTS_API_PORT", "3500"))
    log_event("tts.service_started", host=host, port=port, model=MODEL_RUNNER_TTS_MODEL)
    app.run(host=host, port=port)
