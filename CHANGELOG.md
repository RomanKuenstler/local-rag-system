# CHANGELOG

## smallimpr1

### Added
- Added a dedicated RAG TUI mode with similarity insights in responses.
- Added `/info` command for system details and then streamlined its output.
- Added `/lib` command to display embedded files and surfaced embeddable extensions in `/info`.
- Added `/config` chat command to show active configuration.
- Added runtime `/config set` updates for retrieval settings.
- Added `/help` command and improved startup guidance after indexing.
- Added `/embed` command for embedding newly added files.
- Added weak-evidence confirmation flow to improve answer reliability.
- Added session chat-history logging support.

### Changed
- Refined clean TUI layout, evidence rendering, and loading feedback.
- Improved TUI viewport behavior and command output UX.
- Fixed TUI sizing/display issues and replaced emoji-heavy output with cleaner symbols.
- Updated Dockerfile to align with refactored `src` module structure.
- Refactored runtime config handling and message helper utilities.

### Notes
- This changelog was compiled from the branch commit history available in the current checkout.
