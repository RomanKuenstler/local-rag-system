# Local RAG AI System

A local, containerized Retrieval-Augmented Generation (RAG) system for experimenting with document indexing, vector search, and grounded responses.

## What this project is

This project runs four services with Docker Compose:
- **embedder**: continuously indexes files from `./data` into vectors.
- **qdrant**: stores embeddings and metadata.
- **retriever**: API-oriented retrieval + answer service.
- **webui**: very small React chat UI that talks to retriever APIs.

## Documentation

Detailed documentation (architecture, setup details, internals) has been moved to:
- **`DOCUMENTATION.md`**

## Implemented APIs (backend step 1)

- `POST /api/prompt`: send user prompt and receive answer + evidence severity.
- `GET /api/status`: get basic system/readiness status.
- `GET /api/files`: list embeddable files and embedding coverage.
- `GET /healthz`: lightweight liveness check.

## WebUI (frontend step 2)

The web UI is intentionally minimal for now:
- message list (chat-like)
- prompt input + send button
- status badges for retriever, embedding state, and embedded file count

## Quick start

```bash
docker compose up -d qdrant embedder retriever webui
```

- Retriever API: `http://localhost:3000`
- Web UI: `http://localhost:5173`

## Example API calls

```bash
curl http://localhost:3000/api/status
curl http://localhost:3000/api/files
curl -X POST http://localhost:3000/api/prompt \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"What does the firewall document say about IPS?","sessionId":"demo"}'
```
