import http from "http";
import path from "path";
import crypto from "crypto";
import {
  APP_NAME,
  APP_VERSION,
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  COLLECTION_NAME,
  CONTENT_PATH,
  COSINE_LIMIT,
  EMBEDDABLE_EXTENSIONS,
  HISTORY_MESSAGES,
  INDEX_SCHEMA_VERSION,
  INDEX_STATE_FILE,
  MAX_SIMILARITIES,
  MAX_EMBEDDING_CHARS,
  MIN_SIMILARITIES,
  EMBEDDING_STATUS_FILE,
  DEFAULT_FILE_TAG,
  PDF_MIN_EXTRACTED_CHARS,
  POSTGRES_DB,
  POSTGRES_HOST,
  POSTGRES_PORT,
  POSTGRES_USER,
  QDRANT_URL,
  CHAT_HISTORY_DIR,
  validateRetrievalConfig,
} from "../../shared/config/index.js";
import { buildSystemPromptLayers, loadGuardrails } from "../../shared/src/guardrails.js";
import { createChatModel } from "../../shared/src/model-clients.js";
import {
  DEFAULT_ASSISTANT_MODE,
  buildRefineFinalPassMessages,
  getRefineChainSystemPrompt,
  isAssistantModeSupported,
  listAssistantModes,
  normalizeAssistantMode,
} from "../../shared/src/assistant-modes.js";
import {
  buildActiveConfigMessage,
  buildHelpMessage,
  buildSystemInfoMessage,
  buildRagContextPackage,
  createSimilarityDetails,
  formatBytes,
  getEvidenceQuality,
} from "../../shared/src/messages.js";
import {
  createEmbeddingsModel,
  createQdrantClient,
  fileToChunks,
  readEmbeddableFiles,
  readEmbeddingStatus,
} from "../../shared/src/embedding-service.js";
import { ensureDatabaseReady } from "../../shared/db/index.js";
import {
  addChatMessage,
  createChat,
  deleteChat,
  ensureSessionExists,
  getRuntimeConfigState,
  getUserIdForSession,
  getUserSetting,
  getIndexStateMap,
  getChatTagFilterState,
  initializeRuntimeConfigDefaults,
  getSessionPersonalizationSettings,
  getSessionSetting,
  getSessionTagFilterState,
  initializeStateDefaults,
  listSessionChats,
  listChatMessages,
  listRecentPromptHistory,
  listFileMetadata,
  listDisabledManagedLibraryFilePathsForUser,
  listTagsForFilePathMap,
  updateFileTags,
  resolveSessionChatId,
  setSessionActiveChat,
  updateChatName,
  updateChatTagFilterState,
  updateSetting,
  updateUserSetting,
  updateSessionPersonalizationSettings,
  updateSessionSetting,
  updateSessionTagFilterState,
  updateChatStatus,
} from "../../shared/src/state-store.js";
import {
  normalizeIndexableTextByExtension,
} from "../../shared/src/document-processing.js";
import { createRuntimeConfigManager, parseConfigSetCommand } from "../../shared/src/runtime-config.js";

validateRetrievalConfig();

const PORT = parseInt(process.env.RETRIEVER_API_PORT || "3000", 10);
const HOST = process.env.RETRIEVER_API_HOST || "0.0.0.0";
const initialAssistantMode = normalizeAssistantMode(process.env.ASSISTANT_MODE || DEFAULT_ASSISTANT_MODE);
const SUPPORTED_UI_MODES = new Set(["clean", "rag"]);
const initialUiMode = SUPPORTED_UI_MODES.has(String(process.env.WEB_UI_MODE || "").trim().toLowerCase())
  ? String(process.env.WEB_UI_MODE).trim().toLowerCase()
  : "clean";

const guardrailsText = loadGuardrails();

const chatModel = createChatModel();

const embeddingsModel = createEmbeddingsModel();
const qdrant = createQdrantClient();
const OCR_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const UPLOADABLE_EXTENSIONS = new Set([".md", ".txt", ".html", ".htm", ".pdf", ".csv", ...OCR_IMAGE_EXTENSIONS]);
const MAX_PROMPT_UPLOAD_FILES = 3;
const MAX_REQUEST_BODY_BYTES = Number.parseInt(process.env.MAX_REQUEST_BODY_BYTES || String(10 * 1024 * 1024), 10);
const OCR_SCANNER_BASE_URL =
  String(process.env.OCR_SCANNER_BASE_URL || "http://ocr-scanner:3300").trim() || "http://ocr-scanner:3300";
const pendingWeakAnswers = new Map();
const assistantChainProgressBySession = new Map();
const assistantChainProgressClearTimers = new Map();
const { runtimeConfig, setRuntimeConfigValue } = createRuntimeConfigManager({
  historyMessages: HISTORY_MESSAGES,
  maxSimilarities: MAX_SIMILARITIES,
  minSimilarities: MIN_SIMILARITIES,
  cosineLimit: COSINE_LIMIT,
});

