import fs from "fs";
import http from "http";
import os from "os";
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
  PDF_MIN_EXTRACTED_CHARS,
  POSTGRES_DB,
  POSTGRES_HOST,
  POSTGRES_PORT,
  POSTGRES_USER,
  QDRANT_URL,
  CHAT_HISTORY_DIR,
  validateRetrievalConfig,
} from "./src/config.js";
import { buildSystemPromptLayers, loadGuardrails } from "./src/guardrails.js";
import { createChatModel } from "./src/model-clients.js";
import {
  DEFAULT_ASSISTANT_MODE,
  isAssistantModeSupported,
  listAssistantModes,
  normalizeAssistantMode,
} from "./src/assistant-modes.js";
import {
  DEFAULT_PROFILE,
  isProfileSupported,
  listProfiles,
  normalizeProfile,
} from "./src/profiles.js";
import {
  buildActiveConfigMessage,
  buildHelpMessage,
  buildSystemInfoMessage,
  buildRagContextPackage,
  createSimilarityDetails,
  formatBytes,
  getEvidenceQuality,
} from "./src/messages.js";
import {
  createEmbeddingsModel,
  createQdrantClient,
  fileToChunks,
  readEmbeddableFiles,
  readEmbeddingStatus,
} from "./src/embedding-service.js";
import { ensureDatabaseReady } from "./src/db.js";
import {
  addChatMessage,
  createChat,
  deleteChat,
  ensureSessionExists,
  getRuntimeConfigState,
  getIndexStateMap,
  initializeRuntimeConfigDefaults,
  getSelectionState,
  initializeStateDefaults,
  listSessionChats,
  listChatMessages,
  listRecentPromptHistory,
  listFileMetadata,
  resolveSessionChatId,
  setSessionActiveChat,
  updateChatName,
  updateSetting,
  updateChatStatus,
} from "./src/state-store.js";
import {
  normalizeIndexableFileByExtension,
  normalizeIndexableTextByExtension,
} from "./src/document-processing.js";
import { createRuntimeConfigManager, parseConfigSetCommand } from "./src/runtime-config.js";

validateRetrievalConfig();

const PORT = parseInt(process.env.RETRIEVER_API_PORT || "3000", 10);
const HOST = process.env.RETRIEVER_API_HOST || "0.0.0.0";
const initialAssistantMode = normalizeAssistantMode(process.env.ASSISTANT_MODE || DEFAULT_ASSISTANT_MODE);
const initialProfileId = normalizeProfile(process.env.ASSISTANT_PROFILE || DEFAULT_PROFILE);
const SUPPORTED_UI_MODES = new Set(["clean", "rag"]);
const initialUiMode = SUPPORTED_UI_MODES.has(String(process.env.WEB_UI_MODE || "").trim().toLowerCase())
  ? String(process.env.WEB_UI_MODE).trim().toLowerCase()
  : "clean";

let assistantMode = initialAssistantMode;
let profileId = initialProfileId;
let uiMode = initialUiMode;
const guardrailsText = loadGuardrails();

const chatModel = createChatModel();

const embeddingsModel = createEmbeddingsModel();
const qdrant = createQdrantClient();
const UPLOADABLE_EXTENSIONS = new Set([".md", ".txt", ".html", ".htm", ".pdf"]);
const MAX_PROMPT_UPLOAD_FILES = 3;
const pendingWeakAnswers = new Map();
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
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "local-rag-upload-"));
    const tempPath = path.join(tempDir, name);

    try {
      fs.writeFileSync(tempPath, buffer);
      content = await normalizeIndexableFileByExtension(tempPath, extension);
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup.
      }
    }
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

async function buildUploadedPromptContext(uploadedFiles) {
  const normalizedUploadedFiles = [];
  const skippedFiles = [];

  for (const file of uploadedFiles) {
    const normalized = await normalizeUploadedPromptFile(file);
    if (!normalized.ok) {
      skippedFiles.push(normalized.name || "unnamed-file");
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
    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: buildSystemInfoMessage({
          appName: APP_NAME,
          appVersion: APP_VERSION,
          uiMode,
          assistantMode,
          profileId,
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
    const modes = listAssistantModes();
    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: [
          "Assistant modes:",
          ...modes.map((mode) => `- ${mode.id}: ${mode.description}`),
          `Current mode: ${assistantMode}`
        ].join("\n"),
        evidenceSeverity: null,
        responseType: "assistant_mode",
      },
    };
  }

  if (normalizedPrompt === "/mode") {
    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: [
          "UI modes:",
          "- clean: Clean chat-focused UI without retrieval diagnostics.",
          "- rag: Retrieval-debug UI that includes evidence quality and similarity details.",
          `Current mode: ${uiMode}`,
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

    uiMode = requestedMode;
    await updateSetting("ui_mode", uiMode);
    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: `UI mode changed to: ${uiMode}`,
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

    assistantMode = normalizeAssistantMode(requestedMode);
    await updateSetting("assistant_mode", assistantMode);

    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: `Assistant mode changed to: ${assistantMode}` ,
        evidenceSeverity: "ok",
        responseType: "assistant_mode",
      },
    };
  }

  if (normalizedPrompt === "/profile") {
    const profiles = listProfiles();
    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: [
          "Profiles:",
          ...profiles.map((profile) => `- ${profile.id}: ${profile.description}`),
          `Current profile: ${profileId}`
        ].join("\n"),
        evidenceSeverity: null,
        responseType: "profile",
      },
    };
  }

  if (normalizedPrompt.startsWith("/profile ")) {
    const requestedProfile = prompt.slice("/profile ".length).trim().toLowerCase();

    if (!isProfileSupported(requestedProfile)) {
      return {
        statusCode: 400,
        payload: {
          sessionId,
          error: `Unsupported profile: ${requestedProfile}`,
          answer: `Unsupported profile: ${requestedProfile}. Use /profile to list available profiles.`,
          evidenceSeverity: "warn",
        },
      };
    }

    profileId = normalizeProfile(requestedProfile);
    await updateSetting("profile_id", profileId);

    return {
      statusCode: 200,
      payload: {
        sessionId,
        answer: `Profile changed to: ${profileId}` ,
        evidenceSeverity: "ok",
        responseType: "profile",
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
      }[normalizedConfigName]]);
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

