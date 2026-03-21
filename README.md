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

## Implemented APIs (backend step 1)

- `POST /api/prompt`: send user prompt and receive answer + evidence severity.
- `GET /api/status`: get basic system/readiness status.
- `GET /api/files`: list embeddable files and embedding coverage.
- `GET /api/chats`, `POST /api/chats`, `PATCH /api/chats/:chatId`, `DELETE /api/chats/:chatId`: manage multi-chat lifecycle per session (create, switch, archive, activate, delete).
- `GET /api/messages`: fetch messages for a specific chat (or the session's active chat).
- `GET /healthz`: lightweight liveness check.

## WebUI (frontend step 2)

The web UI is intentionally minimal for now:
- message list (chat-like)
- prompt input + send button
- **Attach** button in normal chat composer for prompt-level file uploads (`.md`, `.txt`, `.html`, `.htm`, `.pdf`, up to 3 files)
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
