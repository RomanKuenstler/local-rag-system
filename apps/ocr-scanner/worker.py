#!/usr/bin/env python3
"""OCR scanner microservice for PDF and image requests from other services."""

from __future__ import annotations

import base64
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile

import fitz
import pypdfium2 as pdfium
import pytesseract
from PIL import Image
from flask import Flask, jsonify, request

SUPPORTED_PDF_EXTENSIONS = {".pdf"}
SUPPORTED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
DEFAULT_THRESHOLD = 150
DEFAULT_LANGUAGE = "eng"
REQUEST_TYPES = {"library_pdf", "prompt_pdf", "library_image", "prompt_image"}

app = Flask(__name__)


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_event(event: str, **fields: object) -> None:
    payload = {"timestamp": utc_timestamp(), "event": event, **fields}
    print(json.dumps(payload, ensure_ascii=False))


def is_allowed_pdf(path: Path) -> bool:
    return path.suffix.lower() in SUPPORTED_PDF_EXTENSIONS


def is_allowed_image(path: Path) -> bool:
    return path.suffix.lower() in SUPPORTED_IMAGE_EXTENSIONS


def detect_columns(blocks: list[dict[str, float]], page_width: float) -> int:
    if len(blocks) < 3:
        return 1
    centers = sorted(((block["x0"] + block["x1"]) / 2 for block in blocks))
    if len(centers) < 3:
        return 1
    largest_gap = 0.0
    gap_index = 0
    for index in range(len(centers) - 1):
        gap = centers[index + 1] - centers[index]
        if gap > largest_gap:
            largest_gap = gap
            gap_index = index
    if largest_gap < (page_width * 0.18):
        return 1
    left_count = gap_index + 1
    right_count = len(centers) - left_count
    if left_count < 2 or right_count < 2:
        return 1
    return 2


def order_blocks_for_reading(blocks: list[dict[str, float]], page_width: float) -> list[dict[str, float]]:
    columns = detect_columns(blocks, page_width)
    if columns == 1:
        return sorted(blocks, key=lambda block: (block["y0"], block["x0"]))

    mid_x = page_width / 2
    left = [block for block in blocks if ((block["x0"] + block["x1"]) / 2) <= mid_x]
    right = [block for block in blocks if ((block["x0"] + block["x1"]) / 2) > mid_x]
    return sorted(left, key=lambda block: (block["y0"], block["x0"])) + sorted(
        right, key=lambda block: (block["y0"], block["x0"])
    )


def extract_layout_text(path: Path) -> tuple[str, int, list[dict[str, object]]]:
    doc = fitz.open(str(path))
    page_texts: list[str] = []
    page_layouts: list[dict[str, object]] = []
    try:
        for page_index, page in enumerate(doc):
            page_width = float(page.rect.width or 1.0)
            raw_blocks = page.get_text("blocks")
            text_blocks: list[dict[str, float]] = []

            for x0, y0, x1, y1, text, *_ in raw_blocks:
                cleaned = str(text or "").strip()
                if not cleaned:
                    continue
                text_blocks.append(
                    {
                        "x0": float(x0),
                        "y0": float(y0),
                        "x1": float(x1),
                        "y1": float(y1),
                        "text": cleaned,
                    }
                )

            ordered_blocks = order_blocks_for_reading(text_blocks, page_width)
            page_text = "\n\n".join(block["text"] for block in ordered_blocks).strip()
            page_texts.append(page_text)
            page_layouts.append(
                {
                    "page": page_index + 1,
                    "detected_columns": detect_columns(text_blocks, page_width),
                    "block_count": len(text_blocks),
                }
            )
    finally:
        doc.close()

    return "\n\n".join(text for text in page_texts if text).strip(), len(page_texts), page_layouts


def evaluate_text_quality(text: str, minimum_extracted_chars: int) -> dict[str, object]:
    stripped = text.strip()
    char_count = len(stripped)
    non_whitespace = len(re.sub(r"\s+", "", stripped))
    printable = len([char for char in stripped if char.isprintable() and not char.isspace()])
    alpha_count = len([char for char in stripped if char.isalpha()])
    words = re.findall(r"[A-Za-z0-9]+", stripped)
    avg_word_length = (sum(len(word) for word in words) / len(words)) if words else 0.0

    printable_ratio = (printable / non_whitespace) if non_whitespace > 0 else 0.0
    alpha_ratio = (alpha_count / non_whitespace) if non_whitespace > 0 else 0.0

    reasons: list[str] = []
    if char_count < minimum_extracted_chars:
        reasons.append("below_minimum_chars")
    if printable_ratio < 0.9:
        reasons.append("low_printable_ratio")
    if alpha_ratio < 0.45:
        reasons.append("low_alpha_ratio")
    if words and (avg_word_length < 2.0 or avg_word_length > 15.0):
        reasons.append("abnormal_average_word_length")

    quality = "weak" if reasons else "good"
    return {
        "quality": quality,
        "reasons": reasons,
        "char_count": char_count,
        "non_whitespace_chars": non_whitespace,
        "printable_ratio": round(printable_ratio, 4),
        "alpha_ratio": round(alpha_ratio, 4),
        "avg_word_length": round(avg_word_length, 4),
    }


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