async function searchKnowledgeBase(prompt) {
  const userQuestionEmbedding = await embeddingsModel.embedQuery(prompt);
  const results = await qdrant.search(COLLECTION_NAME, {
    vector: userQuestionEmbedding,
    limit: runtimeConfig.maxSimilarities,
    with_payload: true,
  });

  const filteredResults = results.filter((result) => result.score >= runtimeConfig.cosineLimit);
  const hasSufficientEvidence = filteredResults.length >= runtimeConfig.minSimilarities;
  const evidenceQuality = getEvidenceQuality(filteredResults, runtimeConfig.minSimilarities);

  return {
    results: filteredResults,
    evidenceQuality,
    hasSufficientEvidence,
    ragContextPackage: buildRagContextPackage({
      results: filteredResults,
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

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Payload too large"));
      }
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

  const searchResult = await searchKnowledgeBase(promptForRetrieval);
  const historyEntryLimit = runtimeConfig.historyMessages * 2;
  const chatHistory = await listRecentPromptHistory({ sessionId, chatId, limit: historyEntryLimit });
  const retrievalDetails = createSimilarityDetails(searchResult.results, {
    maxSimilarities: runtimeConfig.maxSimilarities,
    cosineLimit: runtimeConfig.cosineLimit,
  });

  const assistantResponse = await chatModel.invoke([
    ...buildSystemPromptLayers({
      guardrailsText,
      ragContextPackage: searchResult.ragContextPackage,
      assistantMode,
      profileId,
    }),
    ...chatHistory,
    ["human", promptForAssistant],
  ]);

  const answer = String(assistantResponse.content || "").trim();
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
      },
    });
    return;
  }

  json(res, 400, {
    error: "Unsupported action. Use one of: switch, archive, activate, rename.",
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
  const readiness = await getEmbeddingReadiness();
  const embeddingStatus = await readEmbeddingStatus();

  json(res, 200, {
    app: {
      name: APP_NAME,
      version: APP_VERSION,
      role: "retriever-api",
      uiMode,
    },
    assistant: {
      mode: assistantMode,
      profile: profileId,
      availableModes: listAssistantModes().map((mode) => ({ id: mode.id, label: mode.label })),
      availableProfiles: listProfiles().map((profile) => ({ id: profile.id, label: profile.label })),
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

async function handleFiles(_req, res) {
  const rows = await listFileMetadata();

  const payload = rows.map((row) => ({
    path: row.file_path,
    extension: row.extension,
    sizeBytes: Number(row.size_bytes),
    lastModified: row.last_modified,
    hash: row.file_hash,
    chunkCount: row.chunk_count,
    embedded: row.embedded,
  }));

  json(res, 200, {
    contentPath: CONTENT_PATH,
    files: payload,
    totalFiles: payload.length,
    embeddedFiles: payload.filter((file) => file.embedded).length,
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
    const isMessagesRoute = ["/api/messages", "/internal/retriever/messages"].includes(url.pathname);
    const isPromptRoute = ["/api/prompt", "/internal/retriever/prompt"].includes(url.pathname);
    const isChatsRoute = ["/api/chats", "/internal/retriever/chats"].includes(url.pathname);
    const chatRouteMatch = url.pathname.match(/^\/(?:api|internal\/retriever)\/chats\/([^/]+)$/);
    const chatDownloadRouteMatch = url.pathname.match(/^\/(?:api|internal\/retriever)\/chats\/([^/]+)\/download$/);

    if (req.method === "GET" && isStatusRoute) {
      await handleStatus(req, res);
      return;
    }

    if (req.method === "GET" && isFilesRoute) {
      await handleFiles(req, res);
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
await initializeStateDefaults({ uiMode: initialUiMode, assistantMode: initialAssistantMode, profileId: initialProfileId });
await initializeRuntimeConfigDefaults({
  historyMessages: HISTORY_MESSAGES,
  maxSimilarities: MAX_SIMILARITIES,
  minSimilarities: MIN_SIMILARITIES,
  cosineLimit: COSINE_LIMIT,
});
const persistedSelections = await getSelectionState({ uiMode: initialUiMode, assistantMode: initialAssistantMode, profileId: initialProfileId });
uiMode = persistedSelections.uiMode;
assistantMode = normalizeAssistantMode(persistedSelections.assistantMode);
profileId = normalizeProfile(persistedSelections.profileId);
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
    "Endpoints: GET /api/status, GET /api/files, GET|POST /api/chats, PATCH|DELETE /api/chats/:chatId, GET /api/chats/:chatId/download, GET /api/messages, POST /api/prompt, GET /internal/retriever/status, GET /internal/retriever/files, GET|POST /internal/retriever/chats, PATCH|DELETE /internal/retriever/chats/:chatId, GET /internal/retriever/chats/:chatId/download, GET /internal/retriever/messages, POST /internal/retriever/prompt"
  );
});
