CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_username_not_blank CHECK (BTRIM(username) <> ''),
  CONSTRAINT users_display_name_not_blank CHECK (BTRIM(display_name) <> '')
);

CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_identifier TEXT NOT NULL UNIQUE REFERENCES chat_sessions(id) ON DELETE CASCADE,
  session_token_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  CONSTRAINT sessions_session_identifier_not_blank CHECK (BTRIM(session_identifier) <> '')
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id
  ON sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_expires_at
  ON sessions (expires_at);

INSERT INTO users (username, display_name, password_hash, is_active)
VALUES ('local-default', 'Local Default User', '__DISABLED__', TRUE)
ON CONFLICT (username) DO NOTHING;

INSERT INTO sessions (user_id, session_identifier, session_token_hash, created_at, expires_at)
SELECT u.id, cs.id, NULL, cs.created_at, NULL
FROM chat_sessions cs
JOIN users u ON u.username = 'local-default'
ON CONFLICT (session_identifier) DO NOTHING;
