# Local RAG AI System

A local, containerized Retrieval-Augmented Generation (RAG) system for experimenting with document indexing, vector search, and grounded responses.

## What this project is

This project runs three services with Docker Compose:
- **embedder**: continuously indexes files from `./data` into vectors.
- **qdrant**: stores embeddings and metadata.
- **retriever**: API-oriented retrieval + answer service for client applications (next step: Web UI).

## Documentation

Detailed documentation (architecture, setup details, internals) has been moved to:
- **`DOCUMENTATION.md`**

## Implemented APIs (step 1)

- `POST /api/prompt`: send user prompt and receive answer + evidence severity.
- `GET /api/status`: get basic system/readiness status.
- `GET /api/files`: list embeddable files and embedding coverage.
- `GET /healthz`: lightweight liveness check.

## Quick start

```bash
docker compose up -d qdrant embedder retriever
```

The retriever API is exposed on `http://localhost:3000`.

## Example API calls

```bash
curl http://localhost:3000/api/status
curl http://localhost:3000/api/files
curl -X POST http://localhost:3000/api/prompt \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"What does the firewall document say about IPS?","sessionId":"demo"}'
```
