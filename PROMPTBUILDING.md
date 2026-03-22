# Prompt Building in Local RAG

This document explains how prompts are assembled before they are sent to the chat model, what changes by assistant mode, where personalization is applied, and where to edit each layer.

## 1) High-level pipeline

At `POST /api/prompt`, the retriever pipeline builds the model input in layers:

1. **Guardrails + system policy layers** are loaded.
2. **Assistant-mode system layer** is added (`simple`, `refine`, `thinking`).
3. **Conversation context** (recent history, current prompt, and optional uploaded files) is prepared.
4. **Retrieved evidence package** is built from vector-search results.
5. **Personalization settings** are applied to style/tone instructions.
6. The final message array is sent to the configured chat model client.

Primary orchestration is in `retriever-api.js`.

---

## 2) Prompt layers and where to edit

### A. Global guardrails / policy

- **File(s):**
  - `guardrails.md` (policy text maintained by project)
  - `src/guardrails.js` (loader and system-layer builder)
- **Purpose:** project-wide safety/behavior constraints independent of a specific mode.
- **Change here when:** you want rules that always apply regardless of mode.

### B. Assistant mode behavior

- **File:** `src/assistant-modes.js`
- **Purpose:** mode-specific system instructions and refine-chain prompts.
- **What is defined there:**
  - `ASSISTANT_MODE_DEFINITIONS` for `simple`, `refine`, `thinking`
  - `buildAssistantModeSystemLayer(...)`
  - refine-chain step prompts (`drafting`, `refining`)
- **Change here when:** you want to alter how one mode behaves or add a new mode.

### C. RAG evidence packaging

- **File:** `src/messages.js`
- **Key builder:** `buildRagContextPackage(...)`
- **Purpose:** format retrieved chunks, evidence quality, and user question into a task input block the model can consume.
- **Change here when:** you want different evidence framing, ranking hints, or context text structure.

### D. Personalization

- **File(s):**
  - `src/personalization.js`
  - persistence access through `src/state-store.js`
  - surfaced in runtime flow via `retriever-api.js`
- **Purpose:** session/user-style controls (tone, warmth, enthusiasm, formatting preferences).
- **Change here when:** you add/remove personalization options or change how style instructions are generated.

### E. Runtime prompt assembly and call flow

- **File:** `retriever-api.js`
- **Purpose:** joins all layers, handles refine chaining, and dispatches messages to the model.
- **Change here when:** you need new layer ordering, additional context sources, or different chain orchestration.

---

## 3) Assistant mode differences

## `simple`
- Single-pass answer generation.
- Prioritizes concise, direct answers with grounded claims.
- Best for everyday Q&A.

## `thinking`
- Single-pass mode with stronger decomposition/analysis framing.
- Encourages explicit treatment of trade-offs/uncertainties (without exposing chain-of-thought).
- Best for complex or technical requests.

## `refine`
- Two-step chain:
  1. **Draft pass**: generate a first answer.
  2. **Refine pass**: improve clarity/precision and remove unsupported statements.
- If refine output is empty, runtime fallback keeps draft content to avoid blank final responses.
- Best when you prefer quality polishing over raw speed.

---

## 4) What changes when switching assistant mode

When the active assistant mode changes:

1. A different assistant-mode system prompt is injected.
2. For `refine`, runtime performs two model calls (draft + refine) instead of one.
3. Chain progress state (`drafting`, `refining`, `completed`) is updated for UI feedback.
4. Final response may be post-processed differently (e.g., refine fallback handling).

In short: **same retrieval engine, different reasoning/response orchestration layer**.

---

## 5) Prompt template maintenance checklist

When editing prompt templates:

1. Keep guardrails and mode prompts non-conflicting.
2. Preserve evidence-grounding requirements.
3. Keep “general knowledge must be labeled” behavior aligned across modes.
4. If you change refine instructions, verify both `drafting` and `refining` steps.
5. Run syntax checks:

```bash
npm run lint
node --check retriever-api.js src/assistant-modes.js src/messages.js src/guardrails.js src/personalization.js
```

---

## 6) Related docs

- `PROMPTS.md` – conceptual prompt engineering notes.
- `DOCUMENTATION.md` – broader architecture view.
- `DEVELOPERS.md` – contributor routing guide (where to implement what).
