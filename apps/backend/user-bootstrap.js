import fs from "fs/promises";
import path from "path";
import { dbQuery } from "../../shared/db/index.js";
import { getGlobalPasswordSalt, hashPasswordWithGlobalSalt } from "../../shared/src/auth.js";

const DEFAULT_USERNAME = "default";
const DEFAULT_DISPLAY_NAME = "Default User";
const DEFAULT_PASSWORD = "default";
const DEFAULT_ROLE = "users";
const DEFAULT_ADMIN_USERNAME = "defaultadm";
const DEFAULT_ADMIN_DISPLAY_NAME = "Default Admin";
const DEFAULT_ADMIN_PASSWORD = "defaultadm";
const ADMIN_ROLE = "admin";
const USERS_CONFIG_PATH = String(process.env.AUTH_USERS_FILE || "").trim();
const INITIAL_USER_PASSWORD = String(process.env.AUTH_INITIAL_PASSWORD || "Passw0rd!");

function normalizeRole(input) {
  return String(input || "").trim().toLowerCase() === ADMIN_ROLE ? ADMIN_ROLE : DEFAULT_ROLE;
}

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
      if (!username || !displayName) {
        return null;
      }
      if (username === DEFAULT_USERNAME || username === DEFAULT_ADMIN_USERNAME) {
        return null;
      }
      return {
        username,
        displayName,
        role: normalizeRole(entry?.role),
      };
    })
    .filter(Boolean);
}

async function ensureDefaultUsers() {
  const globalSalt = getGlobalPasswordSalt();
  const defaults = [
    {
      username: DEFAULT_USERNAME,
      displayName: DEFAULT_DISPLAY_NAME,
      password: DEFAULT_PASSWORD,
      role: DEFAULT_ROLE,
    },
    {
      username: DEFAULT_ADMIN_USERNAME,
      displayName: DEFAULT_ADMIN_DISPLAY_NAME,
      password: DEFAULT_ADMIN_PASSWORD,
      role: ADMIN_ROLE,
    },
  ];
  const ensuredUserIds = [];
  for (const entry of defaults) {
    const hashedPassword = hashPasswordWithGlobalSalt(entry.password);
    const result = await dbQuery(
    `INSERT INTO users (username, display_name, password_hash, password_salt, role, is_active, require_changepw, updated_at)
     VALUES ($1, $2, $3, $4, $5, TRUE, FALSE, NOW())
     ON CONFLICT (username) DO UPDATE
       SET display_name = EXCLUDED.display_name,
           password_hash = EXCLUDED.password_hash,
           password_salt = EXCLUDED.password_salt,
           role = EXCLUDED.role,
           is_active = TRUE,
           require_changepw = FALSE,
           updated_at = NOW()
     RETURNING id`,
      [entry.username, entry.displayName, hashedPassword, globalSalt, entry.role]
    );
    const userId = result.rows[0]?.id;
    if (userId) {
      ensuredUserIds.push(userId);
    }
  }
  return ensuredUserIds;
}

function resolveUsersConfigPath() {
  if (USERS_CONFIG_PATH) {
    return path.resolve(USERS_CONFIG_PATH);
  }
  return path.resolve(process.cwd(), "users.json");
}

export async function syncUsersFromConfigFile(filePath = resolveUsersConfigPath()) {
  const defaultUserIds = await ensureDefaultUsers();

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
      const passwordHash = hashPasswordWithGlobalSalt(INITIAL_USER_PASSWORD);
      const globalSalt = getGlobalPasswordSalt();
      await dbQuery(
        `INSERT INTO users (username, display_name, password_hash, password_salt, role, is_active, require_changepw, updated_at)
         VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, NOW())
         ON CONFLICT (username) DO UPDATE
           SET display_name = EXCLUDED.display_name,
               role = EXCLUDED.role,
               is_active = TRUE,
               updated_at = NOW()`,
        [user.username, user.displayName, passwordHash, globalSalt, user.role]
      );
    }

    const configuredUsernames = configuredUsers.map((entry) => entry.username);
    const protectedUsernames = [DEFAULT_USERNAME, DEFAULT_ADMIN_USERNAME];
    if (configuredUsernames.length > 0) {
      await dbQuery(
        `UPDATE users
         SET is_active = FALSE,
             updated_at = NOW()
         WHERE username <> ALL($1::text[])
           AND username <> ALL($2::text[])
           AND is_active = TRUE`,
        [protectedUsernames, configuredUsernames]
      );
    } else {
      await dbQuery(
        `UPDATE users
         SET is_active = FALSE,
             updated_at = NOW()
         WHERE username <> ALL($1::text[])
           AND is_active = TRUE`,
        [protectedUsernames]
      );
    }

    await dbQuery(
      `UPDATE users
       SET is_active = TRUE,
           updated_at = NOW()
       WHERE id = ANY($1::bigint[])`,
      [defaultUserIds]
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
