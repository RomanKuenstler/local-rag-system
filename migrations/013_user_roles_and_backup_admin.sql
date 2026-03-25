ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role TEXT;

UPDATE users
SET role = 'users'
WHERE role IS NULL;

ALTER TABLE users
  ALTER COLUMN role SET DEFAULT 'users';

ALTER TABLE users
  ALTER COLUMN role SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'users'
      AND constraint_name = 'users_role_valid'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_role_valid CHECK (role IN ('users', 'admin'));
  END IF;
END $$;

INSERT INTO users (username, display_name, password_hash, password_salt, role, is_active, require_changepw, updated_at)
VALUES ('defaultadm', 'Default Admin', '__DISABLED__', '__DEFAULT_SALT__', 'admin', TRUE, FALSE, NOW())
ON CONFLICT (username) DO UPDATE
SET display_name = EXCLUDED.display_name,
    role = EXCLUDED.role,
    is_active = TRUE,
    require_changepw = FALSE,
    updated_at = NOW();
