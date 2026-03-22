# DEVELOPERS.md

This file is for maintainers/contributors who need a practical map of the codebase.

---

## 1) Repository layout (what lives where)

```text
.
├── backend-api.js            # Public API gateway/orchestrator (webui talks to this)
├── retriever-api.js          # Main chat + retrieval HTTP service
├── embedder.js               # Indexing worker entrypoint
├── index.js                  # Retriever runtime entrypoint
├── compose.yml               # Local docker-compose stack
├── package.json              # Node deps + lint/check scripts
│
├── src/                      # Shared backend modules (db, state, messages, config, etc.)
│   ├── db.js
│   ├── state-store.js
│   ├── embedding-service.js
│   ├── document-processing.js
│   ├── runtime-config.js
│   ├── messages.js
│   ├── assistant-modes.js
│   ├── profiles.js
│   ├── library-service.js
│   └── ...
│
├── webui/                    # Browser UI (React from ESM CDN + plain CSS)
│   ├── index.html
│   ├── app.js                # Main UI composition + state + handlers
│   ├── panel-content.js      # Renderers for dialog/panel content
│   ├── utils.js              # UI helper functions/constants
│   ├── chat-export.js        # Chat export/download helper utilities
│   └── styles.css            # Global UI styling
│
├── data/                     # Embeddable source documents
├── upload/                   # Optional prompt-attachment staging area
│
├── README.md                 # Quickstart + concise feature overview
├── DOCUMENTATION.md          # Beginner-friendly conceptual documentation
├── CHANGELOG.md              # Human-readable change notes
└── DEVELOPERS.md             # (this file)
```

---

## 2) Service boundaries

### `backend-api.js`
- Purpose: stable frontend-facing API.
- Main job:
  - proxy chat/retriever requests to `retriever-api`,
  - handle library-file operations via `src/library-service.js`,
  - expose consolidated `/api/status`.
- If the WebUI needs a new endpoint, add proxy handling here (unless endpoint is backend-only).

### `retriever-api.js`
- Purpose: chat lifecycle + prompt handling + retrieval + runtime command endpoints.
- Owns endpoints like:
  - `/api/prompt`
  - `/api/chats` + `/api/chats/:chatId` (switch/archive/activate/rename/delete)
  - `/api/chats/:chatId/download`
  - `/api/messages`
- Uses `src/state-store.js` for persistent chat/session/message metadata.

### `src/state-store.js`
- DB abstraction layer for:
  - sessions/chats/messages lifecycle,
  - settings/runtime state in Postgres.
- Add/adjust SQL and data-shape logic here first, then wire handlers in retriever/backend.

### `webui/`
- UI is intentionally lightweight (no build step, CDN React/ReactDOM).
- `app.js` is still the main coordinator; keep pushing pure helpers to separate modules
  (`utils.js`, `chat-export.js`, etc.) as features grow.

---

## 3) Where to change things (feature routing guide)

- **Add new chat action** (UI + backend):
  1. Add action button/menu UI in `webui/app.js` and style in `webui/styles.css`.
  2. Add/extend API route in `retriever-api.js`.
  3. If DB state changes are needed, update `src/state-store.js`.
  4. Ensure proxying is available in `backend-api.js`.

- **Add downloadable/export endpoint**:
  1. Implement exporter in `retriever-api.js`.
  2. Proxy endpoint in `backend-api.js`.
  3. Add client download trigger in `webui/app.js` (or helper module).

- **Adjust dialog/panel rendering**:
  - Primary state and tab flow: `webui/app.js`.
  - Rendering helpers for info/config/help/personalization: `webui/panel-content.js`.

- **Change retrieval/runtime behavior**:
  - Usually `retriever-api.js` + `src/messages.js` + `src/runtime-config.js`.

---

## 4) Working conventions

- Keep HTTP handlers thin; move persistence logic to `src/state-store.js`.
- Prefer pure helper extraction from `webui/app.js` when adding repeated logic.
- Preserve API response shape compatibility when possible.
- Run static checks before commit:
  - `npm run lint`
  - `node --check webui/app.js webui/panel-content.js webui/utils.js`

---

## 5) Current notable UI behavior

- Chat list supports actions: rename, download, archive, delete.
- Preferences includes Archive tab with archived chat management.
- New chat starts as **volatile** in frontend and is persisted on first successful send.
- Chat download uses backend export endpoint, with frontend fallback export composition.
- Assistant mode options are shown in both the chat header menu and Preferences → Personalization; `thinking` is intentionally displayed but temporarily disabled in both places.

---

## 6) Chain-impr branch recap (vs main)

Major implementation themes completed on this branch:

- **Assistant mode evolution**
  - Added header-level assistant mode selector in chat view.
  - Added refine-chain stage UI feedback (`drafting` / `refining`) and pending-text updates.
  - Updated refine mode prompt-chain behavior and fallback handling when final output is empty.

- **Chat lifecycle and exports**
  - Added persisted multi-chat lifecycle with rename, archive, activate, delete, and download flows.
  - Added dedicated frontend chat export helper module and backend export endpoint integration.

- **Content/ingestion pipeline**
  - Added `.epub` support for embedding and upload flows.
  - Hardened EPUB parsing against sparse chapter markup, XHTML media types, nested OPF paths, and cleanup edge cases.
  - Added `.csv` support for prompt attachments while narrowing unsupported attachment types.

- **UI + docs cleanup**
  - Consolidated Preferences dialog behavior and personalization rendering.
  - Performed ongoing frontend helper extraction/refactors to reduce logic duplication.
  - Updated README / DOCUMENTATION / DEVELOPERS / CHANGELOG to reflect current behavior.
