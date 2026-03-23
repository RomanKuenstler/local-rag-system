CREATE TABLE IF NOT EXISTS file_tags (
  file_path TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (file_path, tag)
);

CREATE INDEX IF NOT EXISTS idx_file_tags_tag ON file_tags (tag);

INSERT INTO file_tags (file_path, tag)
SELECT m.file_path, 'default'
FROM file_metadata m
WHERE NOT EXISTS (
  SELECT 1 FROM file_tags t WHERE t.file_path = m.file_path
);
