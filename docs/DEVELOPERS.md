# DEVELOPERS.md

Maintainer and contributor guide for `local-rag-system`.

## Repository layout

```text
.
├── apps/
│   ├── backend/
│   │   ├── api.js                 # Frontend-facing API gateway
│   │   └── library-service.js     # Backend-only managed-library persistence helpers
│   ├── retriever/
│   │   ├── api.js                 # Chat/retrieval API + prompt orchestration
│   │   ├── cli.js                 # Terminal chat/debug entrypoint
│   │   └── ui.js                  # CLI-only terminal UI helpers
│   ├── embedder/
│   │   └── worker.js              # Background indexing worker
│   └── webui/
│       ├── app.js
│       ├── panel-content.js
│       ├── utils.js
│       ├── chat-export.js
│       └── styles.css
│
├── shared/
│   ├── src/                       # Cross-service shared runtime modules
│   ├── config/index.js            # Environment + runtime config constants
│   ├── db/index.js                # Postgres setup/health helpers
│   └── prompts/guardrails.md      # Guardrail policy source used by retriever
│
├── compose.yml                    # Local stack orchestration
├── Dockerfile                     # Shared Node service image (APP_ROLE driven)
├── migrations/                    # Postgres schema migration files
├── docs/                          # Architecture + maintainer docs
└── data/                          # Indexable knowledge files
```

## Service boundaries

### `apps/backend/api.js`
- Stable public API surface for WebUI.
- Proxies prompt/chat requests to `apps/retriever/api.js`.
- Exposes consolidated status and library management routes.
- Uses `apps/backend/library-service.js` for backend-specific file metadata writes.

### `apps/retriever/api.js`
- Core orchestration layer.
- Handles prompt execution, retrieval, assistant mode behavior, chat lifecycle, and personalization.
- Builds final model messages using guardrails + mode + evidence + history + personalization.

### `apps/embedder/worker.js`
- Watches/loops through embeddable files.
- Splits documents and updates vectors in Qdrant.
- Updates shared embed/index status files.

### `shared/src/state-store.js`
- Single source of truth for Postgres persistence interactions.
- Owns SQL/data-shape logic for sessions, chats, messages, settings, and file metadata.

## Prompt architecture map

Use these files when changing model behavior:

- Global safety/rules: `shared/prompts/guardrails.md`, `shared/src/guardrails.js`
- Assistant modes/refine chain: `shared/src/assistant-modes.js`
- RAG evidence packaging: `shared/src/messages.js`
- Personalization instruction shaping: `shared/src/personalization.js`
- Assembly/call order: `apps/retriever/api.js`

See also `docs/PROMPTBUILDING.md` for a full walkthrough.

## Compose + container notes

- Node services (`backend`, `retriever`, `embedder`) share one base image (`Dockerfile`) and select startup flow via `APP_ROLE`.
- Default retriever role startup is `apps/retriever/api.js`.
- Shared persistent state paths are explicitly mapped in compose:
  - `/app/state/index-state.json`
  - `/app/state/embedding-status.json`

## Development checks

Run before commit:

```bash
npm run lint
node --check apps/webui/app.js apps/webui/panel-content.js apps/webui/utils.js apps/webui/chat-export.js
node --check apps/retriever/api.js apps/retriever/cli.js apps/retriever/ui.js apps/backend/api.js apps/backend/library-service.js apps/embedder/worker.js
```
