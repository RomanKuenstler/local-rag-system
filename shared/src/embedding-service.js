import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";
import { QdrantClient } from "@qdrant/js-client-rest";
import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  COLLECTION_NAME,
  CONTENT_PATH,
  DEFAULT_FILE_TAG,
  EMBEDDABLE_EXTENSIONS,
  PDF_MIN_EXTRACTED_CHARS,
  QDRANT_API_KEY,
  QDRANT_URL,
} from "../config/index.js";
import { createEmbeddingsModel } from "./model-clients.js";
import {
  enforceEmbeddingSizeLimit,
  splitMarkdownBySectionsWithMetadata,
  splitTextIntoOverlappingChunks,
} from "./chunking.js";
import { readTextFilesRecursively } from "./document-processing.js";
import { ensureDatabaseReady } from "../db/index.js";
import {
  clearManagedLibraryFileErrors,
  listTagsForFilePathMap,
  getEmbeddingStatus,
  getIndexStateMap,
  listManagedLibraryFilesWithStatus,
  markManagedLibraryFilesStatus,
  markIndexingFinished,
  recordIndexingJobFile,
  markIndexingStarted,
  removeDeletedMetadata,
  updateFileTags,
  upsertFileMetadata,
} from "./state-store.js";

export { createEmbeddingsModel };

export function createQdrantClient() {
  return new QdrantClient({
    url: QDRANT_URL,
    apiKey: QDRANT_API_KEY,
    checkCompatibility: false,
  });
}

