# DEVELOPERS.md

Maintainer and contributor guide for `local-rag-system`.

## Repository layout

```text
.
├── backend-api.js            # Frontend-facing API gateway
├── retriever-api.js          # Chat/retrieval API + prompt orchestration
├── embedder.js               # Background indexing worker
├── index.js                  # Terminal/chat runtime entrypoint
├── compose.yml               # Local stack orchestration
├── Dockerfile                # Shared Node service image (role-driven startup)
├── package.json              # Dependencies + scripts
│
├── src/
│   ├── assistant-modes.js    # Assistant mode definitions + refine chain prompts
│   ├── guardrails.js         # Guardrails loading + system prompt layer builders
│   ├── messages.js           # RAG context packaging + response helper messages
│   ├── personalization.js    # Personalization options and instruction helpers
│   ├── state-store.js        # Postgres persistence layer
│   ├── runtime-config.js     # Runtime config parsing/updating
│   ├── embedding-service.js  # Embedding + Qdrant interactions
│   └── ...
│
├── webui/
│   ├── index.html
│   ├── app.js
│   ├── panel-content.js
│   ├── utils.js
│   ├── chat-export.js
│   └── styles.css
│
├── README.md
├── DOCUMENTATION.md
├── PROMPTS.md
├── PROMPTBUILDING.md
├── CHANGELOG.md
└── data/
```

## Service boundaries

### `backend-api.js`
- Stable public API surface for WebUI.
- Proxies prompt/chat requests to `retriever-api`.
- Exposes consolidated status and library management routes.

### `retriever-api.js`
- Core orchestration layer.
- Handles prompt execution, retrieval, assistant mode behavior, chat lifecycle, and personalization.
- Builds final model messages using guardrails + mode + evidence + history + personalization.

### `embedder.js`
- Watches/loops through embeddable files.
- Splits documents and updates vectors in Qdrant.
- Updates shared embed/index status files.

### `src/state-store.js`
- Single source of truth for Postgres persistence interactions.
- Owns SQL/data-shape logic for sessions, chats, messages, settings, and file metadata.

## Prompt architecture map

Use these files when changing model behavior:

- Global safety/rules: `guardrails.md`, `src/guardrails.js`
- Assistant modes/refine chain: `src/assistant-modes.js`
- RAG evidence packaging: `src/messages.js`
- Personalization instruction shaping: `src/personalization.js`
- Assembly/call order: `retriever-api.js`

See also `PROMPTBUILDING.md` for a full walkthrough.

## Compose + container notes

- Node services share one image (`Dockerfile`) and select startup flow via `APP_ROLE`.
- Default retriever role startup is `retriever-api.js`.
- Shared persistent state paths are explicitly mapped in compose:
  - `/app/state/index-state.json`
  - `/app/state/embedding-status.json`

## Development checks

Run before commit:

```bash
npm run lint
node --check webui/app.js webui/panel-content.js webui/utils.js webui/chat-export.js
node --check retriever-api.js src/assistant-modes.js src/messages.js src/guardrails.js src/personalization.js
```
