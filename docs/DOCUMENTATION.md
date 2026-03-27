# Local RAG AI System Documentation

This document describes the **current runtime architecture** and **data flow** of the project.

---

## 1) Architecture overview

The system is composed of eight services coordinated by Docker Compose:

- `webui` → Browser client (nginx + static JS app).
- `backend` → Public API entrypoint, auth/session, admin/user endpoints, library-management endpoints, and retriever proxying.
- `retriever` → Retrieval and answer orchestration (RAG pipeline, prompt building, assistant modes, personalization, chat logic).
- `embedder` → Background indexing pipeline that reads source files, chunks text, computes embeddings, and updates vector store metadata.
- `ocr-scanner` → Python OCR and PDF extraction service used by both retriever and embedder.
- `audio-transcription` → Python audio transcription service scaffold for chat input and embedding audio jobs.
- `qdrant` → Vector database for semantic similarity search.
- `postgres` → Durable storage for auth/session data, chats/messages, settings, metadata, tags, and runtime state.

### Graphical overview

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                             Local RAG AI System                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ User                                                                         │
│  │                                                                           │
│  ▼                                                                           │
│ WebUI (nginx + static app)                                                   │
│  │  /api/*                                                                   │
│  ▼                                                                           │
│ Backend API                                                                  │
│  ├─ Auth/session + admin/user management                                     │
│  ├─ Managed library routes                                                   │
│  └─ Proxies chat/retrieval routes                                            │
│       │                                                                      │
│       ▼                                                                      │
│ Retriever API                                                                │
│  ├─ Prompt assembly (guardrails + mode + personalization + history)          │
│  ├─ Retrieval orchestration                                                  │
│  └─ Chat lifecycle                                                           │
│      │                         │                                             │
│      │ vector search           │ persistence                                 │
│      ▼                         ▼                                             │
│   Qdrant                    Postgres                                         │
│                                                                              │
│ Embedder worker ──► OCR scanner ──► extracted text ──► embeddings ──► Qdrant │
│      │                      ▲                                                │
│      └──────── reads data/ ─┴─ reads upload/ for prompt file OCR             │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 2) Runtime flow

### Request flow (chat)

1. User interacts with `webui`.
2. `webui` calls `backend` (`/api/*`).
3. `backend` validates session/auth and proxies chat/prompt routes to `retriever` internal routes.
4. `retriever` resolves chat/session state from `postgres`, reads retrieval candidates from `qdrant`, assembles final model messages, and calls the chat model.
5. Response is persisted and returned to `webui` via `backend`.

### Indexing flow

1. `embedder` scans content under `data/` on interval.
2. For supported files, text is extracted (with OCR delegation for PDF/image cases).
3. Content is chunked and embedded.
4. Embeddings + payload metadata are written to `qdrant`.
5. Index/file status and metadata are written to `postgres` and shared state files.

### OCR flow

- `embedder` uses OCR service for library extraction of difficult PDFs/images.
- `retriever` uses OCR service for prompt-time uploads (PDF/image attachments).
- OCR responses carry extraction metadata and explicit error codes for robust skip/failure handling.

---

## 3) API surface (high-level)

### Backend (public entrypoint)

- Auth/session:
  - `POST /api/auth/login`
  - `POST /api/auth/change-password`
  - `GET /api/auth/session`
  - `POST /api/auth/logout`
- Admin:
  - `GET/POST /api/admin/users`
  - `PATCH/DELETE /api/admin/users/:username`
- RAG/chat proxy routes:
  - `GET /api/status`
  - `GET /api/files`
  - `PATCH /api/files/tags`
  - `GET/PATCH /api/files/tag-filters`
  - `GET /api/messages`
  - `GET/POST /api/chats`
  - `PATCH/DELETE /api/chats/:chatId`
  - `GET /api/chats/:chatId/download`
  - `GET/PATCH /api/personalization`
  - `POST /api/prompt`
- Managed library routes:
  - `GET/POST/PATCH/DELETE /api/library/files`
- Health:
  - `GET /healthz`

### Retriever (internal/public in dev)

- Internal equivalents of the core chat/file/prompt/personalization routes under `/internal/retriever/*`.
- Also supports `/api/*` path variants for local/direct usage.
- Health: `GET /healthz`.

### Embedder

- Status endpoint used by backend status aggregation:
  - `GET /internal/embedder/status`

### OCR scanner

- `GET /healthz`
- `POST /ocr/scan`

### Audio transcription

- `GET /healthz`
- `POST /audio/transcribe`

---

## 4) Data model and storage responsibilities

- **Postgres** stores:
  - users/roles/credentials
  - sessions and expiry windows
  - chat entities and message history
  - session/user settings (including personalization and UI mode)
  - file metadata + tag state + managed library flags
- **Qdrant** stores:
  - chunk vectors
  - chunk text and associated metadata for retrieval/evidence packaging
- **Filesystem state (`/app/state`)** stores:
  - index status map
  - embedding status map

---

## 5) File support

### Library/indexing support

Primary embeddable formats include markdown/text/html/pdf/epub sources from `data/`.

### Prompt attachment support

Prompt-time upload handling supports:

- `.md`, `.txt`, `.html`, `.htm`, `.pdf`, `.csv`
- OCR image types: `.png`, `.jpg`, `.jpeg`, `.webp`

---

## 6) Config and runtime notes

- Node containers share one base image (`Dockerfile`) and choose startup entrypoint by `APP_ROLE`.
- Retriever and embedder use explicit shared state file paths:
  - `INDEX_STATE_FILE=/app/state/index-state.json`
  - `EMBEDDING_STATUS_FILE=/app/state/embedding-status.json`
- Models are configured in `compose.yml` under top-level `models` (`chat-model`, `embedding-model`, `audio-model`).

---

## 7) Related docs

- `docs/DEVELOPERS.md` – where to change what safely.
- `docs/PROMPTS.md` – prompt policy principles.
- `docs/PROMPTBUILDING.md` – end-to-end prompt assembly internals.
- `docs/CHANGELOG.md` – release history.
