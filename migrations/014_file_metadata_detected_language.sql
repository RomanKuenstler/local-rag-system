ALTER TABLE file_metadata
ADD COLUMN IF NOT EXISTS detected_language TEXT;

CREATE INDEX IF NOT EXISTS idx_file_metadata_detected_language
  ON file_metadata (detected_language);
