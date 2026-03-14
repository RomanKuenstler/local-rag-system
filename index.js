// -----------------------------------------------------------------------------
// IMPORTS
// -----------------------------------------------------------------------------
// Node.js and external libraries used by the RAG system

import crypto from "crypto"; // used for SHA256 hashing (file change detection)
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai"; // LLM + embedding model
import { QdrantClient } from "@qdrant/js-client-rest"; // vector database client
import prompts from "prompts"; // CLI interaction library
import fs from "fs"; // filesystem access
import path from "path"; // filesystem path utilities
import { randomUUID } from "crypto"; // generate unique IDs for vector DB records
import * as cheerio from "cheerio";

// ------
// HELPER
// ------
// Global SHA256 helper
function sha256(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

function enforceEmbeddingSizeLimit(chunks, maxChars = MAX_EMBEDDING_CHARS) {
  const safeChunks = [];

  for (const chunk of chunks) {
    if (!chunk.text || chunk.text.length <= maxChars) {
      safeChunks.push(chunk);
      continue;
    }

    const splitTexts = splitLongTextWithOverlap(
      chunk.text,
      maxChars,
      Math.min(CHUNK_OVERLAP, Math.floor(maxChars / 5))
    );

    for (let i = 0; i < splitTexts.length; i++) {
      const splitText = splitTexts[i]?.trim();
      if (!splitText) {
        continue;
      }

      safeChunks.push({
        ...chunk,
        id: randomUUID(),
        text: splitText,
        subchunkIndex:
          typeof chunk.subchunkIndex === "number"
            ? `${chunk.subchunkIndex}.${i}`
            : `${i}`,
      });
    }
  }

  return safeChunks;
}

// Normalize text before chunking/embedding.
// Goal: make indexing input more stable and cleaner.
function normalizeTextForIndexing(text) {
  if (!text) {
    return "";
  }

  text = text.normalize("NFKC");

  return text
    .replace(/\r\n/g, "\n")          // Windows -> Unix line endings
    .replace(/\r/g, "\n")            // old Mac line endings -> Unix
    .replace(/\t/g, "    ")          // tabs -> spaces
    .replace(/[ \t]+$/gm, "")        // remove trailing spaces at line ends
    .replace(/\n{3,}/g, "\n\n")      // collapse 3+ blank lines into 2
    .trim();
}

// Extract readable structured text from HTML.
// Goal:
// - keep meaningful document content
// - remove obvious layout/UI junk
// - preserve headings so we can reuse markdown-style section splitting
function extractTextFromHtml(html) {
  if (!html || html.trim() === "") {
    return "";
  }

  const $ = cheerio.load(html);

  // Remove obvious non-content / UI / boilerplate elements
  $(
    [
      "script",
      "style",
      "noscript",
      "svg",
      "canvas",
      "iframe",
      "nav",
      "footer",
      "aside",
      "form",
      "button",
      "input",
      "select",
      "textarea",
      "img",
      "picture",
      "video",
      "audio",
      "source",
      "meta",
      "link",
      "object",
      "embed",
      "advertisement",
    ].join(", ")
  ).remove();

  // Prefer the semantically most relevant root
  const root =
    $("main").first().length > 0
      ? $("main").first()
      : $("article").first().length > 0
        ? $("article").first()
        : $('[role="main"]').first().length > 0
          ? $('[role="main"]').first()
          : $("body").first().length > 0
            ? $("body").first()
            : $.root();

  const blocks = [];
  const selectors = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "li",
    "blockquote",
    "pre",
    "table",
  ].join(", ");

  root.find(selectors).each((_, element) => {
    const $el = $(element);
    const tagName = (element.tagName || "").toLowerCase();

    if (!tagName) {
      return;
    }

    // Skip elements inside removed/non-content zones if they somehow remain
    if (
      $el.closest("nav, footer, aside, form, script, style, noscript").length > 0
    ) {
      return;
    }

    let text = "";

    if (tagName === "table") {
      const rows = [];

      $el.find("tr").each((_, row) => {
        const cells = [];
        $(row)
          .find("th, td")
          .each((_, cell) => {
            const cellText = normalizeInlineText($(cell).text());
            if (cellText) {
              cells.push(cellText);
            }
          });

        if (cells.length > 0) {
          rows.push(cells.join(" | "));
        }
      });

      if (rows.length > 0) {
        text = rows.join("\n");
      }
    } else if (tagName === "pre") {
      text = normalizePreformattedText($el.text());
      if (text) {
        text = `\`\`\`\n${text}\n\`\`\``;
      }
    } else {
      text = normalizeInlineText($el.text());
    }

    if (!text) {
      return;
    }

    // Preserve heading structure by converting HTML headings into markdown headings
    if (/^h[1-6]$/.test(tagName)) {
      const level = Number(tagName[1]);
      blocks.push(`${"#".repeat(level)} ${text}`);
      return;
    }

    if (tagName === "li") {
      blocks.push(`- ${text}`);
      return;
    }

    if (tagName === "blockquote") {
      blocks.push(`> ${text}`);
      return;
    }

    blocks.push(text);
  });

  return deduplicateConsecutiveBlocks(blocks).join("\n\n");
}


