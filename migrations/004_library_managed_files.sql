CREATE TABLE IF NOT EXISTS library_managed_files (
  file_path TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'webui',
  upload_status TEXT NOT NULL DEFAULT 'uploaded',
  size_bytes BIGINT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  embedded_at TIMESTAMPTZ,
  last_error TEXT,
  last_job_id BIGINT REFERENCES indexing_jobs(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_managed_files_status
  ON library_managed_files (upload_status, updated_at DESC);
