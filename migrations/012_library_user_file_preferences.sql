ALTER TABLE library_managed_files
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_library_managed_files_uploaded_by_user
  ON library_managed_files (uploaded_by_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS user_library_file_preferences (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL REFERENCES library_managed_files(file_path) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_user_library_file_preferences_user_enabled
  ON user_library_file_preferences (user_id, enabled, updated_at DESC);
