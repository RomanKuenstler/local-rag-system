ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_salt TEXT;

UPDATE users
SET password_salt = '__LEGACY_SALT__'
WHERE password_salt IS NULL;

ALTER TABLE users
  ALTER COLUMN password_salt SET NOT NULL;

DO $$
DECLARE
  local_default_id BIGINT;
  default_id BIGINT;
BEGIN
  SELECT id INTO local_default_id FROM users WHERE username = 'local-default' LIMIT 1;
  SELECT id INTO default_id FROM users WHERE username = 'default' LIMIT 1;

  IF local_default_id IS NOT NULL AND default_id IS NOT NULL AND local_default_id <> default_id THEN
    UPDATE sessions SET user_id = default_id WHERE user_id = local_default_id;
    UPDATE chat_sessions SET user_id = default_id WHERE user_id = local_default_id;
    UPDATE chats SET user_id = default_id WHERE user_id = local_default_id;
    UPDATE chat_messages SET user_id = default_id WHERE user_id = local_default_id;
    UPDATE app_settings SET user_id = default_id WHERE user_id = local_default_id;
    DELETE FROM users WHERE id = local_default_id;
  ELSIF local_default_id IS NOT NULL AND default_id IS NULL THEN
    UPDATE users
    SET username = 'default',
        display_name = 'Default User',
        is_active = TRUE,
        updated_at = NOW()
    WHERE id = local_default_id;
  END IF;
END $$;

INSERT INTO users (username, display_name, password_hash, password_salt, is_active)
VALUES ('default', 'Default User', '__DISABLED__', '__DEFAULT_SALT__', TRUE)
ON CONFLICT (username) DO UPDATE
SET is_active = TRUE,
    display_name = EXCLUDED.display_name,
    updated_at = NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'users'
      AND constraint_name = 'users_password_salt_not_blank'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_password_salt_not_blank CHECK (BTRIM(password_salt) <> '');
  END IF;
END $$;
