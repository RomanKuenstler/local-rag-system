# Local RAG AI System

Local, containerized Retrieval-Augmented Generation (RAG) for indexing your documents and chatting against them with grounded answers.

## Services

This stack runs with Docker Compose and includes:

- `backend` – frontend-facing API gateway.
- `retriever` – chat/retrieval API, assistant-mode logic, prompt orchestration.
- `embedder` – indexing worker for files in `./data`.
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

- `PROMPTS.md` – high-level prompting principles.
- `PROMPTBUILDING.md` – implementation-level prompt assembly pipeline, guardrails layering, assistant mode differences, personalization behavior, and file-level change map.

## Documentation map

- `DOCUMENTATION.md` – conceptual and architecture overview.
- `DEVELOPERS.md` – contributor map, where to change what, and refactor notes.
- `CHANGELOG.md` – release and change history.

## Notes

- The retriever and embedder now share explicit state file paths via compose:
  - `INDEX_STATE_FILE=/app/state/index-state.json`
  - `EMBEDDING_STATUS_FILE=/app/state/embedding-status.json`
- The base app container uses `APP_ROLE` to select startup command; retriever role now boots `retriever-api.js` by default.
