import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  COLLECTION_NAME,
  CONTENT_PATH,
  EMBEDDABLE_EXTENSIONS,
  INDEX_STATE_FILE,
  QDRANT_API_KEY,
  QDRANT_URL,
} from "./config.js";
import {
  enforceEmbeddingSizeLimit,
  splitMarkdownBySectionsWithMetadata,
  splitTextIntoOverlappingChunks,
} from "./chunking.js";
import { readTextFilesRecursively } from "./document-processing.js";

export function createEmbeddingsModel() {
  return new OpenAIEmbeddings({
    model: process.env.MODEL_RUNNER_LLM_EMBEDDING || "ai/embeddinggemma:latest",
    configuration: {
      baseURL:
        process.env.MODEL_RUNNER_BASE_URL ||
        "http://localhost:12434/engines/llama.cpp/v1/",
      apiKey: "",
    },
  });
}

export function createQdrantClient() {
  return new QdrantClient({
    url: QDRANT_URL,
    apiKey: QDRANT_API_KEY,
    checkCompatibility: false,
  });
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

async function collectionExists(qdrant, collectionName) {
  const collections = await qdrant.getCollections();
  return collections.collections.some((collection) => collection.name === collectionName);
}

async function ensureCollection(qdrant, vectorSize) {
  const exists = await collectionExists(qdrant, COLLECTION_NAME);

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

    return "created";
  }

  const info = await qdrant.getCollection(COLLECTION_NAME);
  const currentSize =
    info?.config?.params?.vectors && !Array.isArray(info.config.params.vectors)
      ? info.config.params.vectors.size
      : null;

  if (currentSize === vectorSize) {
    return "unchanged";
  }

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

  return "recreated";
}

async function deletePointsBySource(qdrant, relativePath) {
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

export function fileToChunks(file) {
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

export async function readEmbeddableFiles() {
  return readTextFilesRecursively(CONTENT_PATH, EMBEDDABLE_EXTENSIONS);
}

export async function indexChangedDocuments({ logger = console.log } = {}) {
  const embeddingsModel = createEmbeddingsModel();
  const qdrant = createQdrantClient();

  logger("_______________________________________________________");
  logger("Embeddings model:", embeddingsModel.model);
  logger(`Reading documents from: ${CONTENT_PATH}`);

  const files = await readEmbeddableFiles();
  logger(`Files found: ${files.length}`);

  if (files.length === 0) {
    logger("No files found to index.");
    logger("_______________________________________________________");
    return {
      filesFound: 0,
      changedFiles: [],
      removedFiles: [],
      indexedCount: 0,
      removedCount: 0,
      skipped: true,
    };
  }

  const indexState = loadIndexState();
  const changedFiles = files.filter((file) => indexState[file.relativePath] !== file.hash);
  const removedFiles = Object.keys(indexState).filter(
    (relativePath) => !files.some((file) => file.relativePath === relativePath)
  );

  logger(`Changed/new files: ${changedFiles.length}`);
  logger(`Removed files: ${removedFiles.length}`);

  if (changedFiles.length === 0 && removedFiles.length === 0) {
    logger("No indexing needed.");
    logger("_______________________________________________________");
    return {
      filesFound: files.length,
      changedFiles,
      removedFiles,
      indexedCount: 0,
      removedCount: 0,
      skipped: true,
    };
  }

  const probeEmbedding = await embeddingsModel.embedQuery("dimension probe");
  const collectionStatus = await ensureCollection(qdrant, probeEmbedding.length);
  if (collectionStatus === "created") {
    logger(`Qdrant collection \"${COLLECTION_NAME}\" created`);
  }
  if (collectionStatus === "recreated") {
    logger(`Qdrant collection \"${COLLECTION_NAME}\" recreated (vector size changed)`);
  }

  let removedCount = 0;
  for (const removedFile of removedFiles) {
    try {
      logger(`Removing deleted file from index: ${removedFile}`);
      await deletePointsBySource(qdrant, removedFile);
      delete indexState[removedFile];
      removedCount++;
    } catch (error) {
      console.error(`Failed removing ${removedFile}: ${error.message}`);
    }
  }

  let indexedCount = 0;
  for (const file of changedFiles) {
    try {
      logger(`Indexing file: ${file.relativePath}`);
      await deletePointsBySource(qdrant, file.relativePath);

      const chunkRecords = fileToChunks(file).filter((chunk) => chunk.text?.trim());
      if (chunkRecords.length === 0) {
        logger(`No chunks for file: ${file.relativePath}`);
        indexState[file.relativePath] = file.hash;
        continue;
      }

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
      indexedCount++;
      logger(`Indexed ${chunkRecords.length} chunks: ${file.relativePath}`);
    } catch (error) {
      console.error(`Error indexing ${file.relativePath}: ${error.message}`);
    }
  }

  saveIndexState(indexState);
  logger("Index state saved");
  logger("_______________________________________________________");

  return {
    filesFound: files.length,
    changedFiles,
    removedFiles,
    indexedCount,
    removedCount,
    skipped: false,
  };
}