// Normalize normal inline/block text from HTML nodes
function normalizeInlineText(text) {
  if (!text) {
    return "";
  }

  return text
    .replace(/\u00a0/g, " ")   // non-breaking spaces
    .replace(/\s+/g, " ")
    .trim();
}


// Normalize preformatted/code text but keep line structure
function normalizePreformattedText(text) {
  if (!text) {
    return "";
  }

  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


// Remove immediately repeated blocks to reduce duplicated HTML boilerplate
function deduplicateConsecutiveBlocks(blocks) {
  const cleaned = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) {
      continue;
    }

    if (cleaned.length === 0 || cleaned[cleaned.length - 1] !== trimmed) {
      cleaned.push(trimmed);
    }
  }

  return cleaned;
}


// Route content extraction by file extension
function extractIndexableTextByExtension(rawContent, extension) {
  if (!rawContent) {
    return "";
  }

  if (extension === ".html" || extension === ".htm") {
    return extractTextFromHtml(rawContent);
  }

  return rawContent;
}

// Build the effective document hash used for incremental indexing.
//
// Important:
// This hash depends on:
// - normalized text
// - chunking config
// - indexing schema version
//
// Result:
// - changing chunking settings forces re-indexing
// - changing normalization logic can be versioned
function buildIndexRelevantHash(content) {
  const normalizedContent = normalizeTextForIndexing(content);

  return sha256(
    JSON.stringify({
      normalizedContent,
      chunkSize: CHUNK_SIZE,
      chunkOverlap: CHUNK_OVERLAP,
      indexSchemaVersion: INDEX_SCHEMA_VERSION,
    })
  );
}
// Recursively reads files from a directory and returns file metadata + content
// Used to load knowledge base files from the ./data directory
function readTextFilesRecursively(dirPath, allowedExtensions, encoding = "utf8") {
  dirPath = path.resolve(dirPath);

  // normalize extension input
  if (!Array.isArray(allowedExtensions)) {
    allowedExtensions = [allowedExtensions];
  }

  allowedExtensions = allowedExtensions.map((ext) =>
    ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`
  );

  const files = [];

  // recursive directory scanner
  function scanDirectory(currentPath) {
    const items = fs.readdirSync(currentPath);

    for (const item of items) {
      const itemPath = path.join(currentPath, item);
      const stats = fs.statSync(itemPath);

      // recurse into directories
      if (stats.isDirectory()) {
        scanDirectory(itemPath);
        continue;
      }

      if (!stats.isFile()) {
        continue;
      }

      // only process allowed file extensions
      const ext = path.extname(item).toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        continue;
      }
try {
        const rawContent = fs.readFileSync(itemPath, encoding);
        const extractedContent = extractIndexableTextByExtension(rawContent, ext);
        const content = normalizeTextForIndexing(rawContent);

        files.push({
          path: itemPath,
          relativePath: path.relative(dirPath, itemPath),
          filename: path.basename(itemPath),
          extension: ext,
          content, // cleaned content used for chunking + embedding
          hash: buildIndexRelevantHash(rawContent), // hash also reacts to chunking strategy changes
        });
      } catch (error) {
        console.error(`Error reading file ${itemPath}: ${error.message}`);
      }
    }
  }

  try {
    scanDirectory(dirPath);
  } catch (error) {
    console.error(`Error accessing directory ${dirPath}: ${error.message}`);
  }

  return files;
}

// --------------
// CHUNKS
// --------------
// Splits markdown files into logical sections based on headers (#, ##, ###)
// Smaller chunks improve retrieval quality in RAG systems
function splitMarkdownBySectionsWithMetadata(markdown) {
  if (!markdown || markdown === "") {
    return [];
  }

  const headerRegex = /^\s*(#+)\s+(.*)$/gm;
  const headerMatches = [];
  let match;

  // detect markdown headers
  while ((match = headerRegex.exec(markdown)) !== null) {
    headerMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      title: match[2].trim(),
    });
  }

  // if no headers exist treat entire file as one chunk
  if (headerMatches.length === 0) {
    const trimmed = markdown.trim();
    return trimmed ? [{ title: "Document", content: trimmed }] : [];
  }

  const sections = [];

  // capture text before first header
  if (headerMatches[0].start > 0) {
    const preHeader = markdown.substring(0, headerMatches[0].start).trim();
    if (preHeader !== "") {
      sections.push({
        title: "Introduction",
        content: preHeader,
      });
    }
  }

  // create chunks between headers
  for (let i = 0; i < headerMatches.length; i++) {
    const start = headerMatches[i].start;
    const end =
      i < headerMatches.length - 1
        ? headerMatches[i + 1].start
        : markdown.length;

    const section = markdown.substring(start, end).trim();
    if (section !== "") {
      sections.push({
        title: headerMatches[i].title || "Section",
        content: section,
      });
 }
  }

  return sections;
}

// Split text into smaller overlapping chunks.
// Strategy:
// 1. Prefer paragraph boundaries
// 2. Build chunks up to CHUNK_SIZE
// 3. Add overlap between adjacent chunks
function splitTextIntoOverlappingChunks(text, chunkSize = CHUNK_SIZE, chunkOverlap = CHUNK_OVERLAP) {
  if (!text || text.trim() === "") {
    return [];
  }

  const normalizedText = text.replace(/\r\n/g, "\n").trim();

  // First split by paragraph boundaries
  const paragraphs = normalizedText
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter(Boolean);

  // Fallback if paragraph splitting produces nothing useful
  if (paragraphs.length === 0) {
    return splitLongTextWithOverlap(normalizedText, chunkSize, chunkOverlap);
  }

  const chunks = [];
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    const candidate = currentChunk
      ? `${currentChunk}\n\n${paragraph}`
      : paragraph;

    // If paragraph fits into current chunk, keep adding
    if (candidate.length <= chunkSize) {
      currentChunk = candidate;
      continue;
    }

    // Flush current chunk first
    if (currentChunk) {
      chunks.push(currentChunk);
    }

    // If a single paragraph is too long, split it further
    if (paragraph.length > chunkSize) {
      const splitParagraphChunks = splitLongTextWithOverlap(
        paragraph,
        chunkSize,
        chunkOverlap
      );

      // Add all long paragraph chunks except the last one directly
      for (let i = 0; i < splitParagraphChunks.length - 1; i++) {
        chunks.push(splitParagraphChunks[i]);
      }

      // Keep the last chunk open so next paragraph can still attach if possible
      currentChunk = splitParagraphChunks[splitParagraphChunks.length - 1] || "";
    } else {
      currentChunk = paragraph;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  // Add overlap between adjacent chunks
  return addOverlapToChunks(chunks, chunkOverlap);
}


// Split a long text purely by character window with soft boundary preference.
// Tries to cut near a sentence end or whitespace when possible.
function splitLongTextWithOverlap(text, chunkSize, chunkOverlap) {
  const chunks = [];
  const normalized = text.trim();

  if (!normalized) {
    return chunks;
  }

  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);

    // Try to move end backward to a nicer boundary if possible
    if (end < normalized.length) {
      const window = normalized.slice(start, end);
      const boundaryCandidates = [
        window.lastIndexOf("\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("! "),
        window.lastIndexOf("? "),
        window.lastIndexOf(" "),
      ];

      const bestBoundary = Math.max(...boundaryCandidates);

      // Only use the boundary if it is not too far back
      if (bestBoundary > Math.floor(chunkSize * 0.6)) {
        end = start + bestBoundary + 1;
      }
    }

    const chunk = normalized.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= normalized.length) {
      break;
    }

    start = Math.max(end - chunkOverlap, start + 1);
  }

  return chunks;
}


// Adds overlap by prepending tail text from previous chunk.
// Keeps current chunk content primary, but provides continuity.
function addOverlapToChunks(chunks, chunkOverlap) {
  if (!chunks || chunks.length <= 1 || chunkOverlap <= 0) {
    return chunks;
  }

  const overlappedChunks = [chunks[0]];

  for (let i = 1; i < chunks.length; i++) {
    const previousChunk = chunks[i - 1];
    const currentChunk = chunks[i];

    const overlapText = previousChunk.slice(-chunkOverlap).trim();
    const mergedChunk = overlapText
      ? `${overlapText}\n\n${currentChunk}`
      : currentChunk;

    overlappedChunks.push(mergedChunk);
  }

  return overlappedChunks;
}

function validateRetrievalConfig() {
  if (!Number.isInteger(MAX_SIMILARITIES) || MAX_SIMILARITIES < 1) {
    throw new Error(
      `Invalid MAX_SIMILARITIES: ${MAX_SIMILARITIES}. It must be an integer >= 1.`
    );
  }

  if (!Number.isInteger(MIN_SIMILARITIES) || MIN_SIMILARITIES < 0) {
    throw new Error(
      `Invalid MIN_SIMILARITIES: ${MIN_SIMILARITIES}. It must be an integer >= 0.`
    );
  }

  if (MIN_SIMILARITIES > MAX_SIMILARITIES) {
    throw new Error(
      `Invalid retrieval config: MIN_SIMILARITIES (${MIN_SIMILARITIES}) must be <= MAX_SIMILARITIES (${MAX_SIMILARITIES}).`
    );
  }

  if (Number.isNaN(COSINE_LIMIT)) {
    throw new Error(
      `Invalid COSINE_LIMIT: ${COSINE_LIMIT}. It must be a valid number.`
    );
  }

  if (!Number.isInteger(CHUNK_SIZE) || CHUNK_SIZE < 100) {
    throw new Error(
      `Invalid CHUNK_SIZE: ${CHUNK_SIZE}. It must be an integer >= 100.`
    );
  }

  if (!Number.isInteger(CHUNK_OVERLAP) || CHUNK_OVERLAP < 0) {
    throw new Error(
      `Invalid CHUNK_OVERLAP: ${CHUNK_OVERLAP}. It must be an integer >= 0.`
    );
  }

  if (CHUNK_OVERLAP >= CHUNK_SIZE) {
    throw new Error(
      `Invalid chunk config: CHUNK_OVERLAP (${CHUNK_OVERLAP}) must be smaller than CHUNK_SIZE (${CHUNK_SIZE}).`
    );
  }
}

// --------------------------------------------------------
// CONFIG
// --------------------------------------------------------
// Configuration mostly comes from environment variables
// (configured in docker-compose.yml)

const COLLECTION_NAME = process.env.QDRANT_COLLECTION || "knowledge_base";
const QDRANT_URL = process.env.QDRANT_URL || "http://qdrant:6333";
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || undefined;
const CONTENT_PATH = process.env.CONTENT_PATH || "./data";

// number of previous messages remembered in conversation
const HISTORY_MESSAGES = parseInt(process.env.HISTORY_MESSAGES || "10", 10);

// number of similarity results retrieved from vector DB
const MAX_SIMILARITIES = parseInt(process.env.MAX_SIMILARITIES || "4", 10);

// Minimum number of acceptable similarities required before retrieval
// is treated as sufficiently strong.
// Important: this is checked AFTER filtering by score threshold.
const MIN_SIMILARITIES = parseInt(process.env.MIN_SIMILARITIES || "1", 10);

// minimum similarity score required
const COSINE_LIMIT = parseFloat(process.env.COSINE_LIMIT || "0.45");

// local file tracking indexing state
const INDEX_STATE_FILE =
  process.env.INDEX_STATE_FILE || path.resolve("./.index-state.json");

// Chunking configuration
// CHUNK_SIZE = target size of each chunk in characters
// CHUNK_OVERLAP = number of overlapping characters between adjacent chunks
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || "1200", 10);
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || "400", 10);

// Version for indexing/chunking strategy.
// Bump this manually when you make major indexing changes and want to force
// a full re-embedding of all documents.
const INDEX_SCHEMA_VERSION = process.env.INDEX_SCHEMA_VERSION || "1";

// Max embedding chars to decrease input tokens for embedding model
const MAX_EMBEDDING_CHARS = parseInt(
  process.env.MAX_EMBEDDING_CHARS || "700",
  10
);

if (!Number.isInteger(MAX_EMBEDDING_CHARS) || MAX_EMBEDDING_CHARS < 200) {
  throw new Error(
    `Invalid MAX_EMBEDDING_CHARS: ${MAX_EMBEDDING_CHARS}. It must be an integer >= 200.`
  );
}

// --------------------------------------------------------
// LLM CHAT MODEL
// --------------------------------------------------------
// Uses Docker Model Runner with an OpenAI-compatible API

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

  // generation parameters
  temperature: parseFloat(process.env.OPTION_TEMPERATURE || "0.0"),
  top_p: parseFloat(process.env.OPTION_TOP_P || "0.5"),
  presencePenalty: parseFloat(process.env.OPTION_PRESENCE_PENALTY || "2.2"),
});


// --------------------------------------------------------
// EMBEDDINGS MODEL
// --------------------------------------------------------
// Converts text into vectors used for similarity search

const embeddingsModel = new OpenAIEmbeddings({
  model: process.env.MODEL_RUNNER_LLM_EMBEDDING || "ai/embeddinggemma:latest",
  configuration: {
    baseURL:
      process.env.MODEL_RUNNER_BASE_URL ||
      "http://localhost:12434/engines/llama.cpp/v1/",
    apiKey: "",
  },
});


// --------------------------------------------------------
// QDRANT CLIENT
// --------------------------------------------------------
// Vector database used for storing embeddings

const qdrant = new QdrantClient({
  url: QDRANT_URL,
  apiKey: QDRANT_API_KEY,
  checkCompatibility: false,
});

// --------------------------------------------------------
// RAG MESSAGE PACKAGE HELPERS
// --------------------------------------------------------

// Simple evidence-quality assessment.
// This is intentionally lightweight for now and can be improved later.
function getEvidenceQuality(results) {
  if (!results || results.length === 0) {
    return "weak";
  }

  // First check sufficiency based on filtered acceptable results
  if (results.length < MIN_SIMILARITIES) {
    return "weak";
  }

  const scores = results.map((result) => result.score ?? 0);
  const maxScore = Math.max(...scores);
  const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;

  // Simple first version:
  // - strong   -> enough acceptable results and overall good scores
  // - moderate -> enough acceptable results but not very strong overall
  // - weak     -> not enough acceptable results
  if (results.length >= MIN_SIMILARITIES && results.length >= 2 && avgScore >= 0.7) {
    return "strong";
  }

  if (results.length >= MIN_SIMILARITIES && maxScore >= COSINE_LIMIT) {
    return "moderate";
  }

  return "weak";
}

// Formats one evidence entry for Option 2
function formatEvidenceEntry(result, index) {
  const payload = result.payload || {};
  const source = payload.source || "unknown";
  const section = payload.title || "Untitled";
  const score =
    typeof result.score === "number" ? result.score.toFixed(4) : "n/a";
  const content = payload.text || "";

  return `[Evidence ${index}]
Source file: ${source}
Section: ${section}
Retrieval score: ${score}

${content}`;
}

function buildRagContextPackage({ results, userMessage, evidenceQuality }) {
  const evidenceBlock =
    results.length > 0
      ? results.map((result, index) => formatEvidenceEntry(result, index + 1)).join("\n\n")
      : "No relevant evidence was retrieved from the knowledge base.";

  return `RAG CONTEXT PACKAGE

You are given retrieved knowledge from the knowledge base.
Some retrieved entries may be more relevant than others.
Use the retrieved content as the primary basis for your answer.

EVIDENCE SUMMARY
Retrieved entries: ${results.length}
Evidence quality assessment: ${evidenceQuality}
Minimum acceptable evidence required: ${MIN_SIMILARITIES}

INTERPRETATION GUIDE
- Prefer evidence that is most relevant to the user's question.
- Use metadata such as source, section, and retrieval score as helpful hints, but rely mainly on the content itself.
- Ignore retrieved entries that are clearly irrelevant.
- Do not invent unsupported facts.
- If multiple entries support the same answer, combine them into one coherent explanation.

RETRIEVED EVIDENCE

${evidenceBlock}

ANSWERING TASK
- Answer the user's question using the retrieved knowledge as the primary source.
- If the evidence is partial, answer only what is supported and clearly indicate what is missing.
- If the evidence is insufficient, say that the knowledge base does not contain enough information.
- If you provide additional general knowledge, clearly label it as general knowledge and not as knowledge-base content.

USER QUESTION
${userMessage}`;
}

// --------------------------------------------------------
// HISTORY
// --------------------------------------------------------
// Stores limited conversation history for contextual chat

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

  // keep only last N messages
  if (history.length > HISTORY_MESSAGES * 2) {
    history.splice(0, 2);
  }
}


// --------------------------------------------------------
// INDEX STATE
// --------------------------------------------------------
// Keeps track of file hashes so only changed files are re-embedded

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

// --------------------------------------------------------
// QDRANT HELPERS
// --------------------------------------------------------
// Utility functions for managing the vector database

async function collectionExists(collectionName) {
  const collections = await qdrant.getCollections();
  return collections.collections.some((c) => c.name === collectionName);
}


// ensure the vector collection exists and matches embedding dimension
async function ensureCollection(vectorSize) {
  const exists = await collectionExists(COLLECTION_NAME);

  if (!exists) {
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: {
        size: vectorSize,
        distance: "Cosine",
      },
    });

    // create indexes for faster filtering
    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: "source",
      field_schema: "keyword",
    });

    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: "filename",
      field_schema: "keyword",
    });

    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: "extension",
      field_schema: "keyword",
    });

    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: "documentHash",
      field_schema: "keyword",
    });

    console.log(`✅ Qdrant collection "${COLLECTION_NAME}" created`);
    return;
  }

  const info = await qdrant.getCollection(COLLECTION_NAME);
  let currentSize = null;

  if (
    info?.config?.params?.vectors &&
    !Array.isArray(info.config.params.vectors)
  ) {
    currentSize = info.config.params.vectors.size;
  }

if (currentSize !== vectorSize) {
    console.log(
      `⚠️ Vector size changed (${currentSize} -> ${vectorSize}), recreating collection...`
    );

    await qdrant.deleteCollection(COLLECTION_NAME);
    await qdrant.createCollection(COLLECTION_NAME, {
      vectors: {
        size: vectorSize,
        distance: "Cosine",
      },
    });

    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: "source",
      field_schema: "keyword",
    });

    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: "filename",
      field_schema: "keyword",
    });

    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: "extension",
      field_schema: "keyword",
    });

    await qdrant.createPayloadIndex(COLLECTION_NAME, {
      field_name: "documentHash",
      field_schema: "keyword",
    });

    console.log(`✅ Qdrant collection "${COLLECTION_NAME}" recreated`);
  }
}


// delete all chunks belonging to a specific source file
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


// convert file → chunk records
function fileToChunks(file) {
  let sections;

  if (file.extension === ".md" || file.extension === ".html" || file.extension === ".htm") {
    sections = splitMarkdownBySectionsWithMetadata(file.content);
  } else {
    const trimmed = file.content.trim();
    sections = trimmed
      ? [{ title: file.filename, content: trimmed }]
      : [];
  }

  const chunkRecords = [];
  let globalChunkIndex = 0;

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
    const section = sections[sectionIndex];

    // Break each section into smaller overlapping subchunks
    const subchunks = splitTextIntoOverlappingChunks(
      section.content,
      CHUNK_SIZE,
      CHUNK_OVERLAP
    );

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

// --------------------------------------------------------
// INDEXING PIPELINE
// --------------------------------------------------------
// Reads files, creates embeddings, and stores them in Qdrant

async function indexChangedDocuments() {

  console.log("========================================================");
  console.log("Embeddings model:", embeddingsModel.model);
  console.log(`Reading documents from: ${CONTENT_PATH}`);

  const files = readTextFilesRecursively(CONTENT_PATH, [".md", ".txt", ".html", ".htm"]);
  console.log(`Files found: ${files.length}`);

  if (files.length === 0) {
    console.log("⚠️ No files found to index.");
    console.log("========================================================");
    return;
  }

  const indexState = loadIndexState();

  const changedFiles = files.filter((file) => indexState[file.relativePath] !== file.hash);
  const removedFiles = Object.keys(indexState).filter(
    (relativePath) => !files.some((file) => file.relativePath === relativePath)
  );

  console.log(`Changed/new files: ${changedFiles.length}`);
  console.log(`Removed files: ${removedFiles.length}`);

  if (changedFiles.length === 0 && removedFiles.length === 0) {
    console.log("No indexing needed.");
    console.log("========================================================");
    return;
  }

  const probeEmbedding = await embeddingsModel.embedQuery("dimension probe");
  await ensureCollection(probeEmbedding.length);

  // remove deleted files
  for (const removedFile of removedFiles) {
    try {
      console.log(`Removing deleted file from index: ${removedFile}`);
      await deletePointsBySource(removedFile);
      delete indexState[removedFile];
    } catch (error) {
      console.error(`Failed removing ${removedFile}: ${error.message}`);
    }
  }

  // index changed files
  for (const file of changedFiles) {
    try {
      console.log(`Indexing file: ${file.relativePath}`);

      await deletePointsBySource(file.relativePath);

      const chunkRecords = fileToChunks(file).filter((chunk) => chunk.text?.trim());
      if (chunkRecords.length === 0) {
        console.log(`No chunks for file: ${file.relativePath}`);
        indexState[file.relativePath] = file.hash;
        continue;
}

      const embeddings = await embeddingsModel.embedDocuments(
        chunkRecords.map((chunk) => chunk.text)
      );

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

      await qdrant.upsert(COLLECTION_NAME, {
        wait: true,
        points,
      });

      indexState[file.relativePath] = file.hash;
      console.log(
        `Prepared ${chunkRecords.length} chunks from ${file.relativePath} (chunk size: ${CHUNK_SIZE}, overlap: ${CHUNK_OVERLAP})`
       );
      } catch (error) {
      console.error(`Error indexing ${file.relativePath}: ${error.message}`);
    }
  }

  saveIndexState(indexState);
  console.log("Index state saved");
  console.log("========================================================");
  console.log();
}


// --------------------------------------------------------
// RETRIEVAL
// --------------------------------------------------------
// Performs similarity search in the vector database

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
    const source = payload.source || "unknown";
    const title = payload.title || "Untitled";

    console.log(
      "Score:",
      result.score,
      "Source:",
      source,
      "Title:",
      title
    );
  }

  console.log(`Retrieved from Qdrant: ${results.length}`);
  console.log(`Passed threshold (${COSINE_LIMIT}): ${filteredResults.length}`);
  console.log(`MIN_SIMILARITIES required: ${MIN_SIMILARITIES}`);
  console.log(`Sufficient evidence: ${hasSufficientEvidence ? "yes" : "no"}`);
  console.log(`Evidence quality: ${evidenceQuality}`);
  console.log("========================================================");
  console.log();

  const ragContextPackage = buildRagContextPackage({
    results: filteredResults,
    userMessage,
    evidenceQuality,
  });

  return {
    results: filteredResults,
    evidenceQuality,
    hasSufficientEvidence,
    ragContextPackage,
  };
}

// --------------------------------------------------------
// MAIN PROGRAM
// --------------------------------------------------------

let systemInstructions = fs.readFileSync("/app/system.instructions.md", "utf8");

// validate retrieval-related configuration before startup
validateRetrievalConfig();

// index documents before chat starts
await indexChangedDocuments();

let exit = false;
while (!exit) {
  const response = await prompts({
    type: "text",
    name: "userMessage",
    message: `Your question (${chatModel.model}): `,
    validate: (value) => (value ? true : "Question cannot be empty"),
  });

  const userMessage = response.userMessage;

  if (!userMessage) {
    continue;
  }

  // exit command
  if (userMessage === "/bye") {
    console.log("See you later!");
    exit = true;
    continue;
  }

  const history = getConversationHistory("default-session-id");

  // retrieve relevant knowledge
  const { ragContextPackage, evidenceQuality, results } =
  await searchKnowledgeBase(userMessage);

  // build final prompt
  const messages = [
    ["system", systemInstructions],
    ["system", ragContextPackage],
    ...history,
    ["user", userMessage],
  ];

  let assistantResponse = "";

  // stream response from LLM
  const stream = await chatModel.stream(messages);
  for await (const chunk of stream) {
    assistantResponse += chunk.content;
    process.stdout.write(chunk.content);
  }

  console.log("\n");

  // update conversation history
  addToHistory("default-session-id", "user", userMessage);
  addToHistory("default-session-id", "assistant", assistantResponse);
}
