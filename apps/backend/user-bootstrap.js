import fs from "fs/promises";
import path from "path";
import { dbQuery } from "../../shared/db/index.js";
import { getGlobalPasswordSalt, hashPasswordWithGlobalSalt } from "../../shared/src/auth.js";

const DEFAULT_USERNAME = "default";
const DEFAULT_DISPLAY_NAME = "Default User";
const DEFAULT_PASSWORD = "default";
const USERS_CONFIG_PATH = String(process.env.AUTH_USERS_FILE || "").trim();

function normalizeConfiguredUsers(rawConfig) {
  const list = Array.isArray(rawConfig)
    ? rawConfig
    : Array.isArray(rawConfig?.users)
      ? rawConfig.users
      : [];

  return list
    .map((entry) => {
      const username = String(entry?.username || "").trim();
      const displayName = String(entry?.display_name || "").trim();
      const password = String(entry?.password || "");
      if (!username || !displayName || !password) {
        return null;
      }
      if (username === DEFAULT_USERNAME) {
        return null;
      }
      return {
        username,
        displayName,
        password,
      };
    })
    .filter(Boolean);
}

async function ensureDefaultUser() {
  const globalSalt = getGlobalPasswordSalt();
  const hashedDefaultPassword = hashPasswordWithGlobalSalt(DEFAULT_PASSWORD);
  const result = await dbQuery(
    `INSERT INTO users (username, display_name, password_hash, password_salt, is_active, require_changepw, updated_at)
     VALUES ($1, $2, $3, $4, TRUE, FALSE, NOW())
     ON CONFLICT (username) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           password_hash = EXCLUDED.password_hash,
           password_salt = EXCLUDED.password_salt,
           is_active = TRUE,
           require_changepw = FALSE,
           updated_at = NOW()
     RETURNING id`,
    [DEFAULT_USERNAME, DEFAULT_DISPLAY_NAME, hashedDefaultPassword, globalSalt]
  );
  return result.rows[0]?.id || null;
}

function resolveUsersConfigPath() {
  if (USERS_CONFIG_PATH) {
    return path.resolve(USERS_CONFIG_PATH);
  }
  return path.resolve(process.cwd(), "users.json");
}

export async function syncUsersFromConfigFile(filePath = resolveUsersConfigPath()) {
  const defaultUserId = await ensureDefaultUser();

  let parsed = { users: [] };
  try {
    const raw = await fs.readFile(filePath, "utf8");
    parsed = raw.trim() ? JSON.parse(raw) : { users: [] };
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw new Error(`Failed to read users config at ${filePath}: ${error.message}`);
    }
  }

  const configuredUsers = normalizeConfiguredUsers(parsed);

  await dbQuery("BEGIN");
  try {
    for (const user of configuredUsers) {
      const passwordHash = hashPasswordWithGlobalSalt(user.password);
      const globalSalt = getGlobalPasswordSalt();
      await dbQuery(
        `INSERT INTO users (username, display_name, password_hash, password_salt, is_active, require_changepw, updated_at)
         VALUES ($1, $2, $3, $4, TRUE, TRUE, NOW())
         ON CONFLICT (username) DO UPDATE
           SET display_name = EXCLUDED.display_name,
               password_hash = EXCLUDED.password_hash,
               password_salt = EXCLUDED.password_salt,
               is_active = TRUE,
               require_changepw = TRUE,
               updated_at = NOW()`,
        [user.username, user.displayName, passwordHash, globalSalt]
      );
    }

    const configuredUsernames = configuredUsers.map((entry) => entry.username);
    if (configuredUsernames.length > 0) {
      await dbQuery(
        `UPDATE users
         SET is_active = FALSE,
             updated_at = NOW()
         WHERE username <> $1
           AND username <> ALL($2::text[])
           AND is_active = TRUE`,
        [DEFAULT_USERNAME, configuredUsernames]
      );
    } else {
      await dbQuery(
        `UPDATE users
         SET is_active = FALSE,
             updated_at = NOW()
         WHERE username <> $1
           AND is_active = TRUE`,
        [DEFAULT_USERNAME]
      );
    }

    await dbQuery(
      `UPDATE users
       SET is_active = TRUE,
           updated_at = NOW()
       WHERE id = $1`,
      [defaultUserId]
    );

    await dbQuery("COMMIT");
  } catch (error) {
    await dbQuery("ROLLBACK");
    throw error;
  }

  return {
    filePath,
    configured: configuredUsers.length,
  };
}
