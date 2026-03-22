# CHANGELOG

### Chain-impr recap (vs main)

#### Added
- Multi-chat lifecycle in WebUI and APIs, including rename/download/archive/restore/delete workflows.
- Unified Preferences dialog tabs (Settings, Personalization, Info, Archive, Help).
- Header assistant-mode selector with frontend chain-stage feedback for refine mode.
- EPUB ingestion support across upload/embedding flows.
- CSV prompt attachment support in WebUI prompt uploads.

#### Changed
- Refined assistant-mode prompting and chain behavior (including updated refine prompt steps and global-layer adjustments).
- Improved frontend handling for refine-mode pending states and chain-stage transitions.
- Temporarily disabled selecting `thinking` assistant mode in UI while keeping it visible.
- Performed broader frontend helper extraction/refactors (`chat-export`, attachment validation rules, personalization rendering flow).

#### Fixed
- Empty final-pass refine responses no longer disappear in chat; draft fallback is used when needed.
- Multiple EPUB parser reliability edge cases (XHTML handling, sparse chapter extraction, OPF path handling, cleanup behavior).

### Added
- Added `DEVELOPERS.md` with a maintainer-focused, detailed folder/file map and implementation guide.
- Added chat export helper module `webui/chat-export.js` to keep frontend export/download logic modular.
- Added a visible **Attach** action in the WebUI normal chat composer so prompt uploads are clearly discoverable.
- Added embedding readiness status tracking via a shared status file so retriever can determine whether indexing is complete.
- Added `DOCUMENTATION.md` with the previous full project documentation content.
- Added a dedicated RAG TUI mode with similarity insights in responses.
- Added `/info` command for system details and then streamlined its output.
- Added `/lib` command to display embedded files and surfaced embeddable extensions in `/info`.
- Added `/config` chat command to show active configuration.
- Added runtime `/config set` updates for retrieval settings.
- Added `/help` command and improved startup guidance after indexing.
- Added `/embed` command for embedding newly added files.
- Added weak-evidence confirmation flow to improve answer reliability.
- Added session chat-history logging support.
- Added `/upload <prompt>` command for one-time prompt attachments from `./upload` with `.md`/`.txt`/`.html`/`.htm`/`.pdf` validation and auto-consume behavior after use.
- Mapped `./upload` into the retriever container (`/app/upload`) so host-side files are immediately available to `/upload`.

### Changed
- Temporarily disabled selecting `thinking` assistant mode in both the chat-header assistant mode dropdown and the Preferences → Personalization assistant mode list, while still showing it in the UI.
- Refactored WebUI assistant-mode availability checks to use shared helper logic and centralized disabled-mode configuration.
- Removed `wishlist.md` from the repository.
- Refactored WebUI chat export/download logic out of `webui/app.js` into reusable helper functions.
- Updated README and DOCUMENTATION to include current chat lifecycle features (rename/download/archive flows) and developer docs pointer.
- Expanded `/info` system details to include Postgres connection target and local state-file paths.
- Updated WebUI info parsing/grouping so the info dialog surfaces Storage + State details (including Postgres).
- Refactored database connection config to reuse shared config exports.
- Updated README and DOCUMENTATION to reflect the Postgres-backed state layer and richer `/info` dialog.
- Refactored WebUI prompt-attachment handling into shared validation rules and helper functions for maintainability.
- Updated README and DOCUMENTATION usage guidance for WebUI prompt attachments.
- Retriever now blocks user prompts until embedder status is `ready`, with clear waiting/error guidance messages.
- Updated `compose.yml` so `retriever` depends on `embedder` and both services share `EMBEDDING_STATUS_FILE`.
- Split documentation: `README.md` is now concise, with detailed guidance moved to `DOCUMENTATION.md`.
- Refined clean TUI layout, evidence rendering, and loading feedback.
- Improved TUI viewport behavior and command output UX.
- Fixed TUI sizing/display issues and replaced emoji-heavy output with cleaner symbols.
- Updated Dockerfile to align with refactored `src` module structure.
- Refactored runtime config handling and message helper utilities.

### Notes
- This changelog was compiled from the branch commit history available in the current checkout.
