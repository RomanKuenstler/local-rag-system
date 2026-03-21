import fs from "fs/promises";
import path from "path";
import { CONTENT_PATH, EMBEDDABLE_EXTENSIONS } from "./config.js";
import {
  getManagedLibraryFile,
  listManagedLibraryFilesWithStatus,
  markManagedLibraryFileDeleted,
  upsertManagedLibraryFile,
} from "./state-store.js";

const LIBRARY_UPLOAD_SUBDIR = (process.env.LIBRARY_UPLOAD_SUBDIR || "_library").trim();
const MAX_LIBRARY_UPLOAD_BYTES = Number.parseInt(process.env.MAX_LIBRARY_UPLOAD_BYTES || String(15 * 1024 * 1024), 10);
const EMBEDDABLE_EXTENSION_SET = new Set(EMBEDDABLE_EXTENSIONS.map((extension) => extension.toLowerCase()));

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

export async function saveManagedLibraryFile({ fileName, contentBase64, overwrite = false }) {
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

  const relativePath = path.posix.join(LIBRARY_UPLOAD_SUBDIR, normalizedName);
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
  });

  return {
    path: relativePath,
    name: normalizedName,
    sizeBytes: fileBuffer.length,
    status: "uploaded",
  };
}

export async function deleteManagedLibraryFile(filePath) {
  const file = await getManagedLibraryFile(filePath);
  if (!file) {
    return { deleted: false, reason: "not_found" };
  }

  const absolutePath = ensurePathInsideContentRoot(file.file_path);
  await fs.rm(absolutePath, { force: true });
  await markManagedLibraryFileDeleted(file.file_path);
  return { deleted: true, path: file.file_path };
}

export async function listManagedLibraryFiles() {
  const rows = await listManagedLibraryFilesWithStatus();
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
    lastModified: row.last_modified,
    hash: row.file_hash,
    chunkCount: row.chunk_count,
    embedded: row.embedded,
    updatedAt: row.updated_at,
  }));
}
