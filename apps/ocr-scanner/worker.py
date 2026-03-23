#!/usr/bin/env python3
"""OCR scanner service for PDF jobs.

This service accepts OCR jobs over HTTP, executes extraction/OCR in-process,
and exposes job status + result text retrieval endpoints.
"""

from __future__ import annotations

import base64
import json
import os
import threading
import uuid
from dataclasses import dataclass
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

app = Flask(__name__)
job_lock = threading.Lock()
jobs: dict[str, "OcrJob"] = {}


@dataclass
class OcrJob:
    job_id: str
    status: str
    created_at: str
    updated_at: str
    source_type: str
    source_value: str
    language: str
    minimum_extracted_chars: int
    extracted_text: str = ""
    ocr_performed: bool = False
    page_count: int = 0
    error: str | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "job_id": self.job_id,
            "status": self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "source_type": self.source_type,
            "language": self.language,
            "minimum_extracted_chars": self.minimum_extracted_chars,
            "ocr_performed": self.ocr_performed,
            "page_count": self.page_count,
            "error": self.error,
        }


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_event(event: str, **fields: object) -> None:
    payload = {"timestamp": utc_timestamp(), "event": event, **fields}
    print(json.dumps(payload, ensure_ascii=False))


def is_allowed_pdf(path: Path) -> bool:
    return path.suffix.lower() in SUPPORTED_EXTENSIONS


def safe_resolve_path(path_str: str) -> Path:
    candidate = Path(path_str).expanduser().resolve()
    input_dir = Path(os.getenv("OCR_INPUT_DIR", "/app/data")).resolve()
    upload_dir = Path(os.getenv("OCR_UPLOAD_DIR", "/app/upload")).resolve()
    if input_dir in candidate.parents or upload_dir in candidate.parents:
        return candidate
    raise ValueError("pdf_path must be inside OCR_INPUT_DIR or OCR_UPLOAD_DIR")


def extract_pdf_text(path: Path) -> tuple[str, int]:
    reader = PdfReader(str(path))
    pages = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    return "\n".join(pages).strip(), len(reader.pages)


def ocr_pdf_text(path: Path, language: str) -> tuple[str, int]:
    document = pdfium.PdfDocument(str(path))
    page_texts: list[str] = []
    for page_index in range(len(document)):
        page = document.get_page(page_index)
        bitmap = page.render(scale=2)
        pil_image = bitmap.to_pil()
        page_texts.append(pytesseract.image_to_string(pil_image, lang=language).strip())
        page.close()
    document.close()
    return "\n".join(page_texts).strip(), len(page_texts)


def process_job(job_id: str) -> None:
    with job_lock:
        job = jobs[job_id]
        job.status = "running"
        job.updated_at = utc_timestamp()

    tmp_pdf: Path | None = None
    try:
        if job.source_type == "pdf_path":
            pdf_path = safe_resolve_path(job.source_value)
        else:
            decoded = base64.b64decode(job.source_value)
            with NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                tmp.write(decoded)
                tmp_pdf = Path(tmp.name)
            pdf_path = tmp_pdf

        if not pdf_path.exists():
            raise FileNotFoundError("PDF file not found")
        if not is_allowed_pdf(pdf_path):
            raise ValueError("Only .pdf files are supported for now")

        extracted_text, extracted_pages = extract_pdf_text(pdf_path)
        if len(extracted_text) >= job.minimum_extracted_chars:
            final_text = extracted_text
            ocr_performed = False
            page_count = extracted_pages
        else:
            final_text, page_count = ocr_pdf_text(pdf_path, job.language)
            ocr_performed = True

        with job_lock:
            current = jobs[job_id]
            current.status = "completed"
            current.updated_at = utc_timestamp()
            current.extracted_text = final_text
            current.ocr_performed = ocr_performed
            current.page_count = page_count

        log_event(
            "ocr.job_completed",
            job_id=job_id,
            page_count=page_count,
            ocr_performed=ocr_performed,
            text_chars=len(final_text),
        )
    except Exception as exc:
        with job_lock:
            current = jobs[job_id]
            current.status = "failed"
            current.updated_at = utc_timestamp()
            current.error = str(exc)
        log_event("ocr.job_failed", job_id=job_id, error=str(exc))
    finally:
        if tmp_pdf is not None and tmp_pdf.exists():
            tmp_pdf.unlink()


@app.get("/healthz")
def healthz():
    return jsonify({"status": "ok", "service": "ocr-scanner"})


@app.post("/ocr/jobs")
def create_job():
    payload = request.get_json(silent=True) or {}
    pdf_path = payload.get("pdf_path")
    pdf_base64 = payload.get("pdf_base64")
    if bool(pdf_path) == bool(pdf_base64):
        return jsonify({"error": "Provide exactly one of pdf_path or pdf_base64"}), 400

    source_type = "pdf_path" if pdf_path else "pdf_base64"
    source_value = str(pdf_path or pdf_base64)
    language = str(payload.get("language", DEFAULT_LANGUAGE))
    minimum_extracted_chars = int(
        payload.get(
            "minimum_extracted_chars",
            os.getenv("OCR_PDF_MIN_EXTRACTED_CHARS", str(DEFAULT_THRESHOLD)),
        )
    )

    job_id = str(uuid.uuid4())
    now = utc_timestamp()
    job = OcrJob(
        job_id=job_id,
        status="queued",
        created_at=now,
        updated_at=now,
        source_type=source_type,
        source_value=source_value,
        language=language,
        minimum_extracted_chars=minimum_extracted_chars,
    )

    with job_lock:
        jobs[job_id] = job

    worker = threading.Thread(target=process_job, args=(job_id,), daemon=True)
    worker.start()

    log_event("ocr.job_queued", job_id=job_id, source_type=source_type, language=language)
    return jsonify({"job_id": job_id, "status": "queued"}), 202


@app.get("/ocr/jobs/<job_id>")
def get_job(job_id: str):
    with job_lock:
        job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "job_not_found"}), 404
    return jsonify(job.to_dict())


@app.get("/ocr/jobs/<job_id>/result")
def get_job_result(job_id: str):
    with job_lock:
        job = jobs.get(job_id)
    if not job:
        return jsonify({"error": "job_not_found"}), 404
    if job.status != "completed":
        return jsonify({"error": "job_not_completed", "status": job.status}), 409
    return jsonify(
        {
            "job_id": job.job_id,
            "status": job.status,
            "ocr_performed": job.ocr_performed,
            "page_count": job.page_count,
            "text": job.extracted_text,
            "text_chars": len(job.extracted_text),
        }
    )


def main() -> None:
    port = int(os.getenv("OCR_API_PORT", "3300"))
    host = os.getenv("OCR_API_HOST", "0.0.0.0")
    log_event(
        "ocr.worker_started",
        host=host,
        port=port,
        supported_extensions=sorted(SUPPORTED_EXTENSIONS),
    )
    app.run(host=host, port=port, debug=False)


if __name__ == "__main__":
    main()
