# DEVELOPERS.md

Maintainer and contributor guide for `local-rag-system`.

## 1) Repository map

```text
.
├── apps/
│   ├── backend/
│   │   ├── api.js                 # public API + auth/session + admin + orchestration
│   │   ├── request-dispatcher.js  # route matcher/dispatcher for backend HTTP server
│   │   ├── library-service.js     # managed-library persistence helpers
│   │   └── user-bootstrap.js      # sync/bootstrap users from config file
│   ├── retriever/
│   │   ├── api.js                 # retrieval + prompt/chat orchestration API
│   │   ├── request-dispatcher.js  # retriever route dispatcher
│   │   ├── cli.js                 # terminal chat/debug entrypoint
│   │   ├── ui.js                  # CLI rendering integration
│   │   └── ui-helpers.js          # CLI helper utilities
│   ├── embedder/
│   │   ├── worker.js              # indexing + embedding loop
│   │   └── health-server.js       # embedder status HTTP endpoint
│   ├── ocr-scanner/
│   │   └── worker.py              # OCR service
│   └── webui/
│       ├── app.js                 # browser app entry
│       ├── api-client.js          # backend API client wrapper
│       ├── app-shared.js          # shared webui constants/helpers
│       ├── panel-content.js       # panel rendering logic
│       ├── chat-export.js         # export helpers
│       ├── utils.js               # utility helpers
│       ├── styles.css             # styling
│       └── index.html
│
├── shared/
│   ├── src/                       # cross-service runtime modules
│   ├── config/index.js            # env + runtime config constants
│   ├── db/index.js                # postgres readiness/migration helpers
│   └── prompts/                   # guardrails + assistant + personalization prompt templates
│
├── migrations/                    # postgres schema changes
├── compose.yml                    # service orchestration + model bindings
├── Dockerfile                     # shared Node image (APP_ROLE startup)
└── docs/                          # architecture and contributor docs
```

---

## 2) Service boundaries (important)

Keep responsibility ownership explicit:

- `apps/backend/*`
  - owns public entrypoint concerns: auth/session, admin, managed-library APIs, upstream proxying.
- `apps/retriever/*`
  - owns retrieval/chat/prompt composition, assistant behavior, personalization orchestration.
- `apps/embedder/*`
  - owns indexing loop and embedding lifecycle.
- `apps/ocr-scanner/*`
  - owns OCR + extraction logic.
- `shared/*`
  - only reusable modules that are genuinely cross-service.

When you add/relocate behavior, update **code + compose + docs** together.

---

## 3) High-impact modules and what they own

- `shared/src/state-store.js`
  - canonical persistence access layer for users/sessions/chats/messages/settings/file metadata.
- `shared/src/guardrails.js`
  - guardrail loading and prompt-layer assembly.
- `shared/src/assistant-modes.js`
  - assistant mode templates/refine-chain behavior.
- `shared/src/messages.js`
  - RAG evidence packaging and helper messaging.
- `shared/src/personalization.js`
  - personalization instruction shaping.
- `shared/src/embedding-service.js`
  - embedding + chunk extraction helpers and Qdrant client access.
- `shared/src/document-processing.js`
  - extension-aware text normalization/parsing helpers.

---

## 4) Safe change strategy

Before editing:

1. Identify ownership (backend vs retriever vs embedder vs shared).
2. Verify API contracts used by `apps/webui/api-client.js` and backend dispatchers.
3. Preserve existing route compatibility unless intentionally versioning.

When changing prompt behavior:

- Read `docs/PROMPTBUILDING.md` first.
- Touch the minimal prompt-related modules needed.
- Re-check assistant mode behavior and evidence formatting.

When changing indexing/retrieval behavior:

- Keep embedder pipeline and retriever query assumptions aligned.
- Validate file metadata/tag/filter flows still match state-store contracts.

---

## 5) Common checks

Run before commit:

```bash
npm run lint
node --check apps/webui/app.js apps/webui/panel-content.js apps/webui/utils.js apps/webui/chat-export.js apps/webui/api-client.js apps/webui/app-shared.js
node --check apps/retriever/api.js apps/retriever/cli.js apps/retriever/ui.js apps/retriever/ui-helpers.js apps/backend/api.js apps/backend/library-service.js apps/backend/request-dispatcher.js apps/backend/user-bootstrap.js apps/embedder/worker.js apps/embedder/health-server.js
```

Optional runtime sanity:

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=100 backend retriever embedder ocr-scanner
```

---

## 6) Documentation maintenance policy

Any PR that changes architecture, APIs, service boundaries, or core behavior should update:

- `README.md` (user-facing quick map)
- `docs/DOCUMENTATION.md` (architecture + runtime flow)
- `docs/DEVELOPERS.md` (maintainer map)
- `docs/CHANGELOG.md` (dated entry)
