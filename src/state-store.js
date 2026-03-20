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
