import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
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
  INDEX_STATE_FILE,
  INDEX_SCHEMA_VERSION,
  MAX_SIMILARITIES,
  MAX_EMBEDDING_CHARS,
  MIN_SIMILARITIES,
  PDF_MIN_EXTRACTED_CHARS,
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
import {
  normalizeIndexableFileByExtension,
  normalizeIndexableTextByExtension,
} from "./src/document-processing.js";
import { createRuntimeConfigManager, parseConfigSetCommand } from "./src/runtime-config.js";

validateRetrievalConfig();

const PORT = parseInt(process.env.RETRIEVER_API_PORT || "3000", 10);
const HOST = process.env.RETRIEVER_API_HOST || "0.0.0.0";
let assistantMode = normalizeAssistantMode(process.env.ASSISTANT_MODE || DEFAULT_ASSISTANT_MODE);
let profileId = normalizeProfile(process.env.ASSISTANT_PROFILE || DEFAULT_PROFILE);
const SUPPORTED_UI_MODES = new Set(["clean", "rag"]);
let uiMode = SUPPORTED_UI_MODES.has(String(process.env.WEB_UI_MODE || "").trim().toLowerCase())
  ? String(process.env.WEB_UI_MODE).trim().toLowerCase()
  : "clean";
const guardrailsText = loadGuardrails();

const chatModel = createChatModel();

const embeddingsModel = createEmbeddingsModel();
const qdrant = createQdrantClient();
const UPLOADABLE_EXTENSIONS = new Set([".md", ".txt", ".html", ".htm", ".pdf"]);
const MAX_PROMPT_UPLOAD_FILES = 3;
const sessionMemory = new Map();
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

function getSessionHistory(sessionId) {
  if (!sessionMemory.has(sessionId)) {
    sessionMemory.set(sessionId, []);
  }

  return sessionMemory.get(sessionId);
}

function appendHistory(sessionId, role, content) {
  const history = getSessionHistory(sessionId);
  history.push([role, content]);

  const maxHistoryEntries = runtimeConfig.historyMessages * 2;
  if (history.length > maxHistoryEntries) {
    history.splice(0, history.length - maxHistoryEntries);
  }
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
          { key: "index state file", value: INDEX_STATE_FILE, editable: false },
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

  const indexState = readIndexState();
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

function handlePromptCommand(prompt, sessionId) {
  const normalizedPrompt = prompt.toLowerCase();
  const pendingWeakAnswer = pendingWeakAnswers.get(sessionId);

  if (pendingWeakAnswer) {
    if (["/yes", "/y"].includes(normalizedPrompt)) {
      pendingWeakAnswers.delete(sessionId);
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
      pendingWeakAnswers.delete(sessionId);
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
          indexStateFile: INDEX_STATE_FILE,
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

function readIndexState() {
  try {
    if (!fs.existsSync(INDEX_STATE_FILE)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(INDEX_STATE_FILE, "utf8"));
  } catch (error) {
    console.error(`Failed to read index state: ${error.message}`);
    return {};
  }
}

function getEmbeddingReadiness() {
  const embeddingStatus = readEmbeddingStatus();

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
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
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
  const uploadedFiles = Array.isArray(body.uploadedFiles) ? body.uploadedFiles : [];

  if (!prompt) {
    json(res, 400, { error: "Missing required field: prompt" });
    return;
  }

  if (uploadedFiles.length > MAX_PROMPT_UPLOAD_FILES) {
    json(res, 400, {
      error: `Too many uploaded files. Maximum is ${MAX_PROMPT_UPLOAD_FILES} per prompt.`,
    });
    return;
  }

  const commandResult = handlePromptCommand(prompt, sessionId);
  if (commandResult) {
    if (commandResult.payload?.deferredCommand === "library_info") {
      commandResult.payload.answer = await buildLibraryInfoMessage();
      delete commandResult.payload.deferredCommand;
    }

    json(res, commandResult.statusCode, commandResult.payload);
    return;
  }

  const readiness = getEmbeddingReadiness();
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
  const chatHistory = getSessionHistory(sessionId);

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

  const hasUploadedContext = Boolean(uploadInfo?.uploadedCount);

  if (searchResult.evidenceQuality === "weak" && !hasUploadedContext) {
    pendingWeakAnswers.set(sessionId, {
      answer,
      evidenceSeverity: searchResult.evidenceQuality,
    });

    appendHistory(sessionId, "human", promptForRetrieval);
    appendHistory(sessionId, "ai", answer);

    json(res, 200, {
      sessionId,
      answer:
        "Evidence quality is WEAK for this topic. The generated answer may be unreliable. Do you want to see it? Use /yes to show it, or /no or /skip to hide it.",
      evidenceSeverity: "warn",
      hasSufficientEvidence: searchResult.hasSufficientEvidence,
      interaction: {
        type: "weak_confirmation",
        pending: true,
      },
      upload: uploadInfo,
      retrieval: createSimilarityDetails(searchResult.results, {
        maxSimilarities: runtimeConfig.maxSimilarities,
        cosineLimit: runtimeConfig.cosineLimit,
      }),
    });
    return;
  }

  appendHistory(sessionId, "human", promptForRetrieval);
  appendHistory(sessionId, "ai", answer);

  json(res, 200, {
    sessionId,
    answer,
    evidenceSeverity: hasUploadedContext ? "source_attached" : searchResult.evidenceQuality,
    hasSufficientEvidence: searchResult.hasSufficientEvidence,
    upload: uploadInfo,
    retrieval: hasUploadedContext
      ? null
      : createSimilarityDetails(searchResult.results, {
        maxSimilarities: runtimeConfig.maxSimilarities,
        cosineLimit: runtimeConfig.cosineLimit,
      }),
  });
}

async function handleStatus(_req, res) {
  const readiness = getEmbeddingReadiness();
  const embeddingStatus = readEmbeddingStatus();

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
  const files = await readEmbeddableFiles();
  const indexState = readIndexState();

  const payload = files.map((file) => {
    const chunkCount = fileToChunks(file).length;
    const isEmbedded = indexState[file.relativePath] === file.hash;

    return {
      path: file.relativePath,
      extension: file.extension,
      sizeBytes: file.size,
      lastModified: file.lastModified,
      hash: file.hash,
      chunkCount,
      embedded: isEmbedded,
    };
  });

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

    if (req.method === "GET" && url.pathname === "/api/status") {
      await handleStatus(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/files") {
      await handleFiles(req, res);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/prompt") {
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

server.listen(PORT, HOST, () => {
  console.log(`Retriever API listening on http://${HOST}:${PORT}`);
  console.log("Endpoints: GET /api/status, GET /api/files, POST /api/prompt");
});
