import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import prompts from "prompts";
import chalk from "chalk";
import {
  APP_NAME,
  APP_VERSION,
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  CHAT_HISTORY_DIR,
  COLLECTION_NAME,
  CONTENT_PATH,
  COSINE_LIMIT,
  EMBEDDABLE_EXTENSIONS,
  EMBEDDING_STATUS_FILE,
  HISTORY_MESSAGES,
  INDEX_SCHEMA_VERSION,
  INDEX_STATE_FILE,
  MAX_EMBEDDING_CHARS,
  MAX_SIMILARITIES,
  MIN_SIMILARITIES,
  PDF_MIN_EXTRACTED_CHARS,
  POSTGRES_DB,
  POSTGRES_HOST,
  POSTGRES_PORT,
  POSTGRES_USER,
  QDRANT_URL,
  validateRetrievalConfig,
} from "../../shared/config/index.js";
import { createUi } from "../../shared/src/ui.js";
import { createChatModel } from "../../shared/src/model-clients.js";
import { buildSystemPromptLayers, loadGuardrails } from "../../shared/src/guardrails.js";
import {
  DEFAULT_ASSISTANT_MODE,
  listAssistantModes,
  normalizeAssistantMode,
} from "../../shared/src/assistant-modes.js";
import { getDefaultPersonalizationSettings } from "../../shared/src/personalization.js";
import { createRuntimeConfigManager, parseConfigSetCommand } from "../../shared/src/runtime-config.js";
import {
  buildActiveConfigMessage,
  buildHelpMessage,
  buildRagContextPackage,
  buildSystemInfoMessage,
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
import { normalizeIndexableFileByExtension } from "../../shared/src/document-processing.js";

function colorEvidenceQuality(q) {
  if (q === "strong") return chalk.green(q);
  if (q === "moderate") return chalk.yellow(q);
  if (q === "weak") return chalk.red(q);
  return q;
}

const chatModel = createChatModel();

const embeddingsModel = createEmbeddingsModel();
const qdrant = createQdrantClient();

const ui = createUi({
  appName: APP_NAME,
  appVersion: APP_VERSION,
  chatModel,
  contentPath: CONTENT_PATH,
});

const conversationMemory = new Map();

function getConversationHistory(sessionId) {
  if (!conversationMemory.has(sessionId)) {
    conversationMemory.set(sessionId, []);
  }
  return conversationMemory.get(sessionId);
}

function trimConversationHistory(historyMessages) {
  const maxHistoryEntries = historyMessages * 2;
  for (const history of conversationMemory.values()) {
    if (history.length > maxHistoryEntries) {
      history.splice(0, history.length - maxHistoryEntries);
    }
  }
}

const { runtimeConfig, setRuntimeConfigValue } = createRuntimeConfigManager(
  {
    historyMessages: HISTORY_MESSAGES,
    maxSimilarities: MAX_SIMILARITIES,
    minSimilarities: MIN_SIMILARITIES,
    cosineLimit: COSINE_LIMIT,
  },
  trimConversationHistory
);

const DEFAULT_SESSION_ID = "default-session-id";
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const CHAT_HISTORY_FILE = path.join(CHAT_HISTORY_DIR, `session-${SESSION_TIMESTAMP}-${randomUUID()}.jsonl`);
const UPLOAD_PATH = path.resolve(process.cwd(), "upload");
const UPLOADABLE_EXTENSIONS = new Set([".md", ".txt", ".html", ".htm", ".pdf", ".csv"]);

function ensureUploadDirectory() {
  fs.mkdirSync(UPLOAD_PATH, { recursive: true });
}

async function consumeUploadFiles() {
  ensureUploadDirectory();

  const entries = fs.readdirSync(UPLOAD_PATH, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  const uploadedFiles = [];
  const skippedFiles = [];
  const retainedFiles = [];

  for (const file of files) {
    const extension = path.extname(file.name).toLowerCase();
    const fullPath = path.join(UPLOAD_PATH, file.name);

    if (!UPLOADABLE_EXTENSIONS.has(extension)) {
      skippedFiles.push(file.name);
      continue;
    }

    const content = await normalizeIndexableFileByExtension(fullPath, extension);

    if (!content) {
      skippedFiles.push(file.name);
      continue;
    }

    uploadedFiles.push({
      name: file.name,
      content,
    });

    try {
      fs.unlinkSync(fullPath);
    } catch (error) {
      if (error?.code === "EACCES" || error?.code === "EPERM") {
        retainedFiles.push(file.name);
        continue;
      }

      throw error;
    }
  }

  return {
    uploadedFiles,
    skippedFiles,
    retainedFiles,
  };
}

async function buildLibraryInfoMessage() {
  const files = await readEmbeddableFiles();

  if (files.length === 0) {
    return [
      "Library info:",
      `- content path: ${CONTENT_PATH}`,
      `- embeddable extensions: ${EMBEDDABLE_EXTENSIONS.join(", ")}`,
      "- files: 0",
      "- total chunks: 0",
    ].join("\n");
  }

  const perFile = files.map((file) => {
    const chunks = fileToChunks(file);
    return {
      ...file,
      chunkCount: chunks.length,
    };
  });

  const totalChunks = perFile.reduce((sum, file) => sum + file.chunkCount, 0);

  const lines = [
    "Library info:",
    `- content path: ${CONTENT_PATH}`,
    `- embeddable extensions: ${EMBEDDABLE_EXTENSIONS.join(", ")}`,
    `- files: ${perFile.length}`,
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
    lines.push(`  hash: ${file.hash}`);
    lines.push(`  modified: ${modifiedAt}`);
  }

  return lines.join("\n");
}



function getEmbeddingReadiness() {
  const embeddingStatus = readEmbeddingStatus();

  if (!embeddingStatus) {
    return {
      ready: false,
      message:
        `Embedding is not finished yet. Waiting for embedder to write status at ${EMBEDDING_STATUS_FILE}. ` +
        "Please try again shortly.",
    };
  }

  if (embeddingStatus.status === "ready") {
    return {
      ready: true,
      message: "Embedding is finished and the retriever is ready for prompts.",
    };
  }

  if (embeddingStatus.status === "running") {
    return {
      ready: false,
      message:
        `Embedding is currently running (started at ${embeddingStatus.startedAt || "unknown"}). ` +
        "Please wait until it is finished.",
    };
  }

  if (embeddingStatus.status === "error") {
    return {
      ready: false,
      message:
        `Embedding last run failed: ${embeddingStatus.error || "unknown error"}. ` +
        "Please check `docker compose logs -f embedder` and wait for a successful run.",
    };
  }

  return {
    ready: false,
    message: `Embedding status is '${embeddingStatus.status}'. Please wait until it becomes 'ready'.`,
  };
}

function addToHistory(sessionId, role, content) {
  const history = getConversationHistory(sessionId);
  history.push([role, content]);

  const maxHistoryEntries = runtimeConfig.historyMessages * 2;
  if (history.length > maxHistoryEntries) {
    history.splice(0, history.length - maxHistoryEntries);
  }
}

function ensureParentDirectory(filePath) {
  const parent = path.dirname(filePath);
  fs.mkdirSync(parent, { recursive: true });
}

function appendSessionHistoryEntry(entry) {
  try {
    ensureParentDirectory(CHAT_HISTORY_FILE);
    const line = `${JSON.stringify(entry)}\n`;
    fs.appendFileSync(CHAT_HISTORY_FILE, line, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    console.error(`Failed to append chat history entry: ${error.message}`);
  }
}

async function searchKnowledgeBase(userMessage) {
  const userQuestionEmbedding = await embeddingsModel.embedQuery(userMessage);

  const results = await qdrant.search(COLLECTION_NAME, {
    vector: userQuestionEmbedding,
    limit: runtimeConfig.maxSimilarities,
    with_payload: true,
  });

  const filteredResults = results.filter((result) => result.score >= runtimeConfig.cosineLimit);
  const hasSufficientEvidence = filteredResults.length >= runtimeConfig.minSimilarities;
  const evidenceQuality = getEvidenceQuality(filteredResults, runtimeConfig.minSimilarities);

  for (const result of filteredResults) {
    const payload = result.payload || {};
    ui.uiLog("Score:", result.score, "Source:", payload.source || "unknown", "Title:", payload.title || "Untitled");
  }

  ui.uiLog(`Retrieved from Qdrant: ${results.length}`);
  ui.uiLog(`Passed threshold (${runtimeConfig.cosineLimit}): ${filteredResults.length}`);
  ui.uiLog(`MIN_SIMILARITIES required: ${runtimeConfig.minSimilarities}`);
  ui.uiLog(`Sufficient evidence: ${hasSufficientEvidence ? chalk.green("YES") : chalk.red("NO")}`);
  ui.uiLog(`Evidence quality: ${colorEvidenceQuality(evidenceQuality)}`);
  ui.uiLog("_______________________________________________________");
  ui.uiLog();

  return {
    results: filteredResults,
    evidenceQuality,
    hasSufficientEvidence,
    ragContextPackage: buildRagContextPackage({
      results: filteredResults,
      userMessage,
      evidenceQuality,
    }),
  };
}

const guardrailsText = loadGuardrails();
let assistantMode = normalizeAssistantMode(process.env.ASSISTANT_MODE || DEFAULT_ASSISTANT_MODE);
const personalizationSettings = getDefaultPersonalizationSettings();

validateRetrievalConfig();
ui.renderLoadingScreen();
ui.printAssistantMessage("Retriever service is ready.");
ui.printAssistantMessage("Embedding runs in a separate embedder container.");
const initialEmbeddingReadiness = getEmbeddingReadiness();
ui.printAssistantMessage(initialEmbeddingReadiness.message);
ui.printAssistantMessage("How can I help you today?");
ensureUploadDirectory();
ui.uiLog(`Chat history file: ${CHAT_HISTORY_FILE}`);

let exit = false;
let pendingWeakAnswer = null;
while (!exit) {
  const response = await prompts({
    type: "text",
    name: "userMessage",
    message: ui.promptColor(">"),
  });

  const userMessage = response.userMessage;
  if (!userMessage) {
    continue;
  }

  const normalizedUserMessage = String(userMessage).trim().toLowerCase();
  ui.resetConversationView();

  if (pendingWeakAnswer) {
    if (["/bye", "/exit", "/quit"].includes(normalizedUserMessage)) {
      console.log("See you later!");
      exit = true;
      continue;
    }

    if (["/yes", "/y"].includes(normalizedUserMessage)) {
      ui.printAssistantMessage(pendingWeakAnswer.assistantResponse);
      ui.printEvidenceQuality(pendingWeakAnswer.evidenceQuality);
      pendingWeakAnswer = null;
      continue;
    }

    if (["/no", "/skip"].includes(normalizedUserMessage)) {
      ui.printAssistantMessage(
        "Okay, skipped displaying the weak-evidence answer. Your question and generated answer were still saved to chat history."
      );
      pendingWeakAnswer = null;
      continue;
    }

    ui.printAssistantMessage("Please confirm with /yes to show the answer, or /no (or /skip) to hide it.");
    continue;
  }

  if (["/bye", "/exit", "/quit"].includes(normalizedUserMessage)) {
    console.log("See you later!");
    exit = true;
    continue;
  }

  if (normalizedUserMessage === "/mode clean") {
    ui.setTuiMode("clean");
    ui.renderModeChanged("clean");
    continue;
  }

  if (normalizedUserMessage === "/mode rag") {
    ui.setTuiMode("rag");
    ui.renderModeChanged("rag");
    continue;
  }

  if (normalizedUserMessage === "/assistant") {
    const modeList = listAssistantModes()
      .map((mode) => `- ${mode.id}: ${mode.description}`)
      .join("\n");

    ui.printAssistantMessage(
      [
        "Assistant modes:",
        "",
        "In this system, assistant mode defines the system-level response behavior used to generate answers.",
        "",
        modeList,
        "",
        `Current mode: ${assistantMode}`,
        "Use /assistant <mode>, e.g. /assistant learning or /assistant normal.",
      ].join("\n")
    );
    continue;
  }

  if (normalizedUserMessage.startsWith("/assistant ")) {
    const requestedMode = normalizedUserMessage.slice("/assistant ".length).trim();
    const nextMode = normalizeAssistantMode(requestedMode);

    if (nextMode !== requestedMode) {
      ui.printAssistantMessage(
        `Unsupported assistant mode: ${requestedMode}. Use /assistant to see available modes.`
      );
      continue;
    }

    assistantMode = nextMode;
    ui.printAssistantMessage(`Assistant mode changed to: ${assistantMode}`);
    continue;
  }

  if (normalizedUserMessage === "/info") {
    ui.printAssistantMessage(buildSystemInfoMessage({
      appName: APP_NAME,
      appVersion: APP_VERSION,
      uiMode: ui.getTuiMode(),
      assistantMode,
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
    }));
    continue;
  }

  if (normalizedUserMessage === "/help" || normalizedUserMessage === "?") {
    ui.printAssistantMessage(buildHelpMessage());
    continue;
  }

  if (normalizedUserMessage === "/embed") {
    ui.printAssistantMessage(
      "Embedding is now handled by a dedicated embedder container. Use `docker compose logs -f embedder` to monitor indexing."
    );
    continue;
  }

  if (normalizedUserMessage === "/lib") {
    ui.setPendingStatus("Collecting library metadata...");
    const libraryInfoMessage = await buildLibraryInfoMessage();
    ui.setPendingStatus(null);
    ui.printAssistantMessage(libraryInfoMessage);
    continue;
  }

  if (normalizedUserMessage === "/config") {
    ui.printAssistantMessage(buildActiveConfigMessage(runtimeConfig, {
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
    }));
    continue;
  }

  if (normalizedUserMessage.startsWith("/config set ")) {
    const parsed = parseConfigSetCommand(userMessage);

    if (!parsed) {
      ui.printAssistantMessage(
        "Invalid format. Use: /config set <name> <value> or /config set '<name>'=<value>"
      );
      continue;
    }

    const update = setRuntimeConfigValue(parsed.configName, parsed.rawValue);
    ui.printAssistantMessage(update.message);
    continue;
  }

  const embeddingReadiness = getEmbeddingReadiness();
  if (!embeddingReadiness.ready) {
    ui.printAssistantMessage(embeddingReadiness.message);
    continue;
  }

  let promptForRetrieval = userMessage;
  let promptForAssistant = userMessage;

  if (normalizedUserMessage === "/upload" || normalizedUserMessage.startsWith("/upload ")) {
    const promptAfterUpload = userMessage.slice("/upload".length).trim();

    if (!promptAfterUpload) {
      ui.printAssistantMessage("Use /upload <your prompt>. Example: /upload summarize these notes.");
      continue;
    }

    const { uploadedFiles, skippedFiles, retainedFiles } = await consumeUploadFiles();

    if (uploadedFiles.length === 0) {
      const reason =
        skippedFiles.length > 0
          ? `Found unsupported or empty file types in ./upload (${skippedFiles.join(", ")}). Only .md, .txt, .html, .htm, .pdf, and .csv with indexable text are allowed.`
          : "No files found in ./upload.";

      ui.printAssistantMessage(`Nothing was uploaded. ${reason}`);
      continue;
    }

    const uploadedContext = uploadedFiles
      .map((file) => [`UPLOAD FILE: ${file.name}`, file.content.trim()].join("\n"))
      .join("\n\n---\n\n");

    const skippedNotice =
      skippedFiles.length > 0
        ? `\n\nUnsupported files were ignored and kept in ./upload: ${skippedFiles.join(", ")}`
        : "";

    const retainedNotice =
      retainedFiles.length > 0
        ? `\n\nSome uploaded files could not be deleted due to permissions and were kept in ./upload: ${retainedFiles.join(", ")}`
        : "";

    promptForRetrieval = promptAfterUpload;
    promptForAssistant = `${promptAfterUpload}\n\nONE-TIME UPLOADED FILE CONTEXT\n${uploadedContext}${skippedNotice}${retainedNotice}`;

    ui.printAssistantMessage(`Uploaded ${uploadedFiles.length} file(s) from ./upload for this prompt only.`);
  }

  ui.printUserMessage(userMessage);
  ui.setPendingStatus("Searching knowledge base...");

  const history = getConversationHistory(DEFAULT_SESSION_ID);
  const { ragContextPackage, evidenceQuality, results } = await searchKnowledgeBase(promptForRetrieval);
  ui.setPendingSimilarityDetails(createSimilarityDetails(results, runtimeConfig));
  ui.setPendingStatus("Generating answer...");

  const messages = [
    ...buildSystemPromptLayers({
      guardrailsText,
      ragContextPackage,
      assistantMode,
      sessionId: DEFAULT_SESSION_ID,
      personalizationSettings,
    }),
    ...history,
    ["user", promptForAssistant],
  ];

  let assistantResponse = "";
  const stream = await chatModel.stream(messages);
  for await (const chunk of stream) {
    assistantResponse += chunk.content;
  }

  ui.setPendingStatus(null);

  if (evidenceQuality === "weak") {
    pendingWeakAnswer = {
      assistantResponse,
      evidenceQuality,
    };

    ui.printAssistantMessage(
      "Evidence quality is WEAK for this topic. The generated answer may be unreliable. " +
        "Do you still want to display it? Use /yes to show it, or /no or /skip to hide it."
    );
  } else {
    ui.printAssistantMessage(assistantResponse);
    ui.printEvidenceQuality(evidenceQuality);
  }

  addToHistory(DEFAULT_SESSION_ID, "user", userMessage);
  addToHistory(DEFAULT_SESSION_ID, "assistant", assistantResponse);

  appendSessionHistoryEntry({
    timestamp: new Date().toISOString(),
    sessionId: DEFAULT_SESSION_ID,
    user: userMessage,
    assistant: assistantResponse,
    evidenceQuality,
  });
}
