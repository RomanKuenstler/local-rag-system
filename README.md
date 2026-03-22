# Local RAG AI System

A local, containerized Retrieval-Augmented Generation (RAG) system for experimenting with document indexing, vector search, and grounded responses.

## What this project is

This project runs five services with Docker Compose:
- **backend**: frontend-facing API that orchestrates calls to internal services.
- **embedder**: continuously indexes files from `./data` into vectors.
- **qdrant**: stores embeddings and metadata.
- **postgres**: stores chat history, runtime settings, and indexed file metadata.
- **retriever**: API-oriented retrieval + answer service.
- **webui**: very small React chat UI served by nginx; `/api` is reverse-proxied to the backend service.

## Documentation

Detailed documentation (architecture, setup details, internals) has been moved to:
- **`DOCUMENTATION.md`**
- **`DEVELOPERS.md`** (maintainer-oriented file/folder map and development notes)

## Chain-impr branch highlights (vs main)

This branch contains a broad set of product and reliability updates:
- multi-chat lifecycle in WebUI (rename, download, archive, restore, delete)
- a unified Preferences dialog (Settings / Personalization / Info / Archive / Help)
- assistant-mode UX improvements including refine-chain stage awareness in frontend
- temporary UI disablement of `thinking` mode while keeping it visible
- stronger refine chain behavior (draft → refine fallback handling for empty final passes)
- richer prompt attachment support (including `.csv`) and library embedding support for `.epub`
- EPUB ingestion hardening across multiple parsing edge-cases
- updated maintainer docs and changelog to reflect current system behavior

## Implemented APIs (backend step 1)

- `POST /api/prompt`: send user prompt and receive answer + evidence severity.
- `GET /api/status`: get basic system/readiness status.
- `GET /api/files`: list embeddable files and embedding coverage.
- `GET /api/chats`, `POST /api/chats`, `PATCH /api/chats/:chatId`, `DELETE /api/chats/:chatId`: manage multi-chat lifecycle per session (create, switch, archive, activate, rename, delete).
- `GET /api/chats/:chatId/download`: download a chat export as JSON.
- `GET /api/messages`: fetch messages for a specific chat (or the session's active chat).
- `GET /healthz`: lightweight liveness check.

## WebUI (frontend step 2)

The web UI is intentionally minimal for now:
- message list (chat-like)
- prompt input + send button
- per-chat menu actions (rename, download, archive, delete)
- archive management tab in Preferences (download / unarchive / delete archived chats)
- assistant mode selector in chat header and Preferences personalization (with **Thinking** visible but temporarily disabled)
- **Attach** button in normal chat composer for prompt-level file uploads (`.md`, `.txt`, `.html`, `.htm`, `.pdf`, `.csv`, up to 3 files)
- status badges for retriever, embedding state, and embedded file count
- `/info` panel with grouped runtime details (models, Qdrant collection, Postgres connection, and state-file paths)

## Quick start

```bash
docker compose up -d qdrant embedder retriever backend webui
```

- Backend API: `http://localhost:3100`
- Retriever API: internal-only (`http://retriever:3000` on the compose network)
- Web UI: `http://localhost:5173` (same-origin `/api` proxy to `backend:3100`)

## Example API calls

```bash
curl http://localhost:3100/api/status
curl http://localhost:3100/api/files
curl -X POST http://localhost:3100/api/prompt \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"What does the firewall document say about IPS?","sessionId":"demo"}'
```
