ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS tag_filter_state JSONB NOT NULL DEFAULT '{"disabledTags":[]}'::jsonb;

UPDATE chats
SET tag_filter_state = '{"disabledTags":[]}'::jsonb
WHERE tag_filter_state IS NULL;
