import path from "path";

export const COLLECTION_NAME = process.env.QDRANT_COLLECTION || "knowledge_base";
export const QDRANT_URL = process.env.QDRANT_URL || "http://qdrant:6333";
export const QDRANT_API_KEY = process.env.QDRANT_API_KEY || undefined;
export const CONTENT_PATH = process.env.CONTENT_PATH || "./data";
export const EMBEDDABLE_EXTENSIONS = [".md", ".txt", ".html", ".htm", ".pdf"];

export const HISTORY_MESSAGES = parseInt(process.env.HISTORY_MESSAGES || "10", 10);
export const MAX_SIMILARITIES = parseInt(process.env.MAX_SIMILARITIES || "4", 10);
export const MIN_SIMILARITIES = parseInt(process.env.MIN_SIMILARITIES || "1", 10);
export const COSINE_LIMIT = parseFloat(process.env.COSINE_LIMIT || "0.45");

export const INDEX_STATE_FILE =
  process.env.INDEX_STATE_FILE || path.resolve("./.index-state.json");

export const CHAT_HISTORY_DIR =
  process.env.CHAT_HISTORY_DIR || path.resolve("./chat-history");

export const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || "1200", 10);
export const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || "400", 10);
export const INDEX_SCHEMA_VERSION = process.env.INDEX_SCHEMA_VERSION || "1";

export const MAX_EMBEDDING_CHARS = parseInt(
  process.env.MAX_EMBEDDING_CHARS || "400",
  10
);

export const PDF_MIN_EXTRACTED_CHARS = parseInt(
  process.env.PDF_MIN_EXTRACTED_CHARS || "80",
  10
);

export const APP_NAME = "local RAG";
export const APP_VERSION = "v1.0.1";

export function validateRetrievalConfig() {
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

  if (!Number.isInteger(MAX_EMBEDDING_CHARS) || MAX_EMBEDDING_CHARS < 200) {
    throw new Error(
      `Invalid MAX_EMBEDDING_CHARS: ${MAX_EMBEDDING_CHARS}. It must be an integer >= 200.`
    );
  }

  if (!Number.isInteger(PDF_MIN_EXTRACTED_CHARS) || PDF_MIN_EXTRACTED_CHARS < 0) {
    throw new Error(
      `Invalid PDF_MIN_EXTRACTED_CHARS: ${PDF_MIN_EXTRACTED_CHARS}. It must be an integer >= 0.`
    );
  }
}