def resolve_document_path_for_request(payload: dict[str, object]) -> tuple[Path, str, bool]:
    request_type = str(payload.get("request_type") or "").strip()
    if request_type not in REQUEST_TYPES:
        raise ValueError("request_type must be one of: library_pdf, prompt_pdf, library_image, prompt_image")

    content_dir = Path(os.getenv("OCR_CONTENT_DIR", "/app/data")).resolve()
    upload_dir = Path(os.getenv("OCR_UPLOAD_DIR", "/app/upload")).resolve()

    if request_type == "library_pdf":
        relative_path = str(payload.get("pdf_relative_path") or "").strip()
        if not relative_path:
            raise ValueError("library_pdf requires pdf_relative_path")
        return safe_join(content_dir, relative_path), request_type, False

    if request_type == "prompt_pdf":
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

    if request_type == "library_image":
        relative_path = str(payload.get("image_relative_path") or "").strip()
        if not relative_path:
            raise ValueError("library_image requires image_relative_path")
        return safe_join(content_dir, relative_path), request_type, False

    prompt_relative_path = str(payload.get("prompt_image_relative_path") or "").strip()
    prompt_image_base64 = str(payload.get("image_base64") or "").strip()

    has_relative_path = bool(prompt_relative_path)
    has_base64 = bool(prompt_image_base64)
    if has_relative_path == has_base64:
        raise ValueError("prompt_image requires exactly one of prompt_image_relative_path or image_base64")

    if has_relative_path:
        return safe_join(upload_dir, prompt_relative_path), request_type, False

    extension = str(payload.get("image_extension") or ".png").strip().lower()
    if not extension.startswith("."):
        extension = f".{extension}"
    if extension not in SUPPORTED_IMAGE_EXTENSIONS:
        raise ValueError("image_extension must be one of: .png, .jpg, .jpeg, .webp")

    with NamedTemporaryFile(delete=False, suffix=extension) as tmp:
        tmp.write(base64.b64decode(prompt_image_base64))
        return Path(tmp.name), request_type, True


def run_pdf_scan(
    pdf_path: Path,
    language: str,
    minimum_extracted_chars: int,
) -> tuple[str, bool, int, dict[str, object]]:
    if not pdf_path.exists():
        raise FileNotFoundError("PDF file not found")
    if not is_allowed_pdf(pdf_path):
        raise ValueError("Only .pdf files are supported")

    extracted_text, extracted_pages, page_layouts = extract_layout_text(pdf_path)
    quality = evaluate_text_quality(extracted_text, minimum_extracted_chars)
    extraction_details: dict[str, object] = {
        "mode": "layout_extraction",
        "layout": page_layouts,
        "quality": quality,
    }
    if quality["quality"] == "good":
        return extracted_text, False, extracted_pages, extraction_details

    ocr_text, ocr_pages = ocr_pdf_text(pdf_path, language)
    ocr_quality = evaluate_text_quality(ocr_text, minimum_extracted_chars)
    extraction_details = {
        "mode": "ocr_fallback",
        "layout": page_layouts,
        "layout_quality": quality,
        "ocr_quality": ocr_quality,
    }
    return ocr_text, True, ocr_pages, extraction_details


def run_image_scan(
    image_path: Path,
    language: str,
    minimum_extracted_chars: int,
) -> tuple[str, int, dict[str, object], bool]:
    if not image_path.exists():
        raise FileNotFoundError("Image file not found")
    if not is_allowed_image(image_path):
        raise ValueError("Only .png, .jpg, .jpeg, and .webp files are supported")

    with Image.open(str(image_path)) as image:
        image_for_ocr = image.convert("RGB")
        text = pytesseract.image_to_string(image_for_ocr, lang=language).strip()

    quality = evaluate_text_quality(text, minimum_extracted_chars)
    useful_text = quality["quality"] == "good"
    extraction_details: dict[str, object] = {
        "mode": "ocr_image",
        "image_format": image_path.suffix.lower(),
        "quality": quality,
        "result_status": "ok" if useful_text else "no_useful_text",
    }
    return text, 1, extraction_details, useful_text


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
        document_path, request_type, is_temp_file = resolve_document_path_for_request(payload)
        temp_file = document_path if is_temp_file else None

        if request_type in {"library_pdf", "prompt_pdf"}:
            text, ocr_performed, page_count, extraction_details = run_pdf_scan(
                document_path, language, minimum_extracted_chars
            )
            useful_text = True
        else:
            text, page_count, extraction_details, useful_text = run_image_scan(
                document_path,
                language,
                minimum_extracted_chars,
            )
            ocr_performed = True

        response = {
            "status": "success",
            "request_type": request_type,
            "ocr_performed": ocr_performed,
            "page_count": page_count,
            "text_chars": len(text),
            "text": text,
            "useful_text": useful_text,
            "extraction_status": "ok" if useful_text else "no_useful_text",
            "extraction_details": extraction_details,
        }
        log_event(
            "ocr.scan_completed",
            request_type=request_type,
            ocr_performed=ocr_performed,
            useful_text=useful_text,
            page_count=page_count,
            text_chars=len(text),
            source_path=str(document_path),
        )
        return jsonify(response), 200
    except FileNotFoundError as exc:
        log_event("ocr.scan_failed", error=str(exc), error_code="file_not_found")
        return jsonify({"status": "error", "error_code": "file_not_found", "error": str(exc)}), 404
    except ValueError as exc:
        log_event("ocr.scan_failed", error=str(exc), error_code="invalid_request")
        return jsonify({"status": "error", "error_code": "invalid_request", "error": str(exc)}), 400
    except Exception as exc:
        log_event("ocr.scan_failed", error=str(exc), error_code="scan_failed")
        return jsonify({"status": "error", "error_code": "scan_failed", "error": str(exc)}), 500
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
