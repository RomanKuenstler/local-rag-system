import { dbQuery } from "./db.js";

export async function initializeStateDefaults({ uiMode, assistantMode, profileId }) {
  const defaults = [
    ["ui_mode", { value: uiMode }],
    ["assistant_mode", { value: assistantMode }],
    ["profile_id", { value: profileId }],
  ];

  for (const [key, value] of defaults) {
    await dbQuery(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (setting_key) DO NOTHING`,
      [key, JSON.stringify(value)]
    );
  }
}

export async function initializeRuntimeConfigDefaults({ historyMessages, maxSimilarities, minSimilarities, cosineLimit }) {
  const defaults = [
    ["history_messages", { value: historyMessages }],
    ["max_similarities", { value: maxSimilarities }],
    ["min_similarities", { value: minSimilarities }],
    ["cosine_limit", { value: cosineLimit }],
  ];

  for (const [key, value] of defaults) {
    await dbQuery(
      `INSERT INTO app_settings (setting_key, setting_value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (setting_key) DO NOTHING`,
      [key, JSON.stringify(value)]
    );
  }
}

export async function getSelectionState(fallbacks) {
  const result = await dbQuery(
    "SELECT setting_key, setting_value FROM app_settings WHERE setting_key = ANY($1)",
    [["ui_mode", "assistant_mode", "profile_id"]]
  );

  const map = new Map(result.rows.map((row) => [row.setting_key, row.setting_value?.value]));
  return {
    uiMode: map.get("ui_mode") || fallbacks.uiMode,
    assistantMode: map.get("assistant_mode") || fallbacks.assistantMode,
    profileId: map.get("profile_id") || fallbacks.profileId,
  };
}

export async function updateSetting(key, value) {
  await dbQuery(
    `INSERT INTO app_settings (setting_key, setting_value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           updated_at = NOW()`,
    [key, JSON.stringify({ value })]
  );
}

export async function getRuntimeConfigState(fallbacks) {
  const result = await dbQuery(
    "SELECT setting_key, setting_value FROM app_settings WHERE setting_key = ANY($1)",
    [["history_messages", "max_similarities", "min_similarities", "cosine_limit"]]
  );

  const map = new Map(result.rows.map((row) => [row.setting_key, row.setting_value?.value]));
  return {
    historyMessages: Number.parseInt(String(map.get("history_messages") ?? fallbacks.historyMessages), 10),
    maxSimilarities: Number.parseInt(String(map.get("max_similarities") ?? fallbacks.maxSimilarities), 10),
    minSimilarities: Number.parseInt(String(map.get("min_similarities") ?? fallbacks.minSimilarities), 10),
    cosineLimit: Number.parseFloat(String(map.get("cosine_limit") ?? fallbacks.cosineLimit)),
  };
}

export async function ensureChatContext({ sessionId, chatId, chatName = null }) {
  await dbQuery(
    `INSERT INTO chat_sessions (id, updated_at)
     VALUES ($1, NOW())
     ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
    [sessionId]
  );

  await dbQuery(
    `INSERT INTO chats (id, session_id, name, updated_at)
     VALUES ($1, $2, COALESCE($3, CONCAT('chat-', SUBSTRING(MD5(random()::text), 1, 6))), NOW())
     ON CONFLICT (id) DO UPDATE SET session_id = EXCLUDED.session_id, updated_at = NOW()`,
    [chatId, sessionId, chatName]
  );

  const result = await dbQuery(
    "SELECT name FROM chats WHERE id = $1",
    [chatId]
  );
  return result.rows[0]?.name || null;
}

export async function addChatMessage({ sessionId, chatId, role, content, metadata = {} }) {
  await dbQuery(
    `INSERT INTO chat_messages (session_id, chat_id, role, content, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [sessionId, chatId, role, content, JSON.stringify(metadata || {})]
  );

  await dbQuery("UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1", [sessionId]);
  await dbQuery("UPDATE chats SET updated_at = NOW() WHERE id = $1", [chatId]);
}

export async function listChatMessages({ sessionId, chatId, limit = null }) {
  const hasLimit = Number.isInteger(limit) && limit > 0;
  const result = hasLimit
    ? await dbQuery(
      `SELECT role, content, metadata, created_at
       FROM (
         SELECT id, role, content, metadata, created_at
         FROM chat_messages
         WHERE session_id = $1 AND chat_id = $2
         ORDER BY created_at DESC, id DESC
         LIMIT $3
       ) recent
       ORDER BY created_at ASC, id ASC`,
      [sessionId, chatId, limit]
    )
    : await dbQuery(
      `SELECT role, content, metadata, created_at
       FROM chat_messages
       WHERE session_id = $1 AND chat_id = $2
       ORDER BY created_at ASC, id ASC`,
      [sessionId, chatId]
    );

  return result.rows;
}

export async function listRecentPromptHistory({ sessionId, chatId, limit }) {
  const safeLimit = Math.max(0, Number.parseInt(String(limit || 0), 10));
  if (safeLimit === 0) {
    return [];
  }

  const result = await dbQuery(
    `SELECT role, content
     FROM (
       SELECT id, role, content
       FROM chat_messages
       WHERE session_id = $1 AND chat_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3
     ) recent
     ORDER BY id ASC`,
    [sessionId, chatId, safeLimit]
  );

  return result.rows.map((row) => [row.role === "assistant" ? "ai" : "human", row.content]);
}

export async function getIndexStateMap() {
  const result = await dbQuery("SELECT file_path, file_hash FROM file_metadata WHERE embedded = TRUE");
  return Object.fromEntries(result.rows.map((row) => [row.file_path, row.file_hash]));
}

export async function upsertFileMetadata(files, indexState, chunkCounts = {}) {
  for (const file of files) {
    await dbQuery(
      `INSERT INTO file_metadata (
         file_path, extension, size_bytes, last_modified, file_hash, chunk_count, embedded, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (file_path) DO UPDATE SET
         extension = EXCLUDED.extension,
         size_bytes = EXCLUDED.size_bytes,
         last_modified = EXCLUDED.last_modified,
         file_hash = EXCLUDED.file_hash,
         chunk_count = COALESCE(EXCLUDED.chunk_count, file_metadata.chunk_count),
         embedded = EXCLUDED.embedded,
         updated_at = NOW()`,
      [
        file.relativePath,
        file.extension,
        file.size,
        file.lastModified ? new Date(file.lastModified).toISOString() : null,
        file.hash,
        chunkCounts[file.relativePath] ?? null,
        indexState[file.relativePath] === file.hash,
      ]
    );
  }
}

export async function removeDeletedMetadata(paths) {
  if (!paths.length) return;
  await dbQuery("DELETE FROM file_metadata WHERE file_path = ANY($1)", [paths]);
}

export async function listFileMetadata() {
  const result = await dbQuery(
    `SELECT file_path, extension, size_bytes, last_modified, file_hash, chunk_count, embedded
     FROM file_metadata
     ORDER BY file_path ASC`
  );
  return result.rows;
}

export async function upsertManagedLibraryFile({
  filePath,
  originalName,
  source = "webui",
  sizeBytes,
  status = "uploaded",
}) {
  await dbQuery(
    `INSERT INTO library_managed_files (
       file_path, original_name, source, upload_status, size_bytes, uploaded_at, embedded_at, last_error, updated_at
     ) VALUES ($1, $2, $3, $4, $5, NOW(), NULL, NULL, NOW())
     ON CONFLICT (file_path) DO UPDATE SET
       original_name = EXCLUDED.original_name,
       source = EXCLUDED.source,
       upload_status = EXCLUDED.upload_status,
       size_bytes = EXCLUDED.size_bytes,
       uploaded_at = NOW(),
       embedded_at = NULL,
       last_error = NULL,
       updated_at = NOW()`,
    [filePath, originalName, source, status, sizeBytes]
  );
}

export async function markManagedLibraryFilesStatus(filePaths, status, { jobId = null, error = null } = {}) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return;
  }

  await dbQuery(
    `UPDATE library_managed_files
     SET upload_status = $2,
         embedded_at = CASE WHEN $2 = 'ready' THEN NOW() ELSE embedded_at END,
         last_error = CASE WHEN $3::text IS NULL THEN last_error ELSE $3::text END,
         last_job_id = COALESCE($4::bigint, last_job_id),
         updated_at = NOW()
     WHERE file_path = ANY($1)`,
    [filePaths, status, error, jobId]
  );
}

export async function clearManagedLibraryFileErrors(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return;
  }

  await dbQuery(
    `UPDATE library_managed_files
     SET last_error = NULL,
         updated_at = NOW()
     WHERE file_path = ANY($1)`,
    [filePaths]
  );
}

export async function markManagedLibraryFileDeleted(filePath) {
  await dbQuery(
    `UPDATE library_managed_files
     SET upload_status = 'deleted',
         updated_at = NOW()
     WHERE file_path = $1`,
    [filePath]
  );
}

export async function getManagedLibraryFile(filePath) {
  const result = await dbQuery(
    `SELECT file_path, original_name, source, upload_status, size_bytes, uploaded_at, embedded_at, last_error, last_job_id, updated_at
     FROM library_managed_files
     WHERE file_path = $1`,
    [filePath]
  );
  return result.rows[0] || null;
}

export async function listManagedLibraryFilesWithStatus() {
  const result = await dbQuery(
    `SELECT
       m.file_path,
       m.original_name,
       m.source,
       m.upload_status,
       m.size_bytes,
       m.uploaded_at,
       m.embedded_at,
       m.last_error,
       m.last_job_id,
       m.updated_at,
       f.extension,
       f.last_modified,
       f.file_hash,
       f.chunk_count,
       f.embedded
     FROM library_managed_files m
     LEFT JOIN file_metadata f ON f.file_path = m.file_path
     ORDER BY m.updated_at DESC, m.file_path ASC`
  );
  return result.rows;
}

export async function markIndexingStarted(startedAt) {
  const job = await dbQuery(
    `INSERT INTO indexing_jobs (status, started_at, updated_at)
     VALUES ('running', $1, NOW()) RETURNING id`,
    [startedAt]
  );
  const jobId = job.rows[0].id;

  await dbQuery(
    `INSERT INTO embedding_status (singleton, status, started_at, last_job_id, updated_at)
     VALUES (TRUE, 'running', $1, $2, NOW())
     ON CONFLICT (singleton) DO UPDATE
       SET status = EXCLUDED.status,
           started_at = EXCLUDED.started_at,
           finished_at = NULL,
           summary = NULL,
           error_message = NULL,
           last_job_id = EXCLUDED.last_job_id,
           updated_at = NOW()`,
    [startedAt, jobId]
  );

  return jobId;
}

export async function recordIndexingJobFile({
  jobId,
  filePath,
  action,
  status,
  chunkCount = null,
  error = null,
}) {
  await dbQuery(
    `INSERT INTO indexing_job_files (
       job_id, file_path, action, status, chunk_count, error_message, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [jobId, filePath, action, status, chunkCount, error]
  );
}

export async function markIndexingFinished({ jobId, status, startedAt, summary, error }) {
  const finishedAt = new Date().toISOString();
  await dbQuery(
    `UPDATE indexing_jobs
     SET status = $2, finished_at = $3, summary = $4::jsonb, error_message = $5, updated_at = NOW()
     WHERE id = $1`,
    [jobId, status, finishedAt, JSON.stringify(summary || null), error || null]
  );

  await dbQuery(
    `INSERT INTO embedding_status (singleton, status, started_at, finished_at, summary, error_message, last_job_id, updated_at)
     VALUES (TRUE, $1, $2, $3, $4::jsonb, $5, $6, NOW())
     ON CONFLICT (singleton) DO UPDATE
       SET status = EXCLUDED.status,
           started_at = EXCLUDED.started_at,
           finished_at = EXCLUDED.finished_at,
           summary = EXCLUDED.summary,
           error_message = EXCLUDED.error_message,
           last_job_id = EXCLUDED.last_job_id,
           updated_at = NOW()`,
    [status, startedAt, finishedAt, JSON.stringify(summary || null), error || null, jobId]
  );
}

export async function getEmbeddingStatus() {
  const result = await dbQuery(
    `SELECT status, started_at, finished_at, summary, error_message, last_job_id, updated_at
     FROM embedding_status WHERE singleton = TRUE`
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    summary: row.summary,
    error: row.error_message,
    lastJobId: row.last_job_id,
    updatedAt: row.updated_at,
  };
}
