ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived'));

ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

UPDATE chats
SET status = 'active'
WHERE status IS NULL;

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS active_chat_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'chat_sessions_active_chat_id_fkey'
      AND table_name = 'chat_sessions'
  ) THEN
    ALTER TABLE chat_sessions
      ADD CONSTRAINT chat_sessions_active_chat_id_fkey
      FOREIGN KEY (active_chat_id) REFERENCES chats(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chats_session_status_updated
  ON chats (session_id, status, updated_at DESC);