function stripAnsi(text) {
  return String(text || "").replace(/\u001b\[[0-9;]*m/g, "");
}

function getPendingWeakAnswerKey(sessionId, chatId) {
  return `${sessionId}::${chatId}`;
}

function generateChatName() {
  return `chat-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizePrompt(input) {
  return String(input || "").trim();
}

async function getSessionUiMode(sessionId) {
  const userId = await getUserIdForSession(sessionId);
  return getUserSetting({
    userId,
    settingName: "ui_mode",
    fallbackValue: initialUiMode,
  });
}

function extractAssistantTextContent(response) {
  const rawContent = response?.content;
  if (typeof rawContent === "string") {
    return rawContent.trim();
  }

  if (Array.isArray(rawContent)) {
    const textSegments = rawContent
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .filter(Boolean);

    return textSegments.join("\n").trim();
  }

  return "";
}

function finalizeAssistantAnswer(response, { fallbackText = "" } = {}) {
  const extracted = extractAssistantTextContent(response)
    || String(response?.additional_kwargs?.output_text || "").trim()
    || String(response?.additional_kwargs?.text || "").trim()
    || String(response?.text || "").trim();
  if (extracted) {
    return extracted;
  }
  if (fallbackText) {
    return String(fallbackText).trim();
  }
  return "I’m sorry—I couldn’t generate a complete answer this time. Please try again.";
}

function setAssistantChainProgress(sessionId, progress) {
  if (!sessionId) return;
  const existingTimer = assistantChainProgressClearTimers.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    assistantChainProgressClearTimers.delete(sessionId);
  }
  const previousProgress = assistantChainProgressBySession.get(sessionId);
  const normalizedStage = String(progress?.stage || "").trim().toLowerCase();
  const previousTrail = Array.isArray(previousProgress?.trail) ? previousProgress.trail : [];
  const shouldResetTrail = normalizedStage === "searching"
    || previousProgress?.active !== true
    || previousProgress?.mode !== progress?.mode;
  const nextTrail = shouldResetTrail ? [] : [...previousTrail];
  if (normalizedStage && nextTrail[nextTrail.length - 1] !== normalizedStage) {
    nextTrail.push(normalizedStage);
  }

  assistantChainProgressBySession.set(sessionId, {
    ...progress,
    trail: nextTrail,
    updatedAt: new Date().toISOString(),
  });
}

function clearAssistantChainProgress(sessionId) {
  if (!sessionId) return;
  const existingTimer = assistantChainProgressClearTimers.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    assistantChainProgressClearTimers.delete(sessionId);
  }
  assistantChainProgressBySession.delete(sessionId);
}

function markAssistantChainCompleted(sessionId, mode) {
  if (!sessionId) return;
  setAssistantChainProgress(sessionId, {
    active: false,
    mode,
    stage: "completed",
  });
  const timer = setTimeout(() => {
    clearAssistantChainProgress(sessionId);
  }, 15000);
  assistantChainProgressClearTimers.set(sessionId, timer);
}

async function normalizeUploadedPromptFile(file) {
  const rawName = String(file?.name || "").trim();
  if (!rawName) {
    return { ok: false, reason: "missing_name" };
  }

  const name = path.basename(rawName);
  const extension = path.extname(name).toLowerCase();
  if (!UPLOADABLE_EXTENSIONS.has(extension)) {
    return { ok: false, reason: "unsupported_extension", name };
  }

  let buffer;
  try {
    if (typeof file?.contentBase64 === "string" && file.contentBase64.length > 0) {
      buffer = Buffer.from(file.contentBase64, "base64");
    } else if (typeof file?.content === "string" && file.content.length > 0) {
      buffer = Buffer.from(file.content, "utf8");
    } else {
      return { ok: false, reason: "missing_content", name };
    }
  } catch {
    return { ok: false, reason: "invalid_encoding", name };
  }

  let content = "";
  if (extension === ".pdf") {
    const ocrResult = await requestPromptPdfOcr({
      name,
      contentBase64: buffer.toString("base64"),
    });
    if (!ocrResult.ok) {
      return { ok: false, reason: "ocr_failed", name, detail: ocrResult.error };
    }
    content = ocrResult.text;
  } else if (OCR_IMAGE_EXTENSIONS.has(extension)) {
    const ocrResult = await requestPromptImageOcr({
      name,
      extension,
      contentBase64: buffer.toString("base64"),
    });
    if (!ocrResult.ok) {
      return { ok: false, reason: "ocr_failed", name, detail: ocrResult.error };
    }
    content = ocrResult.text;
  } else {
    content = normalizeIndexableTextByExtension(buffer.toString("utf8"), extension);
  }

  if (!content) {
    return { ok: false, reason: "empty_content", name };
  }

  return {
    ok: true,
    file: {
      name,
      content,
    },
  };
}

async function requestPromptPdfOcr({ name, contentBase64 }) {
  if (!contentBase64) {
    return { ok: false, text: "", error: "missing_pdf_content" };
  }

  try {
    const response = await fetch(`${OCR_SCANNER_BASE_URL}/ocr/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_type: "prompt_pdf",
        pdf_base64: contentBase64,
        minimum_extracted_chars: PDF_MIN_EXTRACTED_CHARS,
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      const errorCode = String(errorPayload?.error_code || `ocr_http_${response.status}`);
      const errorMessage = String(errorPayload?.error || "").trim();
      console.warn(
        `[retriever] OCR request failed for prompt attachment ${name}: HTTP ${response.status} ${errorCode} ${errorMessage.slice(0, 240)}`
      );
      return { ok: false, text: "", error: errorCode };
    }

    const payload = await response.json();
    if (payload?.status !== "success") {
      const errorCode = String(payload?.error_code || "ocr_unknown_error");
      console.warn(`[retriever] OCR returned non-success status for ${name}: ${errorCode}`);
      return { ok: false, text: "", error: errorCode };
    }
    const text = typeof payload?.text === "string" ? payload.text : "";
    if (!text.trim()) {
      return { ok: false, text: "", error: "ocr_empty_text" };
    }
    const extractionMode = String(payload?.extraction_details?.mode || "unknown");
    const quality =
      payload?.extraction_details?.ocr_quality?.quality
      || payload?.extraction_details?.quality?.quality
      || "unknown";
    console.log(
      `[retriever] OCR text extracted for prompt attachment ${name} (${text.length} chars, mode=${extractionMode}, quality=${quality})`
    );
    return { ok: true, text, error: null };
  } catch (error) {
    console.warn(`[retriever] OCR request error for prompt attachment ${name}: ${error.message}`);
    return { ok: false, text: "", error: "ocr_request_error" };
  }
}

