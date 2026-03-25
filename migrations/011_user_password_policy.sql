ALTER TABLE users
  ADD COLUMN IF NOT EXISTS require_changepw BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users
SET require_changepw = FALSE,
    updated_at = NOW()
WHERE username = 'default';

UPDATE users
SET password_salt = 'xzy132',
    password_hash = '8a9edac9fb3cfa663691b6ea41718e801e72b7555e4b04d66e9d053ce2c444e7',
    is_active = TRUE,
    require_changepw = FALSE,
    updated_at = NOW()
WHERE username = 'default';