export async function readEmbeddingStatus() {
  try {
    await ensureDatabaseReady();
    return await getEmbeddingStatus();
  } catch (error) {
    console.error(`Failed to load embedding status: ${error.message}`);
    return null;
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

    for (const field of ["source", "filename", "extension", "documentHash", "tags"]) {
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

  for (const field of ["source", "filename", "extension", "documentHash", "tags"]) {
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

  if ([".md", ".html", ".htm", ".pdf", ".epub"].includes(file.extension)) {
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

const OCR_SCANNER_BASE_URL =
  String(process.env.OCR_SCANNER_BASE_URL || "http://ocr-scanner:3300").trim() || "http://ocr-scanner:3300";

async function requestLibraryPdfOcr({ relativePath, extractedText, minimumExtractedChars }) {
  if (typeof relativePath !== "string" || !relativePath.toLowerCase().endsWith(".pdf")) {
    return null;
  }

  try {
    const response = await fetch(`${OCR_SCANNER_BASE_URL}/ocr/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request_type: "library_pdf",
        pdf_relative_path: relativePath,
        minimum_extracted_chars: minimumExtractedChars,
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      const errorCode = String(errorPayload?.error_code || `ocr_http_${response.status}`);
      const errorMessage = String(errorPayload?.error || "").trim();
      console.warn(
        `[embedder] OCR request failed for ${relativePath} with HTTP ${response.status}: ${errorCode} ${errorMessage.slice(0, 240)}`
      );
      return null;
    }

    const payload = await response.json();
    if (payload?.status !== "success") {
      const errorCode = String(payload?.error_code || "ocr_unknown_error");
      console.warn(`[embedder] OCR returned non-success status for ${relativePath}: ${errorCode}`);
      return null;
    }
    const ocrText = typeof payload?.text === "string" ? payload.text : "";
    if (!ocrText.trim()) {
      return null;
    }

    const extractionMode = String(payload?.extraction_details?.mode || "unknown");
    const quality =
      payload?.extraction_details?.ocr_quality?.quality
      || payload?.extraction_details?.quality?.quality
      || "unknown";
    console.log(
      `[embedder] OCR text extracted for ${relativePath} (original=${extractedText.length} chars, ocr=${ocrText.length} chars, mode=${extractionMode}, quality=${quality})`
    );
    return ocrText;
  } catch (error) {
    console.warn(`[embedder] OCR request error for ${relativePath}: ${error.message}`);
    return null;
  }
}

export async function readEmbeddableFiles() {
  return readTextFilesRecursively(CONTENT_PATH, EMBEDDABLE_EXTENSIONS, "utf8", {
    minimumExtractedChars: PDF_MIN_EXTRACTED_CHARS,
    pdfExtractionMode: "ocr_only",
    pdfOcrHandler: requestLibraryPdfOcr,
  });
}

const TAGS_FILE_NAME = "tags.json";
const TAG_PATTERN = /^[a-z0-9][a-z0-9_\-:.]{0,63}$/;

function normalizeTags(tags) {
  const input = Array.isArray(tags) ? tags : [];
  const normalized = input
    .map((tag) => String(tag || "").trim().toLowerCase())
    .filter(Boolean)
    .filter((tag) => TAG_PATTERN.test(tag));
  return [...new Set(normalized)];
}

function normalizeTagsForFile(tags) {
  const normalized = normalizeTags(tags);
  return normalized.length > 0 ? normalized : [DEFAULT_FILE_TAG];
}

function areTagSetsEqual(first, second) {
  const left = normalizeTagsForFile(first);
  const right = normalizeTagsForFile(second);
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

async function syncDataRootTagsManifest({ logger = console.log } = {}) {
  const absoluteContentPath = path.resolve(CONTENT_PATH);
  const tagsFilePath = path.join(absoluteContentPath, TAGS_FILE_NAME);

  let directFiles = [];
  try {
    const rootEntries = await fs.readdir(absoluteContentPath, { withFileTypes: true });
    directFiles = rootEntries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => name !== TAGS_FILE_NAME)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    logger(`Skipping ${TAGS_FILE_NAME} sync: ${error.message}`);
    return new Map();
  }

  let existingManifest = {};
  try {
    const raw = await fs.readFile(tagsFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      existingManifest = parsed;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      logger(`Ignoring invalid ${TAGS_FILE_NAME}: ${error.message}`);
    }
  }

  const normalizedManifest = {};
  for (const filename of directFiles) {
    normalizedManifest[filename] = normalizeTagsForFile(existingManifest[filename]);
  }

  const shouldWrite = JSON.stringify(existingManifest) !== JSON.stringify(normalizedManifest);
  if (shouldWrite) {
    await fs.writeFile(tagsFilePath, `${JSON.stringify(normalizedManifest, null, 2)}\n`, "utf8");
    logger(`Updated ${path.relative(process.cwd(), tagsFilePath)}`);
  }

  return new Map(
    Object.entries(normalizedManifest).map(([filename, tags]) => [
      filename,
      normalizeTagsForFile(tags),
    ])
  );
}

export async function indexChangedDocuments({ logger = console.log } = {}) {
  await ensureDatabaseReady();
  const embeddingsModel = createEmbeddingsModel();
  const qdrant = createQdrantClient();

  const startedAt = new Date().toISOString();
  const jobId = await markIndexingStarted(startedAt);

  try {
    logger("_______________________________________________________");
    logger("Embeddings model:", embeddingsModel.model);
    logger(`Reading documents from: ${CONTENT_PATH}`);

    const files = await readEmbeddableFiles();
    logger(`Files found: ${files.length}`);
    const managedFiles = await listManagedLibraryFilesWithStatus();
    const disabledPaths = new Set(
      managedFiles
        .filter((file) => ["disabled", "removing"].includes(file.upload_status))
        .map((file) => file.file_path)
    );
    const activeFiles = files.filter((file) => !disabledPaths.has(file.relativePath));
    const activeFilePathSet = new Set(activeFiles.map((file) => file.relativePath));
    const fileTagsMap = await listTagsForFilePathMap(activeFiles.map((file) => file.relativePath));
    const dataRootManifestTagsMap = await syncDataRootTagsManifest({ logger });
    const manifestTagChangedPaths = new Set();

    for (const file of activeFiles) {
      const isDataRootFile = !String(file.relativePath || "").includes("/");
      if (!isDataRootFile) {
        continue;
      }

      const manifestTags = dataRootManifestTagsMap.get(file.relativePath);
      if (!manifestTags) {
        continue;
      }

      const existingTags = fileTagsMap.get(file.relativePath);
      if (!areTagSetsEqual(existingTags, manifestTags)) {
        manifestTagChangedPaths.add(file.relativePath);
      }

      fileTagsMap.set(file.relativePath, manifestTags);
    }

    const indexState = await getIndexStateMap();

    if (files.length === 0) {
      logger("No files found to index.");
      logger("_______________________________________________________");
      const summary = {
        filesFound: 0,
        changedFiles: [],
        removedFiles: Object.keys(indexState),
        indexedCount: 0,
        removedCount: Object.keys(indexState).length,
        skipped: true,
      };

      await removeDeletedMetadata(Object.keys(indexState));
      await markIndexingFinished({ jobId, status: "ready", startedAt, summary });
      return summary;
    }

    const changedFiles = activeFiles.filter(
      (file) =>
        indexState[file.relativePath] !== file.hash || manifestTagChangedPaths.has(file.relativePath)
    );
    const removedFiles = Object.keys(indexState).filter(
      (relativePath) => !activeFilePathSet.has(relativePath)
    );
    const disabledRemovedFiles = removedFiles.filter((filePath) => disabledPaths.has(filePath));
    const deletedRemovedFiles = removedFiles.filter((filePath) => !disabledPaths.has(filePath));

    logger(`Changed/new files: ${changedFiles.length}`);
    logger(`Removed files: ${removedFiles.length}`);

    await markManagedLibraryFilesStatus(
      changedFiles.map((file) => file.relativePath),
      "embedding",
      { jobId }
    );
    await clearManagedLibraryFileErrors(changedFiles.map((file) => file.relativePath));
    await markManagedLibraryFilesStatus(removedFiles, "removing", { jobId });
    await clearManagedLibraryFileErrors(removedFiles);

    if (changedFiles.length === 0 && removedFiles.length === 0) {
      logger("No indexing needed.");
      logger("_______________________________________________________");
      const summary = {
        filesFound: files.length,
        changedFiles: changedFiles.map((file) => file.relativePath),
        removedFiles: [...removedFiles],
        indexedCount: 0,
        removedCount: 0,
        skipped: true,
      };

      await upsertFileMetadata(files, indexState);
      await markIndexingFinished({ jobId, status: "ready", startedAt, summary });
      return summary;
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
        await recordIndexingJobFile({
          jobId,
          filePath: removedFile,
          action: "delete",
          status: "success",
        });
        const removalStatus = disabledPaths.has(removedFile) ? "disabled" : "deleted";
        await markManagedLibraryFilesStatus([removedFile], removalStatus, { jobId });
      } catch (error) {
        console.error(`Failed removing ${removedFile}: ${error.message}`);
        await recordIndexingJobFile({
          jobId,
          filePath: removedFile,
          action: "delete",
          status: "error",
          error: error.message,
        });
        await markManagedLibraryFilesStatus([removedFile], "error", { jobId, error: error.message });
      }
    }

    let indexedCount = 0;
    const chunkCounts = {};

    for (const file of changedFiles) {
      try {
        logger(`Indexing file: ${file.relativePath}`);
        await deletePointsBySource(qdrant, file.relativePath);

        const chunkRecords = fileToChunks(file).filter((chunk) => chunk.text?.trim());
        chunkCounts[file.relativePath] = chunkRecords.length;
        if (chunkRecords.length === 0) {
          logger(`No chunks for file: ${file.relativePath}`);
          indexState[file.relativePath] = file.hash;
          await markManagedLibraryFilesStatus([file.relativePath], "ready", { jobId });
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
            tags: fileTagsMap.get(file.relativePath) || [DEFAULT_FILE_TAG],
          },
        }));

        await qdrant.upsert(COLLECTION_NAME, { wait: true, points });
        indexState[file.relativePath] = file.hash;
        indexedCount++;
        await recordIndexingJobFile({
          jobId,
          filePath: file.relativePath,
          action: "upsert",
          status: "success",
          chunkCount: chunkRecords.length,
        });
        await markManagedLibraryFilesStatus([file.relativePath], "ready", { jobId });
        logger(`Indexed ${chunkRecords.length} chunks: ${file.relativePath}`);
      } catch (error) {
        console.error(`Error indexing ${file.relativePath}: ${error.message}`);
        await recordIndexingJobFile({
          jobId,
          filePath: file.relativePath,
          action: "upsert",
          status: "error",
          error: error.message,
        });
        await markManagedLibraryFilesStatus([file.relativePath], "error", { jobId, error: error.message });
      }
    }

    await removeDeletedMetadata(removedFiles);
    await upsertFileMetadata(files, indexState, chunkCounts);
    for (const [relativePath, tags] of dataRootManifestTagsMap.entries()) {
      await updateFileTags(relativePath, tags);
    }
    logger("Index state saved to Postgres");
    logger("_______________________________________________________");

    const summary = {
      filesFound: files.length,
      changedFiles: changedFiles.map((file) => file.relativePath),
      removedFiles: [...removedFiles],
      indexedCount,
      removedCount,
      disabledRemovedCount: disabledRemovedFiles.length,
      deletedRemovedCount: deletedRemovedFiles.length,
      skipped: false,
    };

    await markIndexingFinished({ jobId, status: "ready", startedAt, summary });
    return summary;
  } catch (error) {
    await markIndexingFinished({ jobId, status: "error", startedAt, summary: null, error: error.message });
    throw error;
  }
}
