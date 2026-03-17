import fs from "fs";
import http from "http";
import { ChatOpenAI } from "@langchain/openai";
import {
  APP_NAME,
  APP_VERSION,
  COLLECTION_NAME,
  CONTENT_PATH,
  COSINE_LIMIT,
  HISTORY_MESSAGES,
  INDEX_STATE_FILE,
  MAX_SIMILARITIES,
  MIN_SIMILARITIES,
  QDRANT_URL,
  validateRetrievalConfig,
} from "./src/config.js";
import { buildSystemPromptLayers, loadGuardrails } from "./src/guardrails.js";
import {
  DEFAULT_ASSISTANT_MODE,
  normalizeAssistantMode,
} from "./src/assistant-modes.js";
import {
  DEFAULT_PROFILE,
  normalizeProfile,
} from "./src/profiles.js";
import {
  buildRagContextPackage,
  createSimilarityDetails,
  getEvidenceQuality,
} from "./src/messages.js";
import {
  createEmbeddingsModel,
  createQdrantClient,
  fileToChunks,
  readEmbeddableFiles,
  readEmbeddingStatus,
} from "./src/embedding-service.js";

validateRetrievalConfig();

const PORT = parseInt(process.env.RETRIEVER_API_PORT || "3000", 10);
const HOST = process.env.RETRIEVER_API_HOST || "0.0.0.0";
const assistantMode = normalizeAssistantMode(process.env.ASSISTANT_MODE || DEFAULT_ASSISTANT_MODE);
const profileId = normalizeProfile(process.env.ASSISTANT_PROFILE || DEFAULT_PROFILE);
const guardrailsText = loadGuardrails();

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
const sessionMemory = new Map();

function getSessionHistory(sessionId) {
  if (!sessionMemory.has(sessionId)) {
    sessionMemory.set(sessionId, []);
  }

  return sessionMemory.get(sessionId);
}

function appendHistory(sessionId, role, content) {
  const history = getSessionHistory(sessionId);
  history.push([role, content]);

  const maxHistoryEntries = HISTORY_MESSAGES * 2;
  if (history.length > maxHistoryEntries) {
    history.splice(0, history.length - maxHistoryEntries);
  }
}

async function searchKnowledgeBase(prompt) {
  const userQuestionEmbedding = await embeddingsModel.embedQuery(prompt);
  const results = await qdrant.search(COLLECTION_NAME, {
    vector: userQuestionEmbedding,
    limit: MAX_SIMILARITIES,
    with_payload: true,
  });

  const filteredResults = results.filter((result) => result.score >= COSINE_LIMIT);
  const hasSufficientEvidence = filteredResults.length >= MIN_SIMILARITIES;
  const evidenceQuality = getEvidenceQuality(filteredResults, MIN_SIMILARITIES);

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
  const prompt = String(body.prompt || "").trim();
  const sessionId = String(body.sessionId || "default-session").trim() || "default-session";

  if (!prompt) {
    json(res, 400, { error: "Missing required field: prompt" });
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

  const searchResult = await searchKnowledgeBase(prompt);
  const chatHistory = getSessionHistory(sessionId);

  const assistantResponse = await chatModel.invoke([
    ...buildSystemPromptLayers({
      guardrailsText,
      ragContextPackage: searchResult.ragContextPackage,
      assistantMode,
      profileId,
    }),
    ...chatHistory,
    ["human", prompt],
  ]);

  const answer = String(assistantResponse.content || "").trim();
  appendHistory(sessionId, "human", prompt);
  appendHistory(sessionId, "ai", answer);

  json(res, 200, {
    sessionId,
    answer,
    evidenceSeverity: searchResult.evidenceQuality,
    hasSufficientEvidence: searchResult.hasSufficientEvidence,
    retrieval: createSimilarityDetails(searchResult.results, {
      maxSimilarities: MAX_SIMILARITIES,
      cosineLimit: COSINE_LIMIT,
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
    },
    retrieval: {
      collection: COLLECTION_NAME,
      qdrantUrl: QDRANT_URL,
      maxSimilarities: MAX_SIMILARITIES,
      minSimilarities: MIN_SIMILARITIES,
      cosineLimit: COSINE_LIMIT,
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
