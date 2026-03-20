CREATE TABLE IF NOT EXISTS app_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS file_metadata (
  file_path TEXT PRIMARY KEY,
  extension TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  last_modified TIMESTAMPTZ,
  file_hash TEXT NOT NULL,
  chunk_count INTEGER,
  embedded BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS indexing_jobs (
  id BIGSERIAL PRIMARY KEY,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  summary JSONB,
  error_message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS indexing_job_files (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES indexing_jobs(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  chunk_count INTEGER,
  error_message TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS embedding_status (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  summary JSONB,
  error_message TEXT,
  last_job_id BIGINT REFERENCES indexing_jobs(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
