# Local RAG AI System

Local, containerized Retrieval-Augmented Generation (RAG) for indexing your documents and chatting against them with grounded answers.

## Services

This stack runs with Docker Compose and includes:

- `backend` – frontend-facing API gateway.
- `retriever` – chat/retrieval API, assistant-mode logic, prompt orchestration.
- `embedder` – indexing worker for files in `./data`.
- `ocr-scanner` – Python OCR service for scanned/text-poor PDFs and images from library and prompt uploads.
- `qdrant` – vector database for chunk embeddings.
- `postgres` – chat/session/runtime/index metadata persistence.
- `webui` – lightweight browser UI (nginx + static JS).

## Quick start

```bash
docker compose up -d --build
```

Endpoints:

- Web UI: `http://localhost:5173`
- Backend API: `http://localhost:3100`
- Retriever API (internal): `http://retriever:3000`
- OCR scanner API: `http://localhost:3300`

OCR scanner endpoints:

- `GET /healthz`
- `POST /ocr/scan`

`POST /ocr/scan` request types:

- `library_pdf` → pass `pdf_relative_path` under `data/` (works for `_library/...` and direct PDFs in data root/subfolders).
- `prompt_pdf` → pass either `prompt_pdf_relative_path` under `upload/` or `pdf_base64`.
- `library_image` → pass `image_relative_path` under `data/` for `.png`, `.jpg`, `.jpeg`, or `.webp` images.
- `prompt_image` → pass either `prompt_image_relative_path` under `upload/` or `image_base64` (optionally `image_extension` for base64 requests, default `.png`).
- OCR scanner performs layout-aware PDF extraction first (including block ordering / multi-column handling), evaluates extraction quality, and falls back to OCR when quality is weak.
- OCR scanner performs OCR extraction directly for supported image formats.
- Image OCR responses include `useful_text` / `extraction_status`; if OCR output is empty or below threshold (`minimum_extracted_chars`), the service marks it as `no_useful_text`.
- OCR scanner responses include `status` and `extraction_details`; on failures it returns `status=error` with `error_code` (used by retriever/embedder for robust error handling).

Embedder behavior:

- The embedder indexes files normally.
- For PDFs in `data/` (including `data/_library`), embedder delegates text extraction to `ocr-scanner`.
- For prompt-attached PDFs, retriever delegates extraction to `ocr-scanner` via `prompt_pdf` requests and uses returned text to build prompt upload context.
- If OCR fails for an uploaded prompt PDF, retriever reports a file-level skip/error without crashing the whole prompt request.

## Core API endpoints

- `GET /api/status`
- `GET /api/files`
- `POST /api/prompt`
- `GET /api/chats`
- `POST /api/chats`
- `PATCH /api/chats/:chatId`
- `DELETE /api/chats/:chatId`
- `GET /api/chats/:chatId/download`
- `GET /api/messages`
- `GET /healthz`

## Prompt + assistant behavior docs

- `docs/PROMPTS.md` – high-level prompting principles.
- `docs/PROMPTBUILDING.md` – implementation-level prompt assembly pipeline, guardrails layering, assistant mode differences, personalization behavior, and file-level change map.

## Documentation map

- `docs/DOCUMENTATION.md` – conceptual and architecture overview.
- `docs/DEVELOPERS.md` – contributor map, where to change what, and refactor notes.
- `docs/CHANGELOG.md` – release and change history.

## Notes

- The retriever and embedder now share explicit state file paths via compose:
  - `INDEX_STATE_FILE=/app/state/index-state.json`
  - `EMBEDDING_STATUS_FILE=/app/state/embedding-status.json`
- The base app container uses `APP_ROLE` to select startup command; retriever role now boots `apps/retriever/api.js` by default.


## Repository layout

- `apps/` – deployable service entrypoints and UI (`backend`, `retriever`, `embedder`, `ocr-scanner`, `webui`).
- `shared/` – reusable modules and cross-service assets (`src`, `config`, `db`, `prompts`).
- Service-local helpers now live with each app (for example `apps/backend/library-service.js` and `apps/retriever/ui.js`) to avoid unnecessary cross-service coupling.
- `docs/` – architecture, changelog, and contributor notes.
- `scripts/` – helper scripts for content download/prep.
- `data/`, `migrations/`, `upload/`, `downloaded-html/` – runtime/content assets.
