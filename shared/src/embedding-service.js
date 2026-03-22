import { randomUUID } from "crypto";
import { QdrantClient } from "@qdrant/js-client-rest";
import {
  CHUNK_OVERLAP,
  CHUNK_SIZE,
  COLLECTION_NAME,
  CONTENT_PATH,
  EMBEDDABLE_EXTENSIONS,
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
  getEmbeddingStatus,
  getIndexStateMap,
  listManagedLibraryFilesWithStatus,
  markManagedLibraryFilesStatus,
  markIndexingFinished,
  recordIndexingJobFile,
  markIndexingStarted,
  removeDeletedMetadata,
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

export async function readEmbeddableFiles() {
  return readTextFilesRecursively(CONTENT_PATH, EMBEDDABLE_EXTENSIONS);
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

    const changedFiles = activeFiles.filter((file) => indexState[file.relativePath] !== file.hash);
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
