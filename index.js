import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import prompts from "prompts";
import chalk from "chalk";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { QdrantClient } from "@qdrant/js-client-rest";
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
  INDEX_STATE_FILE,
  INDEX_SCHEMA_VERSION,
  MAX_EMBEDDING_CHARS,
  PDF_MIN_EXTRACTED_CHARS,
  MAX_SIMILARITIES,
  MIN_SIMILARITIES,
  QDRANT_API_KEY,
  QDRANT_URL,
  validateRetrievalConfig,
} from "./src/config.js";
import { createUi } from "./src/ui.js";
import { enforceEmbeddingSizeLimit, splitMarkdownBySectionsWithMetadata, splitTextIntoOverlappingChunks } from "./src/chunking.js";
import { readTextFilesRecursively } from "./src/document-processing.js";

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

const embeddingsModel = new OpenAIEmbeddings({
  model: process.env.MODEL_RUNNER_LLM_EMBEDDING || "ai/embeddinggemma:latest",
  configuration: {
    baseURL:
      process.env.MODEL_RUNNER_BASE_URL ||
      "http://localhost:12434/engines/llama.cpp/v1/",
    apiKey: "",
  },
});

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY,
  checkCompatibility: false,
});

const ui = createUi({
  appName: APP_NAME,
  appVersion: APP_VERSION,
  chatModel,
  contentPath: CONTENT_PATH,
});

const runtimeConfig = {
  historyMessages: HISTORY_MESSAGES,
  maxSimilarities: MAX_SIMILARITIES,
  minSimilarities: MIN_SIMILARITIES,
  cosineLimit: COSINE_LIMIT,
};

const DEFAULT_SESSION_ID = "default-session-id";
const SESSION_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, "-");
const CHAT_HISTORY_FILE = path.join(CHAT_HISTORY_DIR, `session-${SESSION_TIMESTAMP}-${randomUUID()}.jsonl`);

const runtimeConfigSchema = {
  "history messages": {
    key: "historyMessages",
    parse: parseIntegerConfig,
    validate: (value) => {
      if (!Number.isInteger(value) || value < 1) {
        return "must be an integer >= 1";
      }
      return null;
    },
  },
  "max similarities": {
    key: "maxSimilarities",
    parse: parseIntegerConfig,
    validate: (value, config) => {
      if (!Number.isInteger(value) || value < 1) {
        return "must be an integer >= 1";
      }
      if (value < config.minSimilarities) {
        return `must be >= min similarities (${config.minSimilarities})`;
      }
      return null;
    },
  },
  "min similarities": {
    key: "minSimilarities",
    parse: parseIntegerConfig,
    validate: (value, config) => {
      if (!Number.isInteger(value) || value < 0) {
        return "must be an integer >= 0";
      }
      if (value > config.maxSimilarities) {
        return `must be <= max similarities (${config.maxSimilarities})`;
      }
      return null;
    },
  },
  "cosine limit": {
    key: "cosineLimit",
    parse: parseFloatConfig,
    validate: (value) => {
      if (!Number.isFinite(value)) {
        return "must be a valid number";
      }
      if (value < 0 || value > 1) {
        return "must be between 0 and 1";
      }
      return null;
    },
  },
};

