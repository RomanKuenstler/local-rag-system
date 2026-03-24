import fs from "fs/promises";
import path from "path";
import { dbQuery } from "../../shared/db/index.js";

const DEFAULT_USERNAME = "default";
const DEFAULT_DISPLAY_NAME = "Default User";
const DEFAULT_PASSWORD_HASH = "__DISABLED__";
const DEFAULT_PASSWORD_SALT = "__DEFAULT_SALT__";

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
      const passwordHash = String(entry?.password_hash || "").trim();
      const passwordSalt = String(entry?.password_salt || "").trim();
      if (!username || !displayName || !passwordHash || !passwordSalt) {
        return null;
      }
      if (username === DEFAULT_USERNAME) {
        return null;
      }
      return {
        username,
        displayName,
        passwordHash,
        passwordSalt,
      };
    })
    .filter(Boolean);
}

async function ensureDefaultUser() {
  const result = await dbQuery(
    `INSERT INTO users (username, display_name, password_hash, password_salt, is_active, updated_at)
     VALUES ($1, $2, $3, $4, TRUE, NOW())
     ON CONFLICT (username) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           is_active = TRUE,
           updated_at = NOW()
     RETURNING id`,
    [DEFAULT_USERNAME, DEFAULT_DISPLAY_NAME, DEFAULT_PASSWORD_HASH, DEFAULT_PASSWORD_SALT]
  );
  return result.rows[0]?.id || null;
}

export async function syncUsersFromConfigFile(filePath = path.resolve(process.cwd(), "users.json")) {
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
      await dbQuery(
        `INSERT INTO users (username, display_name, password_hash, password_salt, is_active, updated_at)
         VALUES ($1, $2, $3, $4, TRUE, NOW())
         ON CONFLICT (username) DO UPDATE
           SET display_name = EXCLUDED.display_name,
               password_hash = EXCLUDED.password_hash,
               password_salt = EXCLUDED.password_salt,
               is_active = TRUE,
               updated_at = NOW()`,
        [user.username, user.displayName, user.passwordHash, user.passwordSalt]
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
