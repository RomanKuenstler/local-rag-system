# CHANGELOG

### Added
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
