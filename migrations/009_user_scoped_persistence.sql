WITH default_user AS (
  INSERT INTO users (username, display_name, password_hash, is_active)
  VALUES ('local-default', 'Local Default User', '__DISABLED__', TRUE)
  ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
  RETURNING id
), resolved_default_user AS (
  SELECT id FROM default_user
  UNION ALL
  SELECT id FROM users WHERE username = 'local-default' LIMIT 1
)
INSERT INTO sessions (user_id, session_identifier, session_token_hash, created_at, expires_at)
SELECT u.id, cs.id, NULL, cs.created_at, NULL
FROM chat_sessions cs
CROSS JOIN resolved_default_user u
ON CONFLICT (session_identifier) DO NOTHING;

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS user_id BIGINT;

WITH resolved_default_user AS (
  SELECT id FROM users WHERE username = 'local-default' LIMIT 1
)
UPDATE app_settings
SET user_id = (SELECT id FROM resolved_default_user)
WHERE user_id IS NULL;

ALTER TABLE app_settings
  ALTER COLUMN user_id SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'app_settings'
      AND constraint_type = 'PRIMARY KEY'
      AND constraint_name = 'app_settings_pkey'
  ) THEN
    ALTER TABLE app_settings DROP CONSTRAINT app_settings_pkey;
  END IF;
END $$;

ALTER TABLE app_settings
  ADD CONSTRAINT app_settings_pkey PRIMARY KEY (user_id, setting_key);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'app_settings_user_id_fkey'
      AND table_name = 'app_settings'
  ) THEN
    ALTER TABLE app_settings
      ADD CONSTRAINT app_settings_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_app_settings_setting_key
  ON app_settings (setting_key);

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS user_id BIGINT;

UPDATE chat_sessions cs
SET user_id = s.user_id
FROM sessions s
WHERE s.session_identifier = cs.id
  AND cs.user_id IS NULL;

WITH resolved_default_user AS (
  SELECT id FROM users WHERE username = 'local-default' LIMIT 1
)
UPDATE chat_sessions
SET user_id = (SELECT id FROM resolved_default_user)
WHERE user_id IS NULL;

ALTER TABLE chat_sessions
  ALTER COLUMN user_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'chat_sessions_user_id_fkey'
      AND table_name = 'chat_sessions'
  ) THEN
    ALTER TABLE chat_sessions
      ADD CONSTRAINT chat_sessions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_id
  ON chat_sessions (user_id, updated_at DESC);

ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS user_id BIGINT;

UPDATE chats c
SET user_id = cs.user_id
FROM chat_sessions cs
WHERE c.session_id = cs.id
  AND c.user_id IS NULL;

ALTER TABLE chats
  ALTER COLUMN user_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'chats_user_id_fkey'
      AND table_name = 'chats'
  ) THEN
    ALTER TABLE chats
      ADD CONSTRAINT chats_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chats_user_session_status_updated
  ON chats (user_id, session_id, status, updated_at DESC);

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS user_id BIGINT;

UPDATE chat_messages cm
SET user_id = cs.user_id
FROM chat_sessions cs
WHERE cm.session_id = cs.id
  AND cm.user_id IS NULL;

ALTER TABLE chat_messages
  ALTER COLUMN user_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'chat_messages_user_id_fkey'
      AND table_name = 'chat_messages'
  ) THEN
    ALTER TABLE chat_messages
      ADD CONSTRAINT chat_messages_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chat_messages_user_chat_created_at
  ON chat_messages (user_id, chat_id, created_at, id);