function parseIntegerConfig(rawValue) {
  const parsed = Number.parseInt(String(rawValue), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseFloatConfig(rawValue) {
  const parsed = Number.parseFloat(String(rawValue));
  return Number.isNaN(parsed) ? null : parsed;
}

function getConfigFieldMetadata(name) {
  const normalized = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/\s+/g, " ");

  return runtimeConfigSchema[normalized] || null;
}

function parseConfigSetCommand(input) {
  const trimmed = String(input || "").trim();
  const noPrefix = trimmed.replace(/^\/config\s+set\s+/i, "").trim();

  const quotedMatch = noPrefix.match(/^['"](.+?)['"]\s*(?:=|\s+)\s*(.+)$/);
  if (quotedMatch) {
    return {
      configName: quotedMatch[1],
      rawValue: quotedMatch[2],
    };
  }

  const parts = noPrefix.split(/\s*=\s*|\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return {
      configName: parts.slice(0, -1).join(" "),
      rawValue: parts[parts.length - 1],
    };
  }

  return null;
}

function setRuntimeConfigValue(configName, rawValue) {
  const field = getConfigFieldMetadata(configName);

  if (!field) {
    return {
      ok: false,
      message:
        `Unknown config \"${configName}\". Changeable keys: ` +
        `${Object.keys(runtimeConfigSchema).join(", ")}.`,
    };
  }

  const parsedValue = field.parse(rawValue);
  if (parsedValue === null) {
    return {
      ok: false,
      message: `Invalid value \"${rawValue}\" for ${configName}.`,
    };
  }

  const candidate = {
    ...runtimeConfig,
    [field.key]: parsedValue,
  };
  const validationError = field.validate(parsedValue, candidate);

  if (validationError) {
    return {
      ok: false,
      message: `Invalid ${configName}: ${validationError}.`,
    };
  }

  const previousValue = runtimeConfig[field.key];
  runtimeConfig[field.key] = parsedValue;

  if (field.key === "historyMessages") {
    const maxHistoryEntries = runtimeConfig.historyMessages * 2;
    for (const history of conversationMemory.values()) {
      if (history.length > maxHistoryEntries) {
        history.splice(0, history.length - maxHistoryEntries);
      }
    }
  }

  return {
    ok: true,
    message: `Updated ${configName}: ${previousValue} -> ${parsedValue}`,
  };
}

function getEvidenceQuality(results) {
  if (!results || results.length === 0 || results.length < runtimeConfig.minSimilarities) {
    return "weak";
  }

  const scores = results.map((result) => result.score ?? 0);
  const maxScore = Math.max(...scores);
  const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;

  if (maxScore >= 0.82 && avgScore >= 0.72) {
    return "strong";
  }
  if (maxScore >= 0.62 && avgScore >= 0.55) {
    return "moderate";
  }

  return "weak";
}

function formatEvidenceEntry(result, index) {
  const payload = result.payload || {};

  return [
    `EVIDENCE #${index + 1}`,
    `score: ${result.score?.toFixed(4) ?? "n/a"}`,
    `source: ${payload.source || "unknown"}`,
    `title: ${payload.title || "Untitled"}`,
    "content:",
    `${payload.text || ""}`,
  ].join("\n");
}

function createSimilarityDetails(results) {
  return {
    requestedLimit: runtimeConfig.maxSimilarities,
    cosineLimit: runtimeConfig.cosineLimit,
    matches: results.map((result, index) => {
      const payload = result.payload || {};
      const preview = String(payload.text || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);

      return {
        rank: index + 1,
        score: result.score,
        source: payload.source || "unknown",
        title: payload.title || "",
        preview,
      };
    }),
  };
}

function buildRagContextPackage({ results, userMessage, evidenceQuality }) {
  const evidenceBlock = results.map((result, index) => formatEvidenceEntry(result, index)).join("\n\n---\n\n");

  return `RETRIEVAL RESULT
Evidence quality: ${evidenceQuality}
Evidence quality meaning: strong|moderate|weak

${evidenceBlock || "No evidence retrieved."}

INSTRUCTIONS FOR THIS TASK
- Answer the user's question using the retrieved knowledge as the primary source.
- If the evidence is partial, answer only what is supported and clearly indicate what is missing.
- If the evidence is insufficient, say that the knowledge base does not contain enough information.
- If you provide additional general knowledge, clearly label it as general knowledge and not as knowledge-base content.

USER QUESTION
${userMessage}`;
}

function buildSystemInfoMessage() {
  return [
    "System info:",
    `- app: ${APP_NAME} ${APP_VERSION}`,
    `- ui mode: ${ui.getTuiMode()}`,
    `- chat model: ${chatModel.model || "unknown"}`,
    `- embedding model: ${embeddingsModel.model || "unknown"}`,
    `- vector db: qdrant (${QDRANT_URL})`,
    `- collection: ${COLLECTION_NAME}`,
    `- content path: ${CONTENT_PATH}`,
    `- embeddable extensions: ${EMBEDDABLE_EXTENSIONS.join(", ")}`,
    `- chat history dir: ${CHAT_HISTORY_DIR}`,
  ].join("\n");
}

function buildActiveConfigMessage() {
  const runtimeChangeableLabel = chalk.green("runtime-changeable");
  const restartOnlyLabel = chalk.yellow("requires restart");

  return [
    "Active configuration:",
    "",
    chalk.bold("Retrieval"),
    `  - history messages: ${runtimeConfig.historyMessages} (${runtimeChangeableLabel})`,
    `  - max similarities: ${runtimeConfig.maxSimilarities} (${runtimeChangeableLabel})`,
    `  - min similarities: ${runtimeConfig.minSimilarities} (${runtimeChangeableLabel})`,
    `  - cosine limit: ${runtimeConfig.cosineLimit} (${runtimeChangeableLabel})`,
    "",
    chalk.bold("Chunking / Indexing"),
    `  - chunk size: ${CHUNK_SIZE} (${restartOnlyLabel})`,
    `  - chunk overlap: ${CHUNK_OVERLAP} (${restartOnlyLabel})`,
    `  - max embedding chars: ${MAX_EMBEDDING_CHARS} (${restartOnlyLabel})`,
    `  - pdf min extracted chars: ${PDF_MIN_EXTRACTED_CHARS} (${restartOnlyLabel})`,
    `  - index schema version: ${INDEX_SCHEMA_VERSION} (${restartOnlyLabel})`,
    `  - index state file: ${INDEX_STATE_FILE} (${restartOnlyLabel})`,
    `  - chat history dir: ${CHAT_HISTORY_DIR} (${restartOnlyLabel})`,
    "",
    chalk.bold("Generation"),
    `  - temperature: ${process.env.OPTION_TEMPERATURE || "0.0"} (${restartOnlyLabel})`,
    `  - top_p: ${process.env.OPTION_TOP_P || "0.5"} (${restartOnlyLabel})`,
    `  - presence penalty: ${process.env.OPTION_PRESENCE_PENALTY || "2.2"} (${restartOnlyLabel})`,
    "",
    "Tip: use /config set <name> <value>, e.g. /config set 'min similarities' 3",
  ].join("\n");
}

function buildHelpMessage() {
  return [
    "Quick help",
    "",
    "Ask any question about your indexed documents in natural language.",
    "The assistant retrieves matching context from the knowledge base before answering.",
    "",
    "Commands:",
    "- /help or ?       Show this help overview",
    "- /info            Show system details (models, DB, paths)",
    "- /lib             Show indexed library files and chunk counts",
    "- /config          Show active retrieval/runtime configuration",
    "- /config set ...  Update a runtime setting",
    "                  Example: /config set 'min similarities' 3",
    "- /mode clean      Switch to clean chat-focused UI",
    "- /mode rag        Switch to debug RAG UI with similarity details",
    "- /bye | /exit | /quit  Exit the application",
    "",
    "Tips:",
    "- Ask precise questions for better retrieval.",
    "- Use /mode rag to inspect evidence quality and matching chunks.",
  ].join("\n");
}

function formatBytes(sizeInBytes) {
  if (!Number.isFinite(sizeInBytes) || sizeInBytes < 0) {
    return "n/a";
  }

  if (sizeInBytes < 1024) {
    return `${sizeInBytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = sizeInBytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

async function buildLibraryInfoMessage() {
  const files = await readTextFilesRecursively(CONTENT_PATH, EMBEDDABLE_EXTENSIONS);

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
    "Embedded files:",
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

const conversationMemory = new Map();

function getConversationHistory(sessionId) {
  if (!conversationMemory.has(sessionId)) {
    conversationMemory.set(sessionId, []);
  }
  return conversationMemory.get(sessionId);
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

function writeFileAtomic(filePath, content) {
  ensureParentDirectory(filePath);
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
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

function loadIndexState() {
  try {
    if (!fs.existsSync(INDEX_STATE_FILE)) {
      return {};
    }

    return JSON.parse(fs.readFileSync(INDEX_STATE_FILE, "utf8"));
  } catch (error) {
    console.error(`Failed to load index state: ${error.message}`);
    return {};
  }
}

function saveIndexState(state) {
  try {
    writeFileAtomic(INDEX_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    console.error(`Failed to save index state: ${error.message}`);
  }
}

async function collectionExists(collectionName) {
  const collections = await qdrant.getCollections();
  return collections.collections.some((collection) => collection.name === collectionName);
}

async function ensureCollection(vectorSize) {
  const exists = await collectionExists(COLLECTION_NAME);

  if (!exists) {
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: {
        size: vectorSize,
        distance: "Cosine",
      },
    });

    for (const field of ["source", "filename", "extension", "documentHash"]) {
      await qdrant.createPayloadIndex(COLLECTION_NAME, {
        field_name: field,
        field_schema: "keyword",
      });
    }

    console.log(`Qdrant collection "${COLLECTION_NAME}" created`);
    return;
  }

  const info = await qdrant.getCollection(COLLECTION_NAME);
  const currentSize =
    info?.config?.params?.vectors && !Array.isArray(info.config.params.vectors)
      ? info.config.params.vectors.size
      : null;

  if (currentSize === vectorSize) {
    return;
  }

  console.log(`Vector size changed (${currentSize} -> ${vectorSize}), recreating collection...`);
  await qdrant.deleteCollection(COLLECTION_NAME);
  await qdrant.createCollection(COLLECTION_NAME, {
    vectors: {
      size: vectorSize,
      distance: "Cosine",
    },
  });

  for (const field of ["source", "filename", "extension", "documentHash"]) {
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: field,
      field_schema: "keyword",
    });
  }

  console.log(`Qdrant collection "${COLLECTION_NAME}" recreated`);
}

async function deletePointsBySource(relativePath) {
  await qdrant.delete(COLLECTION_NAME, {
    wait: true,
    filter: {
      must: [
        {
          key: "source",
          match: {
            value: relativePath,
          },
        },
      ],
    },
  });
}

function fileToChunks(file) {
  let sections;

  if ([".md", ".html", ".htm", ".pdf"].includes(file.extension)) {
    sections = splitMarkdownBySectionsWithMetadata(file.content);
  } else {
    const trimmed = file.content.trim();
    sections = trimmed ? [{ title: file.filename, content: trimmed }] : [];
  }

  const chunkRecords = [];
  let globalChunkIndex = 0;

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex];
    const subchunks = splitTextIntoOverlappingChunks(section.content, CHUNK_SIZE, CHUNK_OVERLAP);

    for (let subchunkIndex = 0; subchunkIndex < subchunks.length; subchunkIndex++) {
      const subchunkText = subchunks[subchunkIndex]?.trim();
      if (!subchunkText) {
        continue;
      }

      chunkRecords.push({
        id: randomUUID(),
        text: subchunkText,
        title: section.title,
        chunkIndex: globalChunkIndex,
        sectionIndex,
        subchunkIndex,
        source: file.relativePath,
        filename: file.filename,
        extension: file.extension,
        documentHash: file.hash,
      });

      globalChunkIndex++;
    }
  }

  return enforceEmbeddingSizeLimit(chunkRecords);
}

async function indexChangedDocuments() {
  const startupLog = (...args) => ui.uiLog(...args);

  startupLog("_______________________________________________________");
  startupLog("Embeddings model:", embeddingsModel.model);
  startupLog(`Reading documents from: ${CONTENT_PATH}`);

  const files = await readTextFilesRecursively(CONTENT_PATH, EMBEDDABLE_EXTENSIONS);
  startupLog(`Files found: ${files.length}`);

  if (files.length === 0) {
    startupLog("No files found to index.");
    startupLog("_______________________________________________________");
    return;
  }

  const indexState = loadIndexState();
  const changedFiles = files.filter((file) => indexState[file.relativePath] !== file.hash);
  const removedFiles = Object.keys(indexState).filter(
    (relativePath) => !files.some((file) => file.relativePath === relativePath)
  );

  startupLog(`Changed/new files: ${changedFiles.length}`);
  startupLog(`Removed files: ${removedFiles.length}`);

  if (changedFiles.length === 0 && removedFiles.length === 0) {
    startupLog("No indexing needed.");
    startupLog("_______________________________________________________");
    return;
  }

  const probeEmbedding = await embeddingsModel.embedQuery("dimension probe");
  await ensureCollection(probeEmbedding.length);

  for (const removedFile of removedFiles) {
    try {
      startupLog(`Removing deleted file from index: ${removedFile}`);
      await deletePointsBySource(removedFile);
      delete indexState[removedFile];
    } catch (error) {
      console.error(`Failed removing ${removedFile}: ${error.message}`);
    }
  }

  for (const file of changedFiles) {
    try {
      startupLog(`Indexing file: ${file.relativePath}`);
      await deletePointsBySource(file.relativePath);

      const chunkRecords = fileToChunks(file).filter((chunk) => chunk.text?.trim());
      if (chunkRecords.length === 0) {
        startupLog(`No chunks for file: ${file.relativePath}`);
        indexState[file.relativePath] = file.hash;
        continue;
      }

      const chunkLengths = chunkRecords.map((chunk) => chunk.text.length);
      const maxChunkLength = chunkLengths.length > 0 ? Math.max(...chunkLengths) : 0;
      const avgChunkLength =
        chunkLengths.length > 0
          ? Math.round(chunkLengths.reduce((total, length) => total + length, 0) / chunkLengths.length)
          : 0;

      startupLog(
        `Prepared ${chunkRecords.length} chunks from ${file.relativePath} ` +
          `(avg chars: ${avgChunkLength}, max chars: ${maxChunkLength})`
      );

      const embeddings = await embeddingsModel.embedDocuments(chunkRecords.map((chunk) => chunk.text));
      const points = chunkRecords.map((chunk, index) => ({
        id: chunk.id,
        vector: embeddings[index],
        payload: {
          text: chunk.text,
          title: chunk.title,
          source: chunk.source,
          filename: chunk.filename,
          extension: chunk.extension,
          chunkIndex: chunk.chunkIndex,
          sectionIndex: chunk.sectionIndex,
          subchunkIndex: chunk.subchunkIndex,
          documentHash: chunk.documentHash,
        },
      }));

      await qdrant.upsert(COLLECTION_NAME, { wait: true, points });
      indexState[file.relativePath] = file.hash;
    } catch (error) {
      console.error(`Error indexing ${file.relativePath}: ${error.message}`);
    }
  }

  saveIndexState(indexState);
  startupLog("Index state saved");
  startupLog("_______________________________________________________");
  startupLog();
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
  const evidenceQuality = getEvidenceQuality(filteredResults);

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

let systemInstructions = fs.readFileSync("/app/system.instructions.md", "utf8");

validateRetrievalConfig();
ui.renderLoadingScreen();
await indexChangedDocuments();
ui.printAssistantMessage("Knowledge base is ready. Indexing completed successfully.");
ui.printAssistantMessage("How can I help you today?");
ui.uiLog(`Chat history file: ${CHAT_HISTORY_FILE}`);

let exit = false;
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
    ui.printAssistantMessage(buildSystemInfoMessage());
    continue;
  }

  if (normalizedUserMessage === "/help" || normalizedUserMessage === "?") {
    ui.printAssistantMessage(buildHelpMessage());
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
    ui.printAssistantMessage(buildActiveConfigMessage());
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
  ui.setPendingSimilarityDetails(createSimilarityDetails(results));
  ui.setPendingStatus("Generating answer...");

  const messages = [
    ["system", systemInstructions],
    ["system", ragContextPackage],
    ...history,
    ["user", userMessage],
  ];

  let assistantResponse = "";
  const stream = await chatModel.stream(messages);
  for await (const chunk of stream) {
    assistantResponse += chunk.content;
  }

  ui.setPendingStatus(null);
  ui.printAssistantMessage(assistantResponse);
  ui.printEvidenceQuality(evidenceQuality);
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