async function requestPromptImageOcr({ name, extension, contentBase64 }) {
  if (!contentBase64) {
    return { ok: false, text: "", error: "missing_image_content" };
  }

  try {
    const response = await fetch(`${OCR_SCANNER_BASE_URL}/ocr/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_type: "prompt_image",
        image_base64: contentBase64,
        image_extension: extension,
        minimum_extracted_chars: PDF_MIN_EXTRACTED_CHARS,
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      const errorCode = String(errorPayload?.error_code || `ocr_http_${response.status}`);
      const errorMessage = String(errorPayload?.error || "").trim();
      console.warn(
        `[retriever] OCR request failed for prompt image attachment ${name}: HTTP ${response.status} ${errorCode} ${errorMessage.slice(0, 240)}`
      );
      return { ok: false, text: "", error: errorCode };
    }

    const payload = await response.json();
    if (payload?.status !== "success") {
      const errorCode = String(payload?.error_code || "ocr_unknown_error");
      console.warn(`[retriever] OCR returned non-success status for prompt image ${name}: ${errorCode}`);
      return { ok: false, text: "", error: errorCode };
    }

    const text = typeof payload?.text === "string" ? payload.text : "";
    const usefulText = payload?.useful_text !== false && payload?.extraction_status !== "no_useful_text";
    if (!text.trim() || !usefulText) {
      return { ok: false, text: "", error: "ocr_no_useful_text" };
    }
    const extractionMode = String(payload?.extraction_details?.mode || "unknown");
    const quality = String(payload?.extraction_details?.quality?.quality || "unknown");
    console.log(
      `[retriever] OCR text extracted for prompt image attachment ${name} (${text.length} chars, mode=${extractionMode}, quality=${quality})`
    );
    return { ok: true, text, error: null };
  } catch (error) {
    console.warn(`[retriever] OCR request error for prompt image attachment ${name}: ${error.message}`);
    return { ok: false, text: "", error: "ocr_request_error" };
  }
}

async function buildUploadedPromptContext(uploadedFiles) {
  const normalizedUploadedFiles = [];
  const skippedFiles = [];

  for (const file of uploadedFiles) {
    const normalized = await normalizeUploadedPromptFile(file);
    if (!normalized.ok) {
      const skippedName = normalized.name || "unnamed-file";
      const skippedReason = normalized.reason || "invalid_file";
      if (skippedReason === "ocr_failed" && normalized.detail) {
        skippedFiles.push(`${skippedName} (ocr_failed:${normalized.detail})`);
      } else {
        skippedFiles.push(skippedName);
      }
      continue;
    }
    normalizedUploadedFiles.push(normalized.file);
  }

  if (normalizedUploadedFiles.length === 0) {
    return {
      hasUploadedContext: false,
      uploadedFiles: [],
      skippedFiles,
      uploadedContext: "",
    };
  }

  const uploadedContext = normalizedUploadedFiles
    .map((file) => [`UPLOAD FILE: ${file.name}`, file.content.trim()].join("\n"))
    .join("\n\n---\n\n");

  return {
    hasUploadedContext: true,
    uploadedFiles: normalizedUploadedFiles,
    skippedFiles,
    uploadedContext,
  };
}




function buildWebConfigView() {
  return {
    sections: [
      {
        id: "retrieval",
        label: "Retrieval",
        entries: [
          { key: "history messages", value: runtimeConfig.historyMessages, editable: true },
          { key: "max similarities", value: runtimeConfig.maxSimilarities, editable: true },
          { key: "min similarities", value: runtimeConfig.minSimilarities, editable: true },
          { key: "cosine limit", value: runtimeConfig.cosineLimit, editable: true },
        ],
      },
      {
        id: "chunking",
        label: "Chunking / Indexing",
        entries: [
          { key: "chunk size", value: CHUNK_SIZE, editable: false },
          { key: "chunk overlap", value: CHUNK_OVERLAP, editable: false },
          { key: "max embedding chars", value: MAX_EMBEDDING_CHARS, editable: false },
          { key: "pdf min extracted chars", value: PDF_MIN_EXTRACTED_CHARS, editable: false },
          { key: "index schema version", value: INDEX_SCHEMA_VERSION, editable: false },
          { key: "state storage", value: "postgres", editable: false },
          { key: "chat history dir", value: CHAT_HISTORY_DIR, editable: false },
        ],
      },
      {
        id: "generation",
        label: "Generation",
        entries: [
          { key: "temperature", value: process.env.OPTION_TEMPERATURE || "0.0", editable: false },
          { key: "top_p", value: process.env.OPTION_TOP_P || "0.5", editable: false },
          { key: "presence penalty", value: process.env.OPTION_PRESENCE_PENALTY || "2.2", editable: false },
        ],
      },
    ],
    help: "Only runtime-changeable entries can be edited without restarting services.",
  };
}

async function buildLibraryInfoMessage() {
  const files = await readEmbeddableFiles();

  if (files.length === 0) {
    return [
      "Library info:",
      `- content path: ${CONTENT_PATH}` ,
      `- embeddable extensions: ${EMBEDDABLE_EXTENSIONS.join(", ")}` ,
      "- files: 0",
      "- total chunks: 0",
    ].join("\n");
  }

  const indexState = await getIndexStateMap();
  const perFile = files.map((file) => ({
    ...file,
    chunkCount: fileToChunks(file).length,
    embedded: indexState[file.relativePath] === file.hash,
  }));

  const totalChunks = perFile.reduce((sum, file) => sum + file.chunkCount, 0);

  const lines = [
    "Library info:",
    `- content path: ${CONTENT_PATH}` ,
    `- embeddable extensions: ${EMBEDDABLE_EXTENSIONS.join(", ")}` ,
    `- files: ${perFile.length}`,
    `- embedded files: ${perFile.filter((file) => file.embedded).length}`,
    `- total chunks: ${totalChunks}`,
    "",
    "Embeddable files:",
  ];

  for (const file of perFile) {
    const modifiedAt = file.lastModified ? new Date(file.lastModified).toISOString() : "n/a";

    lines.push(`- ${file.relativePath}`);
    lines.push(`  size: ${formatBytes(file.size)} (${file.size} bytes)`);
    lines.push(`  chunks: ${file.chunkCount}`);
    lines.push(`  extension: ${file.extension}`);
    lines.push(`  embedded: ${file.embedded ? "yes" : "no"}`);
    lines.push(`  hash: ${file.hash}`);
    lines.push(`  modified: ${modifiedAt}`);
  }

  return lines.join("\n");
}

async function handlePromptCommand(prompt, sessionId, chatId) {
  const normalizedPrompt = prompt.toLowerCase();
  const pendingWeakAnswerKey = getPendingWeakAnswerKey(sessionId, chatId);
  const pendingWeakAnswer = pendingWeakAnswers.get(pendingWeakAnswerKey);

  if (pendingWeakAnswer) {
    if (["/yes", "/y"].includes(normalizedPrompt)) {
      pendingWeakAnswers.delete(pendingWeakAnswerKey);
      return {
        statusCode: 200,
        payload: {
          sessionId,
          answer: pendingWeakAnswer.answer,
          evidenceSeverity: pendingWeakAnswer.evidenceSeverity,
        },
      };
    }

    if (["/no", "/skip"].includes(normalizedPrompt)) {
      pendingWeakAnswers.delete(pendingWeakAnswerKey);
      return {
        statusCode: 200,
        payload: {
          sessionId,
          answer: "Okay, skipped displaying the weak-evidence answer.",
          evidenceSeverity: "weak",
        },
      };
    }

    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: "Please confirm with /yes to show the answer, or /no (or /skip) to hide it.",
        evidenceSeverity: "warn",
        interaction: {
          type: "weak_confirmation",
          pending: true,
        },
      },
    };
  }

  if (normalizedPrompt === "/help" || normalizedPrompt === "?") {
    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: buildHelpMessage(),
        evidenceSeverity: null,
        responseType: "help",
      },
    };
  }

  if (normalizedPrompt === "/info") {
    const userId = await getUserIdForSession(sessionId);
    const currentUiMode = await getSessionUiMode(sessionId);
    const currentAssistantMode = normalizeAssistantMode(await getUserSetting({
      userId,
      settingName: "assistant_mode",
      fallbackValue: initialAssistantMode,
    }));
    const personalizationSettings = await getSessionPersonalizationSettings(sessionId);
    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: buildSystemInfoMessage({
          appName: APP_NAME,
          appVersion: APP_VERSION,
          uiMode: currentUiMode,
          assistantMode: currentAssistantMode,
          personalizationSettings,
          chatModelName: chatModel.model,
          embeddingModelName: embeddingsModel.model,
          qdrantUrl: QDRANT_URL,
          collectionName: COLLECTION_NAME,
          contentPath: CONTENT_PATH,
          embeddableExtensions: EMBEDDABLE_EXTENSIONS,
          chatHistoryDir: CHAT_HISTORY_DIR,
          indexStateFile: INDEX_STATE_FILE,
          embeddingStatusFile: EMBEDDING_STATUS_FILE,
          postgresHost: POSTGRES_HOST,
          postgresPort: POSTGRES_PORT,
          postgresDb: POSTGRES_DB,
          postgresUser: POSTGRES_USER,
        }),
        evidenceSeverity: null,
        responseType: "system_info",
      },
    };
  }

  if (normalizedPrompt === "/personalization") {
    const personalizationSettings = await getSessionPersonalizationSettings(sessionId);
    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: JSON.stringify({
          sessionId,
          note: "Profile switching was removed. Personalization is now session-scoped.",
          settings: personalizationSettings,
        }, null, 2),
        evidenceSeverity: null,
        responseType: "personalization",
      },
    };
  }

  if (normalizedPrompt === "/lib") {
    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: null,
        evidenceSeverity: null,
        responseType: "library_info",
        deferredCommand: "library_info",
      },
    };
  }


  if (normalizedPrompt === "/assistant") {
    const userId = await getUserIdForSession(sessionId);
    const currentAssistantMode = normalizeAssistantMode(await getUserSetting({
      userId,
      settingName: "assistant_mode",
      fallbackValue: initialAssistantMode,
    }));
    const modes = listAssistantModes();
    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: [
          "Assistant modes:",
          ...modes.map((mode) => `- ${mode.id}: ${mode.description}`),
          `Current mode: ${currentAssistantMode}`
        ].join("\n"),
        evidenceSeverity: null,
        responseType: "assistant_mode",
      },
    };
  }

  if (normalizedPrompt === "/mode") {
    const currentUiMode = await getSessionUiMode(sessionId);
    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: [
          "UI modes:",
          "- clean: Clean chat-focused UI without retrieval diagnostics.",
          "- rag: Retrieval-debug UI that includes evidence quality and similarity details.",
          `Current mode: ${currentUiMode}`,
        ].join("\n"),
        evidenceSeverity: null,
        responseType: "ui_mode",
      },
    };
  }

  if (normalizedPrompt.startsWith("/mode ")) {
    const requestedMode = prompt.slice("/mode ".length).trim().toLowerCase();
    if (!SUPPORTED_UI_MODES.has(requestedMode)) {
      return {
        statusCode: 400,
        payload: {
          sessionId,
          error: `Unsupported UI mode: ${requestedMode}`,
          answer: `Unsupported UI mode: ${requestedMode}. Use /mode to list available modes.`,
          evidenceSeverity: "warn",
        },
      };
    }

    const userId = await getUserIdForSession(sessionId);
    await updateUserSetting({ userId, settingName: "ui_mode", value: requestedMode });
    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: `UI mode changed to: ${requestedMode}`,
        evidenceSeverity: "ok",
        responseType: "ui_mode",
      },
    };
  }

  if (normalizedPrompt.startsWith("/assistant ")) {
    const requestedMode = prompt.slice("/assistant ".length).trim().toLowerCase();

    if (!isAssistantModeSupported(requestedMode)) {
      return {
        statusCode: 400,
        payload: {
          sessionId,
          error: `Unsupported assistant mode: ${requestedMode}`,
          answer: `Unsupported assistant mode: ${requestedMode}. Use /assistant to list available modes.`,
          evidenceSeverity: "warn",
        },
      };
    }

    const nextAssistantMode = normalizeAssistantMode(requestedMode);
    const userId = await getUserIdForSession(sessionId);
    await updateUserSetting({ userId, settingName: "assistant_mode", value: nextAssistantMode });

    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: `Assistant mode changed to: ${nextAssistantMode}` ,
        evidenceSeverity: "ok",
        responseType: "assistant_mode",
      },
    };
  }

  if (normalizedPrompt === "/config") {
    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: stripAnsi(buildActiveConfigMessage({
          historyMessages: runtimeConfig.historyMessages,
          maxSimilarities: runtimeConfig.maxSimilarities,
          minSimilarities: runtimeConfig.minSimilarities,
          cosineLimit: runtimeConfig.cosineLimit,
        }, {
          chunkSize: CHUNK_SIZE,
          chunkOverlap: CHUNK_OVERLAP,
          maxEmbeddingChars: MAX_EMBEDDING_CHARS,
          pdfMinExtractedChars: PDF_MIN_EXTRACTED_CHARS,
          indexSchemaVersion: INDEX_SCHEMA_VERSION,
          chatHistoryDir: CHAT_HISTORY_DIR,
          temperature: process.env.OPTION_TEMPERATURE || "0.0",
          topP: process.env.OPTION_TOP_P || "0.5",
          presencePenalty: process.env.OPTION_PRESENCE_PENALTY || "2.2",
        })),
        evidenceSeverity: null,
        responseType: "active_config",
        configView: buildWebConfigView(),
      },
    };
  }

  if (normalizedPrompt.startsWith("/config set ")) {
    const parsed = parseConfigSetCommand(prompt);
    if (!parsed) {
      return {
        statusCode: 400,
        payload: {
          sessionId,
          error: "Invalid config set format",
          answer: "Invalid format. Use: /config set <name> <value> or /config set '<name>'=<value>",
          evidenceSeverity: "warn",
        },
      };
    }

    const update = setRuntimeConfigValue(parsed.configName, parsed.rawValue);
    const runtimeSettingKeyMap = {
      "history messages": "history_messages",
      "max similarities": "max_similarities",
      "min similarities": "min_similarities",
      "cosine limit": "cosine_limit",
    };
    const normalizedConfigName = String(parsed.configName || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (update.ok && runtimeSettingKeyMap[normalizedConfigName]) {
      await updateSetting(runtimeSettingKeyMap[normalizedConfigName], runtimeConfig[{
        "history messages": "historyMessages",
        "max similarities": "maxSimilarities",
        "min similarities": "minSimilarities",
        "cosine limit": "cosineLimit",
      }[normalizedConfigName]], { sessionId });
    }

    return {
      statusCode: update.ok ? 200 : 400,
      payload: {
        sessionId,
        answer: update.message,
        evidenceSeverity: update.ok ? "ok" : "warn",
        responseType: "active_config",
        configView: buildWebConfigView(),
      },
    };
  }

  return null;
}

async function searchKnowledgeBase(prompt, sessionId, chatId) {
  const userQuestionEmbedding = await embeddingsModel.embedQuery(prompt);
  let totalCollectionPoints = runtimeConfig.maxSimilarities;
  try {
    const collectionInfo = await qdrant.getCollection(COLLECTION_NAME);
    const directPointsCount = Number.parseInt(String(collectionInfo?.points_count ?? ""), 10);
    const indexedVectorsCount = Number.parseInt(
      String(collectionInfo?.indexed_vectors_count ?? ""),
      10
    );
    const collectionPointsCount = Number.isFinite(directPointsCount) && directPointsCount > 0
      ? directPointsCount
      : indexedVectorsCount;

    if (Number.isFinite(collectionPointsCount) && collectionPointsCount > 0) {
      totalCollectionPoints = Math.max(collectionPointsCount, runtimeConfig.maxSimilarities);
    }
  } catch (error) {
    console.warn(
      `Unable to read collection size before retrieval; falling back to max similarities (${runtimeConfig.maxSimilarities}). ${error.message}`
    );
  }

  const allCandidateResults = await qdrant.search(COLLECTION_NAME, {
    vector: userQuestionEmbedding,
    limit: totalCollectionPoints,
    with_payload: true,
  });

  const userId = await getUserIdForSession(sessionId);
  const allCandidateSourcePaths = [...new Set(
    allCandidateResults
      .map((result) => String(result?.payload?.source || "").trim())
      .filter(Boolean)
  )];
  const disabledPaths = new Set(await listDisabledManagedLibraryFilePathsForUser(userId, allCandidateSourcePaths));
  const userFilteredCandidates = disabledPaths.size === 0
    ? allCandidateResults
    : allCandidateResults.filter((result) => !disabledPaths.has(String(result?.payload?.source || "").trim()));

  const filteredResults = userFilteredCandidates
    .filter((result) => result.score >= runtimeConfig.cosineLimit)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const resultSourcePaths = [...new Set(
    filteredResults
      .map((result) => String(result?.payload?.source || "").trim())
      .filter(Boolean)
  )];
  const tagsByPath = await listTagsForFilePathMap(resultSourcePaths);
  const selectedResultsWithTags = filteredResults.map((result) => {
    const payload = result?.payload && typeof result.payload === "object" ? result.payload : {};
    const sourcePath = String(payload.source || "").trim();
    const payloadTags = Array.isArray(payload.tags)
      ? payload.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
      : [];
    const resolvedTags = payloadTags.length > 0
      ? payloadTags
      : tagsByPath.get(sourcePath) || [DEFAULT_FILE_TAG];
    return {
      ...result,
      payload: {
        ...payload,
        tags: resolvedTags,
      },
    };
  });

  const normalizedSessionId = String(sessionId || "default-session").trim() || "default-session";
  const normalizedChatId = String(chatId || "").trim();
  const tagFilterState = await getSessionTagFilterState(normalizedSessionId);
  const chatTagFilterState = normalizedChatId
    ? await getChatTagFilterState({ sessionId: normalizedSessionId, chatId: normalizedChatId })
    : { disabledTags: [] };
  const disabledTagSet = new Set([
    (Array.isArray(tagFilterState.disabledTags) ? tagFilterState.disabledTags : [])
      .map((tag) => String(tag || "").trim().toLowerCase())
      .filter(Boolean),
    (Array.isArray(chatTagFilterState.disabledTags) ? chatTagFilterState.disabledTags : [])
      .map((tag) => String(tag || "").trim().toLowerCase())
      .filter(Boolean),
  ].flat());
  const eligibleResults = disabledTagSet.size === 0
    ? selectedResultsWithTags
    : selectedResultsWithTags.filter((result) => {
      const tags = Array.isArray(result?.payload?.tags) ? result.payload.tags : [DEFAULT_FILE_TAG];
      const normalizedTags = tags.map((tag) => String(tag || "").trim().toLowerCase()).filter(Boolean);
      return normalizedTags.every((tag) => !disabledTagSet.has(tag));
    });
  const selectedResultsByTag = eligibleResults.slice(0, runtimeConfig.maxSimilarities);

  const evidenceQuality = getEvidenceQuality(selectedResultsByTag, runtimeConfig.minSimilarities);

  return {
    results: selectedResultsByTag,
    evidenceQuality,
    hasSufficientEvidence: selectedResultsByTag.length >= runtimeConfig.minSimilarities,
    ragContextPackage: buildRagContextPackage({
      results: selectedResultsByTag,
      userMessage: prompt,
      evidenceQuality,
    }),
  };
}

async function getEmbeddingReadiness() {
  const embeddingStatus = await readEmbeddingStatus();

  if (!embeddingStatus) {
    return {
      ready: false,
      message: "Embedding status not found yet. Wait for embedder to complete indexing.",
      status: "missing",
    };
  }

  if (embeddingStatus.status === "ready") {
    return {
      ready: true,
      message: "Embedding is finished and retriever APIs are ready.",
      status: embeddingStatus.status,
    };
  }

  if (embeddingStatus.status === "running") {
    return {
      ready: false,
      message: "Embedding is running. Wait for completion before expecting full retrieval quality.",
      status: embeddingStatus.status,
    };
  }

  return {
    ready: false,
    message: `Embedding status is '${embeddingStatus.status}'.`,
    status: embeddingStatus.status,
  };
}

function json(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let sizeBytes = 0;

    req.on("data", (chunk) => {
      sizeBytes += chunk.length;
      if (sizeBytes > MAX_REQUEST_BODY_BYTES) {
        reject(new Error("Payload too large"));
        return;
      }
      raw += chunk;
    });

    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON payload"));
      }
    });

    req.on("error", (error) => reject(error));
  });
}

async function handlePrompt(req, res) {
  const body = await readJsonBody(req);
  const prompt = normalizePrompt(body.prompt);
  const sessionId = String(body.sessionId || "default-session").trim() || "default-session";
  const requestedChatId = String(body.chatId || "").trim() || null;
  const uploadedFiles = Array.isArray(body.uploadedFiles) ? body.uploadedFiles : [];
  const requestedAttachedFiles = Array.isArray(body.attachedFiles)
    ? body.attachedFiles.map((name) => String(name || "").trim()).filter(Boolean)
    : [];

  if (!prompt) {
    json(res, 400, { error: "Missing required field: prompt" });
    return;
  }

  const resolvedChat = await resolveSessionChatId({ sessionId, requestedChatId, fallbackChatId: "default-chat" });
  if (!resolvedChat) {
    json(res, 409, {
      error: "Chat is not active or cannot be resolved.",
      sessionId,
      chatId: requestedChatId,
    });
    return;
  }
  const { chatId, chatName } = resolvedChat;
  const currentUserId = await getUserIdForSession(sessionId);
  const currentAssistantMode = normalizeAssistantMode(await getUserSetting({
    userId: currentUserId,
    settingName: "assistant_mode",
    fallbackValue: initialAssistantMode,
  }));

  if (uploadedFiles.length > MAX_PROMPT_UPLOAD_FILES) {
    json(res, 400, {
      error: `Too many uploaded files. Maximum is ${MAX_PROMPT_UPLOAD_FILES} per prompt.`,
    });
    return;
  }

  const commandResult = await handlePromptCommand(prompt, sessionId, chatId);
  if (commandResult) {
    commandResult.payload.chatId = chatId;
    commandResult.payload.chatName = chatName;
    if (commandResult.payload?.deferredCommand === "library_info") {
      commandResult.payload.answer = await buildLibraryInfoMessage();
      delete commandResult.payload.deferredCommand;
    }

    json(res, commandResult.statusCode, commandResult.payload);
    return;
  }

  const readiness = await getEmbeddingReadiness();
  if (!readiness.ready) {
    json(res, 503, {
      error: "Retriever not ready",
      readiness,
    });
    return;
  }

  let promptForRetrieval = prompt;
  let promptForAssistant = prompt;
  let uploadInfo = null;

  if (uploadedFiles.length > 0) {
    const uploadedContextResult = await buildUploadedPromptContext(uploadedFiles);
    if (!uploadedContextResult.hasUploadedContext) {
      json(res, 400, {
        error:
          uploadedContextResult.skippedFiles.length > 0
            ? `No valid uploaded files. Unsupported/empty files: ${uploadedContextResult.skippedFiles.join(", ")}.`
            : "No valid uploaded files.",
      });
      return;
    }

    promptForAssistant = `${prompt}\n\nONE-TIME UPLOADED FILE CONTEXT\n${uploadedContextResult.uploadedContext}`;
    uploadInfo = {
      uploadedCount: uploadedContextResult.uploadedFiles.length,
      uploadedFiles: uploadedContextResult.uploadedFiles.map((file) => file.name),
      skippedFiles: uploadedContextResult.skippedFiles,
    };
  }

  setAssistantChainProgress(sessionId, {
    active: true,
    mode: currentAssistantMode,
    stage: "searching",
  });

  let searchResult;
  try {
    searchResult = await searchKnowledgeBase(promptForRetrieval, sessionId, chatId);
  } catch (error) {
    clearAssistantChainProgress(sessionId);
    throw error;
  }
  const historyEntryLimit = runtimeConfig.historyMessages * 2;
  const chatHistory = await listRecentPromptHistory({ sessionId, chatId, limit: historyEntryLimit });
  const personalizationSettings = await getSessionPersonalizationSettings(sessionId);
  const retrievalDetails = createSimilarityDetails(searchResult.results, {
    maxSimilarities: runtimeConfig.maxSimilarities,
    cosineLimit: runtimeConfig.cosineLimit,
  });

  let answer = "";
  try {
    if (currentAssistantMode === "refine") {
      setAssistantChainProgress(sessionId, {
        active: true,
        mode: currentAssistantMode,
        stage: "drafting",
      });

      const draftResponse = await chatModel.invoke([
        ...buildSystemPromptLayers({
          guardrailsText,
          ragContextPackage: searchResult.ragContextPackage,
          assistantMode: currentAssistantMode,
          sessionId,
          personalizationSettings,
          includeAssistantModeLayer: false,
        }),
        [
          "system",
          getRefineChainSystemPrompt("drafting"),
        ],
        ...chatHistory,
        ["human", promptForAssistant],
      ]);

      const draftAnswer = finalizeAssistantAnswer(draftResponse);
      setAssistantChainProgress(sessionId, {
        active: true,
        mode: currentAssistantMode,
        stage: "refining",
      });

      const refinedResponse = await chatModel.invoke([
        ...buildSystemPromptLayers({
          guardrailsText,
          ragContextPackage: searchResult.ragContextPackage,
          assistantMode: currentAssistantMode,
          sessionId,
          personalizationSettings,
          includeAssistantModeLayer: false,
        }),
        [
          "system",
          getRefineChainSystemPrompt("refining"),
        ],
        ...chatHistory,
        ...buildRefineFinalPassMessages({
          originalPrompt: promptForAssistant,
          draftAnswer,
        }),
      ]);

      answer = finalizeAssistantAnswer(refinedResponse, {
        fallbackText: draftAnswer,
      });
      markAssistantChainCompleted(sessionId, currentAssistantMode);
    } else {
      setAssistantChainProgress(sessionId, {
        active: true,
        mode: currentAssistantMode,
        stage: "single_pass",
      });
      const assistantResponse = await chatModel.invoke([
        ...buildSystemPromptLayers({
          guardrailsText,
          ragContextPackage: searchResult.ragContextPackage,
          assistantMode: currentAssistantMode,
          sessionId,
          personalizationSettings,
        }),
        ...chatHistory,
        ["human", promptForAssistant],
      ]);
      answer = finalizeAssistantAnswer(assistantResponse);
      markAssistantChainCompleted(sessionId, currentAssistantMode);
    }
  } catch (error) {
    clearAssistantChainProgress(sessionId);
    throw error;
  }
  const pendingWeakAnswerKey = getPendingWeakAnswerKey(sessionId, chatId);

  const hasUploadedContext = Boolean(uploadInfo?.uploadedCount);

  if (searchResult.evidenceQuality === "weak" && !hasUploadedContext) {
    pendingWeakAnswers.set(pendingWeakAnswerKey, {
      answer,
      evidenceSeverity: searchResult.evidenceQuality,
    });
    await addChatMessage({
      sessionId,
      chatId,
      role: "user",
      content: promptForRetrieval,
      metadata: {
        attachedFiles: uploadInfo?.uploadedFiles || requestedAttachedFiles,
      },
    });
    await addChatMessage({
      sessionId,
      chatId,
      role: "assistant",
      content: answer,
      metadata: {
        evidenceSeverity: searchResult.evidenceQuality,
        upload: uploadInfo,
        retrieval: retrievalDetails,
      },
    });

    json(res, 200, {
      sessionId,
      chatId,
      chatName,
      answer:
        "Evidence quality is WEAK for this topic. The generated answer may be unreliable. Do you want to see it? Use /yes to show it, or /no or /skip to hide it.",
      evidenceSeverity: "warn",
      hasSufficientEvidence: searchResult.hasSufficientEvidence,
      interaction: {
        type: "weak_confirmation",
        pending: true,
      },
      upload: uploadInfo,
      retrieval: retrievalDetails,
    });
    return;
  }

  await addChatMessage({
    sessionId,
    chatId,
    role: "user",
    content: promptForRetrieval,
    metadata: {
      attachedFiles: uploadInfo?.uploadedFiles || requestedAttachedFiles,
    },
  });
  await addChatMessage({
    sessionId,
    chatId,
    role: "assistant",
    content: answer,
    metadata: {
      evidenceSeverity: hasUploadedContext ? "source_attached" : searchResult.evidenceQuality,
      upload: uploadInfo,
      retrieval: retrievalDetails,
    },
  });

  json(res, 200, {
    sessionId,
    chatId,
    chatName,
    answer,
    evidenceSeverity: hasUploadedContext ? "source_attached" : searchResult.evidenceQuality,
    hasSufficientEvidence: searchResult.hasSufficientEvidence,
    upload: uploadInfo,
    retrieval: hasUploadedContext ? null : retrievalDetails,
  });
}

async function handleMessages(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const sessionId = String(url.searchParams.get("sessionId") || "default-session").trim() || "default-session";
  const requestedChatId = String(url.searchParams.get("chatId") || "").trim() || null;
  const limitParam = Number.parseInt(String(url.searchParams.get("limit") || ""), 10);
  const limit = Number.isInteger(limitParam) && limitParam > 0 ? limitParam : null;

  const resolvedChat = await resolveSessionChatId({ sessionId, requestedChatId, fallbackChatId: "default-chat" });
  if (!resolvedChat) {
    json(res, 409, {
      error: "Chat is not active or cannot be resolved.",
      sessionId,
      chatId: requestedChatId,
    });
    return;
  }
  const { chatId, chatName } = resolvedChat;
  const rows = await listChatMessages({ sessionId, chatId, limit });

  json(res, 200, {
    sessionId,
    chatId,
    chatName,
    totalMessages: rows.length,
    messages: rows.map((row) => ({
      role: row.role,
      content: row.content,
      metadata: row.metadata || {},
      createdAt: row.created_at,
    })),
  });
}

async function handleListChats(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const sessionId = String(url.searchParams.get("sessionId") || "default-session").trim() || "default-session";
  const includeArchived = ["1", "true", "yes"].includes(
    String(url.searchParams.get("includeArchived") || "").trim().toLowerCase()
  );

  const data = await listSessionChats({ sessionId, includeArchived });

  json(res, 200, {
    sessionId,
    activeChatId: data.activeChatId,
    chats: data.chats.map((chat) => ({
      id: chat.id,
      name: chat.name,
      status: chat.status,
      createdAt: chat.created_at,
      updatedAt: chat.updated_at,
      archivedAt: chat.archived_at,
      tagFilters: chat.tag_filter_state || { disabledTags: [] },
    })),
    totalChats: data.chats.length,
  });
}

async function handleCreateChat(req, res) {
  const body = await readJsonBody(req);
  const sessionId = String(body.sessionId || "default-session").trim() || "default-session";
  const requestedName = String(body.name || "").trim() || null;
  const chatId = String(body.chatId || "").trim() || crypto.randomUUID();
  await ensureSessionExists(sessionId);
  let created;
  try {
    created = await createChat({
      sessionId,
      chatId,
      chatName: requestedName || generateChatName(),
    });
  } catch (error) {
    if (error?.code === "23505") {
      json(res, 409, { error: "Chat id already exists.", sessionId, chatId });
      return;
    }
    throw error;
  }

  json(res, 201, {
    sessionId,
    activeChatId: chatId,
    chat: {
      id: created.id,
      name: created.name,
      status: created.status,
      createdAt: created.created_at,
      updatedAt: created.updated_at,
      archivedAt: created.archived_at,
      tagFilters: created.tag_filter_state || { disabledTags: [] },
    },
  });
}

async function handlePatchChat(req, res, chatId) {
  const body = await readJsonBody(req);
  const sessionId = String(body.sessionId || "default-session").trim() || "default-session";
  const action = String(body.action || "").trim().toLowerCase();

  if (action === "switch") {
    const selected = await setSessionActiveChat({ sessionId, chatId });
    if (!selected) {
      json(res, 404, { error: "Chat not found.", sessionId, chatId });
      return;
    }
    if (selected.notSwitchable) {
      json(res, 409, { error: "Cannot switch to archived chat.", sessionId, chatId });
      return;
    }
    json(res, 200, {
      sessionId,
      activeChatId: chatId,
      chat: {
        id: selected.id,
        name: selected.name,
        status: selected.status,
      },
    });
    return;
  }

  if (action === "archive" || action === "activate") {
    const status = action === "archive" ? "archived" : "active";
    const updated = await updateChatStatus({ sessionId, chatId, status });
    if (!updated) {
      json(res, 404, { error: "Chat not found.", sessionId, chatId });
      return;
    }
    const listed = await listSessionChats({ sessionId, includeArchived: true });
    json(res, 200, {
      sessionId,
      activeChatId: listed.activeChatId,
      chat: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
        archivedAt: updated.archived_at,
        tagFilters: updated.tag_filter_state || { disabledTags: [] },
      },
    });
    return;
  }

  if (action === "rename") {
    const nextName = String(body.name || "").trim();
    if (!nextName) {
      json(res, 400, { error: "Chat name is required for rename." });
      return;
    }
    const updated = await updateChatName({ sessionId, chatId, name: nextName });
    if (!updated) {
      json(res, 404, { error: "Chat not found.", sessionId, chatId });
      return;
    }
    json(res, 200, {
      sessionId,
      chat: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
        archivedAt: updated.archived_at,
        tagFilters: updated.tag_filter_state || { disabledTags: [] },
      },
    });
    return;
  }

  if (action === "set_tag_filter") {
    const tag = String(body.tag || "").trim().toLowerCase();
    const enabled = body.enabled !== false;
    if (!tag) {
      json(res, 400, { error: "Tag is required for set_tag_filter action." });
      return;
    }

    const current = await getChatTagFilterState({ sessionId, chatId });
    const disabledSet = new Set(
      (Array.isArray(current.disabledTags) ? current.disabledTags : [])
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean)
    );
    if (enabled) {
      disabledSet.delete(tag);
    } else {
      disabledSet.add(tag);
    }

    const updated = await updateChatTagFilterState({
      sessionId,
      chatId,
      nextState: { disabledTags: Array.from(disabledSet) },
    });
    if (!updated) {
      json(res, 404, { error: "Chat not found.", sessionId, chatId });
      return;
    }

    json(res, 200, {
      ok: true,
      sessionId,
      chat: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at,
        archivedAt: updated.archived_at,
        tagFilters: updated.tag_filter_state || { disabledTags: [] },
      },
    });
    return;
  }

  json(res, 400, {
    error: "Unsupported action. Use one of: switch, archive, activate, rename, set_tag_filter.",
  });
}

async function handleDeleteChat(req, res, chatId) {
  const body = await readJsonBody(req);
  const sessionId = String(body.sessionId || "default-session").trim() || "default-session";
  const deleted = await deleteChat({ sessionId, chatId });
  if (!deleted) {
    json(res, 404, { error: "Chat not found.", sessionId, chatId });
    return;
  }
  const listed = await listSessionChats({ sessionId, includeArchived: true });
  json(res, 200, {
    ok: true,
    sessionId,
    deletedChatId: chatId,
    activeChatId: listed.activeChatId,
  });
}

async function handleDownloadChat(req, res, chatId) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const sessionId = String(url.searchParams.get("sessionId") || "default-session").trim() || "default-session";
  const listed = await listSessionChats({ sessionId, includeArchived: true });
  const selectedChat = listed.chats.find((chat) => chat.id === chatId);
  if (!selectedChat) {
    json(res, 404, { error: "Chat not found.", sessionId, chatId });
    return;
  }

  const rows = await listChatMessages({ sessionId, chatId, limit: null });
  const payload = {
    exportedAt: new Date().toISOString(),
    sessionId,
    chat: {
      id: selectedChat.id,
      name: selectedChat.name,
      status: selectedChat.status,
      createdAt: selectedChat.created_at,
      updatedAt: selectedChat.updated_at,
      archivedAt: selectedChat.archived_at,
      tagFilters: selectedChat.tag_filter_state || { disabledTags: [] },
    },
    messages: rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      metadata: row.metadata || {},
      createdAt: row.created_at,
    })),
  };

  const safeName = String(selectedChat.name || selectedChat.id || "chat")
    .replace(/[^a-z0-9-_]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "chat";
  const filename = `${safeName}.json`;

  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename=\"${filename}\"`,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function handleStatus(_req, res) {
  const url = new URL(_req.url, `http://${_req.headers.host || "localhost"}`);
  const sessionId = String(url.searchParams.get("sessionId") || "").trim();
  const userId = sessionId ? await getUserIdForSession(sessionId) : null;
  const currentUiMode = sessionId
    ? await getSessionUiMode(sessionId)
    : initialUiMode;
  const currentAssistantMode = sessionId
    ? normalizeAssistantMode(await getUserSetting({
      userId,
      settingName: "assistant_mode",
      fallbackValue: initialAssistantMode,
    }))
    : initialAssistantMode;
  const personalizationSettings = sessionId
    ? await getSessionPersonalizationSettings(sessionId)
    : null;
  const readiness = await getEmbeddingReadiness();
  const embeddingStatus = await readEmbeddingStatus();

  json(res, 200, {
    app: {
      name: APP_NAME,
      version: APP_VERSION,
      role: "retriever-api",
      uiMode: currentUiMode,
    },
    assistant: {
      mode: currentAssistantMode,
      personalization: personalizationSettings,
      chainProgress: sessionId ? (assistantChainProgressBySession.get(sessionId) || null) : null,
      availableModes: listAssistantModes().map((mode) => ({ id: mode.id, label: mode.label })),
    },
    retrieval: {
      collection: COLLECTION_NAME,
      historyMessages: runtimeConfig.historyMessages,
      qdrantUrl: QDRANT_URL,
      maxSimilarities: runtimeConfig.maxSimilarities,
      minSimilarities: runtimeConfig.minSimilarities,
      cosineLimit: runtimeConfig.cosineLimit,
    },
    embedding: {
      readiness,
      status: embeddingStatus,
    },
  });
}

async function handlePersonalization(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (req.method === "GET") {
    const sessionId = String(url.searchParams.get("sessionId") || "default-session").trim() || "default-session";
    const settings = await getSessionPersonalizationSettings(sessionId);
    json(res, 200, {
      sessionId,
      settings,
    });
    return;
  }

  if (req.method === "PATCH") {
    const body = await readJsonBody(req);
    const sessionId = String(body.sessionId || "default-session").trim() || "default-session";
    const baseStyleTone = String(body.baseStyleTone || "").trim().toLowerCase();
    const warm = String(body.warm || "").trim().toLowerCase();
    const enthusiastic = String(body.enthusiastic || "").trim().toLowerCase();
    const headersAndLists = String(body.headersAndLists || "").trim().toLowerCase();
    const hasCustomInstructions = Object.prototype.hasOwnProperty.call(body, "customInstructions");
    const customInstructions = hasCustomInstructions ? String(body.customInstructions || "") : "";
    const hasNickname = Object.prototype.hasOwnProperty.call(body, "nickname");
    const nickname = hasNickname ? String(body.nickname || "") : "";
    const hasOccupation = Object.prototype.hasOwnProperty.call(body, "occupation");
    const occupation = hasOccupation ? String(body.occupation || "") : "";
    const hasMoreAboutUser = Object.prototype.hasOwnProperty.call(body, "moreAboutUser");
    const moreAboutUser = hasMoreAboutUser ? String(body.moreAboutUser || "") : "";
    const settings = await updateSessionPersonalizationSettings(sessionId, {
      ...(baseStyleTone ? { baseStyleTone } : {}),
      ...(warm ? { warm } : {}),
      ...(enthusiastic ? { enthusiastic } : {}),
      ...(headersAndLists ? { headersAndLists } : {}),
      ...(hasCustomInstructions ? { customInstructions } : {}),
      ...(hasNickname ? { nickname } : {}),
      ...(hasOccupation ? { occupation } : {}),
      ...(hasMoreAboutUser ? { moreAboutUser } : {}),
    });
    json(res, 200, {
      sessionId,
      settings,
    });
  }
}

async function handleFiles(req, res, url) {
  const sessionId = String(url.searchParams.get("sessionId") || "default-session").trim() || "default-session";
  const rows = await listFileMetadata();
  const tagFilterState = await getSessionTagFilterState(sessionId);

  const payload = rows.map((row) => ({
    path: row.file_path,
    extension: row.extension,
    sizeBytes: Number(row.size_bytes),
    lastModified: row.last_modified,
    hash: row.file_hash,
    chunkCount: row.chunk_count,
    embedded: row.embedded,
    tags: Array.isArray(row.tags) ? row.tags : [],
  }));

  json(res, 200, {
    contentPath: CONTENT_PATH,
    defaultTag: DEFAULT_FILE_TAG,
    tagFilters: tagFilterState,
    files: payload,
    totalFiles: payload.length,
    embeddedFiles: payload.filter((file) => file.embedded).length,
  });
}

async function handleTagFilters(req, res, url) {
  const requestSessionId = req.method === "GET"
    ? String(url.searchParams.get("sessionId") || "default-session").trim() || "default-session"
    : null;

  if (req.method === "GET") {
    const tagFilters = await getSessionTagFilterState(requestSessionId);
    json(res, 200, {
      sessionId: requestSessionId,
      tagFilters,
    });
    return;
  }

  if (req.method === "PATCH") {
    const body = await readJsonBody(req);
    const sessionId = String(body.sessionId || "default-session").trim() || "default-session";
    const tag = String(body.tag || "").trim().toLowerCase();
    const enabled = body.enabled !== false;

    if (!tag) {
      json(res, 400, { ok: false, error: "Missing 'tag' in request body." });
      return;
    }

    const current = await getSessionTagFilterState(sessionId);
    const disabledSet = new Set(Array.isArray(current.disabledTags) ? current.disabledTags : []);
    if (enabled) {
      disabledSet.delete(tag);
    } else {
      disabledSet.add(tag);
    }

    const nextState = await updateSessionTagFilterState(sessionId, {
      disabledTags: Array.from(disabledSet),
    });

    json(res, 200, {
      ok: true,
      sessionId,
      tagFilters: nextState,
    });
    return;
  }

  json(res, 405, { ok: false, error: "Method not allowed" });
}

async function handleFileTags(req, res) {
  const body = await readJsonBody(req);
  const filePath = String(body.path || "").trim();
  if (!filePath) {
    json(res, 400, { ok: false, error: "Missing 'path' in request body." });
    return;
  }

  const tags = Array.isArray(body.tags)
    ? body.tags
    : typeof body.tag === "string"
      ? [body.tag]
      : [];

  const updated = await updateFileTags(filePath, tags);
  if (!updated) {
    json(res, 404, { ok: false, error: "File not found in metadata." });
    return;
  }

  json(res, 200, {
    ok: true,
    file: {
      path: updated.filePath,
      tags: updated.tags,
    },
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      json(res, 400, { error: "Missing request URL" });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
      json(res, 200, { ok: true });
      return;
    }

    const isStatusRoute = ["/api/status", "/internal/retriever/status"].includes(url.pathname);
    const isFilesRoute = ["/api/files", "/internal/retriever/files"].includes(url.pathname);
    const isFileTagsRoute = ["/api/files/tags", "/internal/retriever/files/tags"].includes(url.pathname);
    const isTagFiltersRoute = ["/api/files/tag-filters", "/internal/retriever/files/tag-filters"].includes(url.pathname);
    const isMessagesRoute = ["/api/messages", "/internal/retriever/messages"].includes(url.pathname);
    const isPromptRoute = ["/api/prompt", "/internal/retriever/prompt"].includes(url.pathname);
    const isChatsRoute = ["/api/chats", "/internal/retriever/chats"].includes(url.pathname);
    const isPersonalizationRoute = ["/api/personalization", "/internal/retriever/personalization"].includes(url.pathname);
    const chatRouteMatch = url.pathname.match(/^\/(?:api|internal\/retriever)\/chats\/([^/]+)$/);
    const chatDownloadRouteMatch = url.pathname.match(/^\/(?:api|internal\/retriever)\/chats\/([^/]+)\/download$/);

    if (req.method === "GET" && isStatusRoute) {
      await handleStatus(req, res);
      return;
    }

    if (req.method === "GET" && isFilesRoute) {
      await handleFiles(req, res, url);
      return;
    }

    if (isTagFiltersRoute && (req.method === "GET" || req.method === "PATCH")) {
      await handleTagFilters(req, res, url);
      return;
    }

    if (req.method === "PATCH" && isFileTagsRoute) {
      await handleFileTags(req, res);
      return;
    }

    if (req.method === "GET" && isMessagesRoute) {
      await handleMessages(req, res);
      return;
    }

    if (req.method === "GET" && isChatsRoute) {
      await handleListChats(req, res);
      return;
    }

    if (req.method === "POST" && isChatsRoute) {
      await handleCreateChat(req, res);
      return;
    }

    if ((req.method === "GET" || req.method === "PATCH") && isPersonalizationRoute) {
      await handlePersonalization(req, res);
      return;
    }

    if (req.method === "PATCH" && chatRouteMatch) {
      await handlePatchChat(req, res, decodeURIComponent(chatRouteMatch[1]));
      return;
    }

    if (req.method === "GET" && chatDownloadRouteMatch) {
      await handleDownloadChat(req, res, decodeURIComponent(chatDownloadRouteMatch[1]));
      return;
    }

    if (req.method === "DELETE" && chatRouteMatch) {
      await handleDeleteChat(req, res, decodeURIComponent(chatRouteMatch[1]));
      return;
    }

    if (req.method === "POST" && isPromptRoute) {
      await handlePrompt(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/healthz") {
      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (error) {
    console.error(error);

    if (error.message === "Invalid JSON payload") {
      json(res, 400, { error: error.message });
      return;
    }

    if (error.message === "Payload too large") {
      json(res, 413, { error: error.message });
      return;
    }

    json(res, 500, {
      error: "Internal server error",
      details: error.message,
    });
  }
});

await ensureDatabaseReady();
await initializeStateDefaults({ uiMode: initialUiMode, assistantMode: initialAssistantMode });
await initializeRuntimeConfigDefaults({
  historyMessages: HISTORY_MESSAGES,
  maxSimilarities: MAX_SIMILARITIES,
  minSimilarities: MIN_SIMILARITIES,
  cosineLimit: COSINE_LIMIT,
});
const persistedRuntimeConfig = await getRuntimeConfigState({
  historyMessages: runtimeConfig.historyMessages,
  maxSimilarities: runtimeConfig.maxSimilarities,
  minSimilarities: runtimeConfig.minSimilarities,
  cosineLimit: runtimeConfig.cosineLimit,
});
setRuntimeConfigValue("history messages", persistedRuntimeConfig.historyMessages);
setRuntimeConfigValue("max similarities", persistedRuntimeConfig.maxSimilarities);
setRuntimeConfigValue("min similarities", persistedRuntimeConfig.minSimilarities);
setRuntimeConfigValue("cosine limit", persistedRuntimeConfig.cosineLimit);

server.listen(PORT, HOST, () => {
  console.log(`Retriever API listening on http://${HOST}:${PORT}`);
  console.log(
    "Endpoints: GET /api/status, GET /api/files, PATCH /api/files/tags, GET|PATCH /api/files/tag-filters, GET|POST /api/chats, PATCH|DELETE /api/chats/:chatId, GET /api/chats/:chatId/download, GET /api/messages, GET|PATCH /api/personalization, POST /api/prompt, GET /internal/retriever/status, GET /internal/retriever/files, PATCH /internal/retriever/files/tags, GET|PATCH /internal/retriever/files/tag-filters, GET|POST /internal/retriever/chats, PATCH|DELETE /internal/retriever/chats/:chatId, GET /internal/retriever/chats/:chatId/download, GET /internal/retriever/messages, GET|PATCH /internal/retriever/personalization, POST /internal/retriever/prompt"
  );
});
