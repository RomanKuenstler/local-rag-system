# CHANGELOG

## 2026-03-22 (service-boundary cleanup)

### Refactor
- Moved backend-only managed library helpers from `shared/src/library-service.js` to `apps/backend/library-service.js`.
- Moved retriever CLI-only terminal UI helpers from `shared/src/ui.js` to `apps/retriever/ui.js`.
- Updated service imports so backend/retriever no longer depend on non-shared helpers from `shared/src`.

### Documentation refresh
- Updated `README.md`, `docs/DEVELOPERS.md`, `docs/DOCUMENTATION.md`, `docs/PROMPTBUILDING.md`, and `docs/NEXTSTEPS.md` to reflect the current `apps/` + `shared/` structure and current file paths.

## 2026-03-22

### Refactor
- Deduplicated assistant-mode prompt templates by extracting shared evidence rules and a shared refine-draft prompt block in `src/assistant-modes.js`.
- Kept refine draft/refine chain behavior equivalent while removing duplicated string content and fixing numbering/formatting consistency.

### Container and compose cleanup
- Updated base `Dockerfile` role command so `APP_ROLE=retriever` starts `retriever-api.js` by default.
- Simplified `compose.yml` by removing redundant `command` overrides for backend/retriever services (image role startup now used directly).
- Added explicit shared state file environment values in compose for both retriever and embedder:
  - `INDEX_STATE_FILE=/app/state/index-state.json`
  - `EMBEDDING_STATUS_FILE=/app/state/embedding-status.json`

### Documentation refresh
- Rewrote `README.md` as a concise quickstart and documentation map.
- Reworked `DEVELOPERS.md` with current file map, service boundaries, and prompt-architecture routing notes.
- Added `PROMPTBUILDING.md` with end-to-end prompt-building internals (guardrails, mode switching, personalization, refine-chain behavior, and change locations).
- Updated `DOCUMENTATION.md` structure map to include `PROMPTBUILDING.md`.
