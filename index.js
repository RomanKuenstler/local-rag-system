import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import prompts from "prompts";
import chalk from "chalk";
import { ChatOpenAI } from "@langchain/openai";
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
  HISTORY_MESSAGES,
  INDEX_SCHEMA_VERSION,
  INDEX_STATE_FILE,
  MAX_EMBEDDING_CHARS,
  MAX_SIMILARITIES,
  MIN_SIMILARITIES,
  PDF_MIN_EXTRACTED_CHARS,
  QDRANT_URL,
  validateRetrievalConfig,
} from "./src/config.js";
import { createUi } from "./src/ui.js";
import { buildSystemPromptLayers, loadGuardrails } from "./src/guardrails.js";
import { createRuntimeConfigManager, parseConfigSetCommand } from "./src/runtime-config.js";
import {
  buildActiveConfigMessage,
  buildHelpMessage,
  buildRagContextPackage,
  buildSystemInfoMessage,
  createSimilarityDetails,
  formatBytes,
  getEvidenceQuality,
} from "./src/messages.js";
import { createEmbeddingsModel, createQdrantClient, fileToChunks, readEmbeddableFiles } from "./src/embedding-service.js";

function colorEvidenceQuality(q) {
  if (q === "strong") return chalk.green(q);
  if (q === "moderate") return chalk.yellow(q);
  if (q === "weak") return chalk.red(q);
  return q;
}

const chatModel = new ChatOpenAI({
  model:
    process.env.MODEL_RUNNER_LLM_CHAT ||
    "hf.co/qwen/qwen2.5-coder-3b-instruct-gguf:q4_k_m",
  apiKey: "",
  configuration: {
    baseURL:
      process.env.MODEL_RUNNER_BASE_URL ||
      "http://localhost:12434/engines/llama.cpp/v1/",
  },
  temperature: parseFloat(process.env.OPTION_TEMPERATURE || "0.0"),
  top_p: parseFloat(process.env.OPTION_TOP_P || "0.5"),
  presencePenalty: parseFloat(process.env.OPTION_PRESENCE_PENALTY || "2.2"),
});

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

validateRetrievalConfig();
ui.renderLoadingScreen();
ui.printAssistantMessage("Retriever service is ready.");
ui.printAssistantMessage("Embedding runs in a separate embedder container.");
ui.printAssistantMessage("How can I help you today?");
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

  if (normalizedUserMessage === "/info") {
    ui.printAssistantMessage(buildSystemInfoMessage({
      appName: APP_NAME,
      appVersion: APP_VERSION,
      uiMode: ui.getTuiMode(),
      chatModelName: chatModel.model,
      embeddingModelName: embeddingsModel.model,
      qdrantUrl: QDRANT_URL,
      collectionName: COLLECTION_NAME,
      contentPath: CONTENT_PATH,
      embeddableExtensions: EMBEDDABLE_EXTENSIONS,
      chatHistoryDir: CHAT_HISTORY_DIR,
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

  ui.printUserMessage(userMessage);
  ui.setPendingStatus("Searching knowledge base...");

  const history = getConversationHistory(DEFAULT_SESSION_ID);
  const { ragContextPackage, evidenceQuality, results } = await searchKnowledgeBase(userMessage);
  ui.setPendingSimilarityDetails(createSimilarityDetails(results, runtimeConfig));
  ui.setPendingStatus("Generating answer...");

  const messages = [
    ...buildSystemPromptLayers({
      guardrailsText,
      ragContextPackage,
    }),
    ...history,
    ["user", userMessage],
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
