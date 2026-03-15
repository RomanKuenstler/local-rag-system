import fs from "fs";
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

function getEvidenceQuality(results) {
  if (!results || results.length === 0 || results.length < MIN_SIMILARITIES) {
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
    requestedLimit: MAX_SIMILARITIES,
    cosineLimit: COSINE_LIMIT,
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
  ].join("\n");
}

function buildActiveConfigMessage() {
  return [
    "Active configuration:",
    "- retrieval:",
    `  - history messages: ${HISTORY_MESSAGES}`,
    `  - max similarities: ${MAX_SIMILARITIES}`,
    `  - min similarities: ${MIN_SIMILARITIES}`,
    `  - cosine limit: ${COSINE_LIMIT}`,
    "- chunking/indexing:",
    `  - chunk size: ${CHUNK_SIZE}`,
    `  - chunk overlap: ${CHUNK_OVERLAP}`,
    `  - max embedding chars: ${MAX_EMBEDDING_CHARS}`,
    `  - pdf min extracted chars: ${PDF_MIN_EXTRACTED_CHARS}`,
    `  - index schema version: ${INDEX_SCHEMA_VERSION}`,
    `  - index state file: ${INDEX_STATE_FILE}`,
    "- generation:",
    `  - temperature: ${process.env.OPTION_TEMPERATURE || "0.0"}`,
    `  - top_p: ${process.env.OPTION_TOP_P || "0.5"}`,
    `  - presence penalty: ${process.env.OPTION_PRESENCE_PENALTY || "2.2"}`,
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

  if (history.length > HISTORY_MESSAGES * 2) {
    history.splice(0, 2);
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
    fs.writeFileSync(INDEX_STATE_FILE, JSON.stringify(state, null, 2), "utf8");
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
    limit: MAX_SIMILARITIES,
    with_payload: true,
  });

  const filteredResults = results.filter((result) => result.score >= COSINE_LIMIT);
  const hasSufficientEvidence = filteredResults.length >= MIN_SIMILARITIES;
  const evidenceQuality = getEvidenceQuality(filteredResults);

  for (const result of filteredResults) {
    const payload = result.payload || {};
    ui.uiLog("Score:", result.score, "Source:", payload.source || "unknown", "Title:", payload.title || "Untitled");
  }

  ui.uiLog(`Retrieved from Qdrant: ${results.length}`);
  ui.uiLog(`Passed threshold (${COSINE_LIMIT}): ${filteredResults.length}`);
  ui.uiLog(`MIN_SIMILARITIES required: ${MIN_SIMILARITIES}`);
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
ui.renderStartupScreen();

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

  if (userMessage === "/bye") {
    console.log("See you later!");
    exit = true;
    continue;
  }

  if (userMessage === "/mode clean") {
    ui.setTuiMode("clean");
    ui.renderModeChanged("clean");
    continue;
  }

  if (userMessage === "/mode rag") {
    ui.setTuiMode("rag");
    ui.renderModeChanged("rag");
    continue;
  }

  if (userMessage === "/info") {
    ui.printAssistantMessage(buildSystemInfoMessage());
    continue;
  }

  if (userMessage === "/lib") {
    ui.setPendingStatus("Collecting library metadata...");
    const libraryInfoMessage = await buildLibraryInfoMessage();
    ui.setPendingStatus(null);
    ui.printAssistantMessage(libraryInfoMessage);
    continue;
  }

  if (userMessage === "/config") {
    ui.printAssistantMessage(buildActiveConfigMessage());
    continue;
  }

  ui.printUserMessage(userMessage);
  ui.setPendingStatus("Searching knowledge base...");

  const history = getConversationHistory("default-session-id");
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
  addToHistory("default-session-id", "user", userMessage);
  addToHistory("default-session-id", "assistant", assistantResponse);
}
