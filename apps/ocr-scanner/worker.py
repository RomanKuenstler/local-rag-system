#!/usr/bin/env python3
"""OCR scanner microservice for PDF requests from other services."""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile

import pypdfium2 as pdfium
import pytesseract
from flask import Flask, jsonify, request
from pypdf import PdfReader

SUPPORTED_EXTENSIONS = {".pdf"}
DEFAULT_THRESHOLD = 150
DEFAULT_LANGUAGE = "eng"
REQUEST_TYPES = {"library_pdf", "prompt_pdf"}

app = Flask(__name__)


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_event(event: str, **fields: object) -> None:
    payload = {"timestamp": utc_timestamp(), "event": event, **fields}
    print(json.dumps(payload, ensure_ascii=False))


def is_allowed_pdf(path: Path) -> bool:
    return path.suffix.lower() in SUPPORTED_EXTENSIONS


def extract_pdf_text(path: Path) -> tuple[str, int]:
    reader = PdfReader(str(path))
    page_texts = []
    for page in reader.pages:
        page_texts.append(page.extract_text() or "")
    return "\n".join(page_texts).strip(), len(reader.pages)


def ocr_pdf_text(path: Path, language: str) -> tuple[str, int]:
    document = pdfium.PdfDocument(str(path))
    page_texts: list[str] = []
    for page_index in range(len(document)):
        page = document.get_page(page_index)
        image = page.render(scale=2).to_pil()
        page_texts.append(pytesseract.image_to_string(image, lang=language).strip())
        page.close()
    document.close()
    return "\n".join(page_texts).strip(), len(page_texts)


def safe_join(base_dir: Path, relative_path: str) -> Path:
    candidate = (base_dir / relative_path).resolve()
    if base_dir == candidate or base_dir in candidate.parents:
        return candidate
    raise ValueError("Relative path escapes allowed base directory")


def resolve_pdf_path_for_request(payload: dict[str, object]) -> tuple[Path, str, bool]:
    request_type = str(payload.get("request_type") or "").strip()
    if request_type not in REQUEST_TYPES:
        raise ValueError("request_type must be one of: library_pdf, prompt_pdf")

    content_dir = Path(os.getenv("OCR_CONTENT_DIR", "/app/data")).resolve()
    upload_dir = Path(os.getenv("OCR_UPLOAD_DIR", "/app/upload")).resolve()

    if request_type == "library_pdf":
        relative_path = str(payload.get("pdf_relative_path") or "").strip()
        if not relative_path:
            raise ValueError("library_pdf requires pdf_relative_path")
        return safe_join(content_dir, relative_path), request_type, False

    prompt_relative_path = str(payload.get("prompt_pdf_relative_path") or "").strip()
    prompt_pdf_base64 = str(payload.get("pdf_base64") or "").strip()

    has_relative_path = bool(prompt_relative_path)
    has_base64 = bool(prompt_pdf_base64)
    if has_relative_path == has_base64:
        raise ValueError("prompt_pdf requires exactly one of prompt_pdf_relative_path or pdf_base64")

    if has_relative_path:
        return safe_join(upload_dir, prompt_relative_path), request_type, False

    with NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
        tmp.write(base64.b64decode(prompt_pdf_base64))
        return Path(tmp.name), request_type, True


def run_pdf_scan(
    pdf_path: Path,
    language: str,
    minimum_extracted_chars: int,
) -> tuple[str, bool, int]:
    if not pdf_path.exists():
        raise FileNotFoundError("PDF file not found")
    if not is_allowed_pdf(pdf_path):
        raise ValueError("Only .pdf files are supported")

    extracted_text, extracted_pages = extract_pdf_text(pdf_path)
    if len(extracted_text) >= minimum_extracted_chars:
        return extracted_text, False, extracted_pages

    ocr_text, ocr_pages = ocr_pdf_text(pdf_path, language)
    return ocr_text, True, ocr_pages


@app.get("/healthz")
def healthz():
    return jsonify({"status": "ok", "service": "ocr-scanner"})


@app.post("/ocr/scan")
def scan_pdf():
    payload = request.get_json(silent=True) or {}
    language = str(payload.get("language", DEFAULT_LANGUAGE)).strip() or DEFAULT_LANGUAGE
    minimum_extracted_chars = int(
        payload.get(
            "minimum_extracted_chars",
            os.getenv("OCR_PDF_MIN_EXTRACTED_CHARS", str(DEFAULT_THRESHOLD)),
        )
    )

    temp_file: Path | None = None
    try:
        pdf_path, request_type, is_temp_file = resolve_pdf_path_for_request(payload)
        temp_file = pdf_path if is_temp_file else None
        text, ocr_performed, page_count = run_pdf_scan(pdf_path, language, minimum_extracted_chars)

        response = {
            "request_type": request_type,
            "ocr_performed": ocr_performed,
            "page_count": page_count,
            "text_chars": len(text),
            "text": text,
        }
        log_event(
            "ocr.scan_completed",
            request_type=request_type,
            ocr_performed=ocr_performed,
            page_count=page_count,
            text_chars=len(text),
            source_path=str(pdf_path),
        )
        return jsonify(response), 200
    except Exception as exc:
        log_event("ocr.scan_failed", error=str(exc))
        return jsonify({"error": str(exc)}), 400
    finally:
        if temp_file is not None and temp_file.exists():
            temp_file.unlink()


def main() -> None:
    host = os.getenv("OCR_API_HOST", "0.0.0.0")
    port = int(os.getenv("OCR_API_PORT", "3300"))
    log_event(
        "ocr.service_started",
        host=host,
        port=port,
        request_types=sorted(REQUEST_TYPES),
    )
    app.run(host=host, port=port, debug=False)


if __name__ == "__main__":
    main()
