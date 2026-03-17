# Local RAG AI System

A local, containerized Retrieval-Augmented Generation (RAG) system for experimenting with document indexing, vector search, and grounded chat responses.

## What this project is

This project runs three services with Docker Compose:
- **embedder**: continuously indexes files from `./data` into vectors.
- **qdrant**: stores embeddings and metadata.
- **retriever**: interactive terminal assistant that retrieves context from Qdrant and answers with a local chat model.

## Documentation

Detailed documentation (architecture, full command list, setup details, internals) has been moved to:
- **`DOCUMENTATION.md`**

## System abilities (summary)

- Retrieval-augmented chat over local documents.
- Background indexing by a dedicated embedder container.
- Runtime retrieval tuning via chat commands (for supported options).
- One-time prompt attachments via `/upload <prompt>` from `./upload`.
- Evidence quality signals and weak-evidence confirmation flow.
- Session history logging.
- Prompt gating: user prompts are blocked until embedding status is **ready**.

## Quick start

```bash
docker compose up -d qdrant embedder retriever
```

Open the retriever UI:

```bash
docker compose attach retriever
```

## Basic use

1. Put source files into `./data`.
2. Wait for embedder indexing to finish (`docker compose logs -f embedder`).
3. Ask questions in the retriever terminal.
4. Use `/help` to view available commands.
