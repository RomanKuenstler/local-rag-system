import fs from "fs/promises";
import path from "path";
import { COLLECTION_NAME, CONTENT_PATH, DEFAULT_FILE_TAG, EMBEDDABLE_EXTENSIONS } from "../../shared/config/index.js";
import { dbQuery } from "../../shared/db/index.js";
import { createQdrantClient } from "../../shared/src/embedding-service.js";
import {
  getManagedLibraryFile,
  hardDeleteManagedLibraryFile,
  listManagedLibraryFilesWithUserPreferences,
  setManagedLibraryFileEnabledForUser,
  setFileTagsForPath,
  upsertManagedLibraryFile,
} from "../../shared/src/state-store.js";

const LIBRARY_UPLOAD_SUBDIR = (process.env.LIBRARY_UPLOAD_SUBDIR || "_library").trim();
const MAX_LIBRARY_UPLOAD_BYTES = Number.parseInt(process.env.MAX_LIBRARY_UPLOAD_BYTES || String(15 * 1024 * 1024), 10);
const EMBEDDABLE_EXTENSION_SET = new Set(EMBEDDABLE_EXTENSIONS.map((extension) => extension.toLowerCase()));
const TAG_PATTERN = /^[a-z0-9][a-z0-9_\-:.]{0,63}$/;
const VECTOR_DELETE_VERIFY_RETRIES = 12;
const VECTOR_DELETE_VERIFY_DELAY_MS = 150;

function normalizeTags(tags) {
  const input = Array.isArray(tags)
    ? tags
    : typeof tags === "string"
      ? tags.split(",")
      : [];
  const normalized = input
    .map((tag) => String(tag || "").trim().toLowerCase())
    .filter(Boolean)
    .filter((tag) => TAG_PATTERN.test(tag));
  return [...new Set(normalized)];
}

function normalizeFilename(name) {
  const fileName = path.basename(String(name || "").trim());
  return fileName.replace(/[^\w.\-() ]+/g, "_");
}

export function isAllowedLibraryFileExtension(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return EMBEDDABLE_EXTENSION_SET.has(extension);
}

function ensurePathInsideContentRoot(relativePath) {
  const absoluteContentRoot = path.resolve(CONTENT_PATH);
  const absoluteTarget = path.resolve(CONTENT_PATH, relativePath);
  const relativeToRoot = path.relative(absoluteContentRoot, absoluteTarget);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("Resolved path escapes content root.");
  }

  return absoluteTarget;
}

export async function saveManagedLibraryFile({
  fileName,
  contentBase64,
  overwrite = false,
  tags = [],
  uploadedByUserId = null,
  saveToRoot = false,
}) {
  const normalizedUploadedByUserId = Number.parseInt(String(uploadedByUserId || ""), 10);
  const normalizedName = normalizeFilename(fileName);
  if (!normalizedName) {
    throw new Error("Missing file name.");
  }

  if (!isAllowedLibraryFileExtension(normalizedName)) {
    throw new Error(`Unsupported file extension for '${normalizedName}'.`);
  }

  if (typeof contentBase64 !== "string" || contentBase64.length === 0) {
    throw new Error("Missing file content.");
  }

  let fileBuffer;
  try {
    fileBuffer = Buffer.from(contentBase64, "base64");
  } catch {
    throw new Error("Invalid base64 file payload.");
  }

  if (fileBuffer.length === 0) {
    throw new Error("File is empty.");
  }

  if (fileBuffer.length > MAX_LIBRARY_UPLOAD_BYTES) {
    throw new Error(`File too large. Max allowed size is ${MAX_LIBRARY_UPLOAD_BYTES} bytes.`);
  }

  const relativePath = saveToRoot
    ? normalizedName
    : path.posix.join(LIBRARY_UPLOAD_SUBDIR, normalizedName);
  const absolutePath = ensurePathInsideContentRoot(relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });

  if (!overwrite) {
    try {
      await fs.access(absolutePath);
      throw new Error("File already exists.");
    } catch (error) {
      if (error.message === "File already exists.") {
        throw error;
      }
    }
  }

  await fs.writeFile(absolutePath, fileBuffer);
  await upsertManagedLibraryFile({
    filePath: relativePath,
    originalName: normalizedName,
    source: "webui",
    sizeBytes: fileBuffer.length,
    status: "uploaded",
    uploadedByUserId: Number.isInteger(normalizedUploadedByUserId) && normalizedUploadedByUserId > 0
      ? normalizedUploadedByUserId
      : null,
  });
  const normalizedTags = normalizeTags(tags);
  await setFileTagsForPath(relativePath, normalizedTags.length > 0 ? normalizedTags : [DEFAULT_FILE_TAG]);

  return {
    path: relativePath,
    name: normalizedName,
    sizeBytes: fileBuffer.length,
    status: "uploaded",
    tags: normalizedTags.length > 0 ? normalizedTags : [DEFAULT_FILE_TAG],
  };
}

async function deletePointsBySource(relativePath) {
  const qdrant = createQdrantClient();
  const sourceFilter = {
    must: [
      {
        key: "source",
        match: {
          value: relativePath,
        },
      },
    ],
  };

  let beforeCount = null;
  try {
    const before = await qdrant.count(COLLECTION_NAME, {
      exact: true,
      filter: sourceFilter,
    });
    if (Number.isFinite(before?.count)) {
      beforeCount = Number(before.count);
    }
  } catch {
    beforeCount = null;
  }

  await qdrant.delete(COLLECTION_NAME, {
    wait: true,
    filter: sourceFilter,
  });

  for (let attempt = 0; attempt < VECTOR_DELETE_VERIFY_RETRIES; attempt++) {
    const remaining = await qdrant.count(COLLECTION_NAME, {
      exact: true,
      filter: sourceFilter,
    });
    const remainingCount = Number(remaining?.count || 0);
    if (remainingCount <= 0) {
      return { removedVectors: beforeCount };
    }
    await new Promise((resolve) => setTimeout(resolve, VECTOR_DELETE_VERIFY_DELAY_MS));
  }

  throw new Error(`Vector deletion verification failed for '${relativePath}'.`);
}

export async function deleteManagedLibraryFileForUser(filePath, { userId, isAdmin = false }) {
  const requestedPath = String(filePath || "").trim();
  if (!requestedPath) {
    return { deleted: false, reason: "not_found" };
  }

  const file = await getManagedLibraryFile(requestedPath);
  const effectivePath = file?.file_path || requestedPath;

  if (!isAdmin) {
    if (!file) {
      return { deleted: false, reason: "not_found" };
    }
    if (!String(file.file_path || "").startsWith(`${LIBRARY_UPLOAD_SUBDIR}/`)) {
      return { deleted: false, reason: "not_user_managed" };
    }
    if (!userId || Number(file.uploaded_by_user_id) !== Number(userId)) {
      return { deleted: false, reason: "not_owner" };
    }
  }

  const knownFileResult = await dbQuery(
    `SELECT 1
     FROM file_metadata
     WHERE file_path = $1
     LIMIT 1`,
    [effectivePath]
  );
  if (!file && knownFileResult.rowCount === 0) {
    return { deleted: false, reason: "not_found" };
  }

  const absolutePath = ensurePathInsideContentRoot(effectivePath);
  await fs.rm(absolutePath, { force: true });
  const vectorDeletion = await deletePointsBySource(effectivePath).catch((error) => {
    throw new Error(`Failed deleting vector chunks: ${error.message}`);
  });
  await hardDeleteManagedLibraryFile(effectivePath);
  return { deleted: true, path: effectivePath, removedVectors: vectorDeletion?.removedVectors ?? null };
}

export async function listManagedLibraryFiles({ userId, isAdmin = false }) {
  const rows = await listManagedLibraryFilesWithUserPreferences(userId);
  return rows.map((row) => ({
    path: row.file_path,
    originalName: row.original_name,
    source: row.source,
    uploadStatus: row.upload_status,
    sizeBytes: Number(row.size_bytes),
    uploadedAt: row.uploaded_at,
    embeddedAt: row.embedded_at,
    lastError: row.last_error,
    lastJobId: row.last_job_id,
    extension: row.extension,
    detectedLanguage: row.detected_language || null,
    lastModified: row.last_modified,
    hash: row.file_hash,
    chunkCount: row.chunk_count,
    embedded: row.embedded,
    enabled: row.enabled !== false,
    canToggle: String(row.file_path || "").startsWith(`${LIBRARY_UPLOAD_SUBDIR}/`),
    canDelete: isAdmin || Number(row.uploaded_by_user_id) === Number(userId),
    updatedAt: row.updated_at,
  }));
}

export async function toggleManagedLibraryFile(filePath, enabled, { userId }) {
  const file = await getManagedLibraryFile(filePath);
  if (!file || file.upload_status === "deleted") {
    return { updated: false, reason: "not_found" };
  }
  if (!String(file.file_path || "").startsWith(`${LIBRARY_UPLOAD_SUBDIR}/`)) {
    return { updated: false, reason: "not_user_toggleable" };
  }

  const updated = await setManagedLibraryFileEnabledForUser({
    userId,
    filePath: file.file_path,
    enabled,
  });
  if (!updated) {
    return { updated: false, reason: "invalid_user_or_path" };
  }

  return {
    updated: true,
    path: file.file_path,
    enabled: updated.enabled !== false,
  };
}
