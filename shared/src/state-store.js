import { getDefaultPersonalizationSettings, normalizePersonalizationSettings } from "./personalization.js";
import { dbQuery } from "../db/index.js";
import { DEFAULT_FILE_TAG } from "../config/index.js";
import { getGlobalPasswordSalt, hashPasswordWithGlobalSalt } from "./auth.js";

function normalizeFileTags(tags) {
  const input = Array.isArray(tags) ? tags : [];
  const normalized = input
    .map((tag) => String(tag || "").trim().toLowerCase())
    .filter(Boolean)
    .filter((tag) => /^[a-z0-9][a-z0-9_\-:.]{0,63}$/.test(tag));
  return [...new Set(normalized)];
}


function normalizeSessionTagFilterState(input) {
  const disabledTags = Array.isArray(input?.disabledTags)
    ? input.disabledTags
    : [];
  return {
    disabledTags: normalizeFileTags(disabledTags),
  };
}

function normalizeChatTagFilterState(input) {
  return normalizeSessionTagFilterState(input);
}
async function replaceFileTags(filePath, tags) {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath) {
    return null;
  }

  const normalizedTags = normalizeFileTags(tags);
  const nextTags = normalizedTags.length > 0 ? normalizedTags : [DEFAULT_FILE_TAG];

  await dbQuery("DELETE FROM file_tags WHERE file_path = $1", [normalizedPath]);
  for (const tag of nextTags) {
    await dbQuery(
      `INSERT INTO file_tags (file_path, tag, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (file_path, tag) DO UPDATE SET updated_at = NOW()`,
      [normalizedPath, tag]
    );
  }

  return {
    filePath: normalizedPath,
    tags: nextTags,
  };
}

export async function initializeStateDefaults({ uiMode, assistantMode }) {
  const userId = await resolveUserIdForSession(null);
  const defaults = [
    ["ui_mode", { value: uiMode }],
    ["assistant_mode", { value: assistantMode }],
  ];

  for (const [key, value] of defaults) {
    await dbQuery(
      `INSERT INTO app_settings (user_id, setting_key, setting_value)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (user_id, setting_key) DO NOTHING`,
      [userId, key, JSON.stringify(value)]
    );
  }
}

export async function initializeRuntimeConfigDefaults({ historyMessages, maxSimilarities, minSimilarities, cosineLimit }) {
  const userId = await resolveUserIdForSession(null);
  const defaults = [
    ["history_messages", { value: historyMessages }],
    ["max_similarities", { value: maxSimilarities }],
    ["min_similarities", { value: minSimilarities }],
    ["cosine_limit", { value: cosineLimit }],
  ];

  for (const [key, value] of defaults) {
    await dbQuery(
      `INSERT INTO app_settings (user_id, setting_key, setting_value)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (user_id, setting_key) DO NOTHING`,
      [userId, key, JSON.stringify(value)]
    );
  }
}

export async function getSelectionState(fallbacks) {
  const userId = await resolveUserIdForSession(null);
  const result = await dbQuery(
    "SELECT setting_key, setting_value FROM app_settings WHERE user_id = $1 AND setting_key = ANY($2)",
    [userId, ["ui_mode", "assistant_mode"]]
  );

  const map = new Map(result.rows.map((row) => [row.setting_key, row.setting_value?.value]));
  return {
    uiMode: map.get("ui_mode") || fallbacks.uiMode,
    assistantMode: map.get("assistant_mode") || fallbacks.assistantMode,
  };
}

function buildSessionSettingKey(sessionId, settingName) {
  if (!sessionId) {
    return String(settingName || "").trim();
  }
  return String(settingName || "").trim();
}

async function getDefaultUserId() {
  const globalSalt = getGlobalPasswordSalt();
  const defaultHash = hashPasswordWithGlobalSalt("default");
  const ensured = await dbQuery(
    `INSERT INTO users (username, display_name, password_hash, password_salt, role, is_active, require_changepw)
     VALUES ('default', 'Default User', $1, $2, 'users', TRUE, FALSE)
     ON CONFLICT (username) DO UPDATE
       SET username = EXCLUDED.username,
           password_hash = EXCLUDED.password_hash,
           password_salt = EXCLUDED.password_salt,
           role = EXCLUDED.role,
           is_active = TRUE,
           require_changepw = FALSE
     RETURNING id`
    ,
    [defaultHash, globalSalt]
  );
  return ensured.rows[0]?.id;
}

async function resolveUserIdForSession(sessionId) {
  const normalizedSessionId = String(sessionId || "").trim();
  const defaultUserId = await getDefaultUserId();
  if (!normalizedSessionId) {
    return defaultUserId;
  }

  const existing = await dbQuery(
    "SELECT user_id FROM sessions WHERE session_identifier = $1",
    [normalizedSessionId]
  );
  const existingUserId = existing.rows[0]?.user_id;
  if (existingUserId) {
    return existingUserId;
  }

  const inserted = await dbQuery(
    `INSERT INTO sessions (user_id, session_identifier, created_at, expires_at)
     VALUES ($1, $2, NOW(), NULL)
     ON CONFLICT (session_identifier) DO UPDATE
       SET user_id = EXCLUDED.user_id
     RETURNING user_id`,
    [defaultUserId, normalizedSessionId]
  );
  return inserted.rows[0]?.user_id || defaultUserId;
}

export async function getUserIdForSession(sessionId) {
  return resolveUserIdForSession(sessionId);
}

export async function updateSetting(key, value, { sessionId = null } = {}) {
  const userId = await resolveUserIdForSession(sessionId);
  await dbQuery(
    `INSERT INTO app_settings (user_id, setting_key, setting_value, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (user_id, setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           updated_at = NOW()`,
    [userId, key, JSON.stringify({ value })]
  );
}

export async function getUserSetting({ userId, settingName, fallbackValue }) {
  const normalizedUserId = Number.parseInt(String(userId || ""), 10);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return fallbackValue;
  }
  const settingKey = buildSessionSettingKey(null, settingName);
  const result = await dbQuery(
    "SELECT setting_value FROM app_settings WHERE user_id = $1 AND setting_key = $2",
    [normalizedUserId, settingKey]
  );
  const value = result.rows[0]?.setting_value?.value;
  return value ?? fallbackValue;
}

export async function updateUserSetting({ userId, settingName, value }) {
  const normalizedUserId = Number.parseInt(String(userId || ""), 10);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    throw new Error("Invalid user id");
  }
  const settingKey = buildSessionSettingKey(null, settingName);
  await dbQuery(
    `INSERT INTO app_settings (user_id, setting_key, setting_value, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (user_id, setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           updated_at = NOW()`,
    [normalizedUserId, settingKey, JSON.stringify({ value })]
  );
}

export async function getSessionSetting({ sessionId, settingName, fallbackValue }) {
  const userId = await resolveUserIdForSession(sessionId);
  return getUserSetting({ userId, settingName, fallbackValue });
}

export async function updateSessionSetting({ sessionId, settingName, value }) {
  const userId = await resolveUserIdForSession(sessionId);
  await updateUserSetting({ userId, settingName, value });
}

export async function getSessionPersonalizationSettings(sessionId) {
  const rawSettings = await getSessionSetting({
    sessionId,
    settingName: "personalization_settings",
    fallbackValue: getDefaultPersonalizationSettings(),
  });
  return normalizePersonalizationSettings(rawSettings);
}

export async function updateSessionPersonalizationSettings(sessionId, nextSettings) {
  const mergedSettings = normalizePersonalizationSettings({
    ...(await getSessionPersonalizationSettings(sessionId)),
    ...(nextSettings && typeof nextSettings === "object" ? nextSettings : {}),
  });
  await updateSessionSetting({
    sessionId,
    settingName: "personalization_settings",
    value: mergedSettings,
  });
  return mergedSettings;
}

export async function getSessionTagFilterState(sessionId) {
  const rawState = await getSessionSetting({
    sessionId,
    settingName: "tag_filter_state",
    fallbackValue: { disabledTags: [] },
  });
  return normalizeSessionTagFilterState(rawState);
}

export async function updateSessionTagFilterState(sessionId, nextState) {
  const normalized = normalizeSessionTagFilterState(nextState);
  await updateSessionSetting({
    sessionId,
    settingName: "tag_filter_state",
    value: normalized,
  });
  return normalized;
}

export async function getRuntimeConfigState(fallbacks) {
  const userId = await resolveUserIdForSession(null);
  const result = await dbQuery(
    "SELECT setting_key, setting_value FROM app_settings WHERE user_id = $1 AND setting_key = ANY($2)",
    [userId, ["history_messages", "max_similarities", "min_similarities", "cosine_limit"]]
  );

  const map = new Map(result.rows.map((row) => [row.setting_key, row.setting_value?.value]));
  return {
    historyMessages: Number.parseInt(String(map.get("history_messages") ?? fallbacks.historyMessages), 10),
    maxSimilarities: Number.parseInt(String(map.get("max_similarities") ?? fallbacks.maxSimilarities), 10),
    minSimilarities: Number.parseInt(String(map.get("min_similarities") ?? fallbacks.minSimilarities), 10),
    cosineLimit: Number.parseFloat(String(map.get("cosine_limit") ?? fallbacks.cosineLimit)),
  };
}

export async function ensureSessionExists(sessionId) {
  const userId = await resolveUserIdForSession(sessionId);
  await dbQuery(
    `INSERT INTO chat_sessions (id, user_id, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (id) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           updated_at = NOW()`,
    [sessionId, userId]
  );
}

export async function ensureChatContext({ sessionId, chatId, chatName = null }) {
  await ensureSessionExists(sessionId);
  const userId = await resolveUserIdForSession(sessionId);

  await dbQuery(
    `INSERT INTO chats (id, session_id, user_id, name, status, archived_at, updated_at)
     VALUES ($1, $2, $3, COALESCE($4, CONCAT('chat-', SUBSTRING(MD5(random()::text), 1, 6))), 'active', NULL, NOW())
     ON CONFLICT (id) DO NOTHING`,
    [chatId, sessionId, userId, chatName]
  );

  const result = await dbQuery(
    `SELECT id, user_id, name, status
     FROM chats
     WHERE id = $1`,
    [chatId]
  );
  const row = result.rows[0];
  if (!row || row.user_id !== userId) {
    return null;
  }

  await dbQuery(
    `UPDATE chat_sessions
     SET active_chat_id = COALESCE(active_chat_id, $2),
         updated_at = NOW()
     WHERE id = $1`,
    [sessionId, chatId]
  );

  return {
    id: row.id,
    name: row.name,
    status: row.status,
  };
}

export async function createChat({ sessionId, chatId, chatName }) {
  await ensureSessionExists(sessionId);
  const userId = await resolveUserIdForSession(sessionId);
  await dbQuery(
    `INSERT INTO chats (id, session_id, user_id, name, status, archived_at, updated_at)
     VALUES ($1, $2, $3, COALESCE(NULLIF(BTRIM($4), ''), CONCAT('chat-', SUBSTRING(MD5(random()::text), 1, 6))), 'active', NULL, NOW())`,
    [chatId, sessionId, userId, chatName || null]
  );

  await dbQuery(
    `UPDATE chat_sessions
     SET active_chat_id = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [sessionId, chatId]
  );

  const result = await dbQuery(
    `SELECT id, session_id, user_id, name, status, created_at, updated_at, archived_at, tag_filter_state
     FROM chats
     WHERE id = $1`,
    [chatId]
  );
  return result.rows[0] || null;
}

export async function listSessionChats({ sessionId, includeArchived = false }) {
  await ensureSessionExists(sessionId);
  const userId = await resolveUserIdForSession(sessionId);
  const sessionResult = await dbQuery(
    "SELECT active_chat_id FROM chat_sessions WHERE id = $1 AND user_id = $2",
    [sessionId, userId]
  );
  const activeChatId = sessionResult.rows[0]?.active_chat_id || null;

  const chatResult = await dbQuery(
    `SELECT id, name, status, created_at, updated_at, archived_at, tag_filter_state
     FROM chats
     WHERE user_id = $1
       AND ($2::boolean OR status = 'active')
     ORDER BY updated_at DESC, created_at DESC`,
    [userId, includeArchived]
  );

  return {
    activeChatId,
    chats: chatResult.rows,
  };
}

export async function setSessionActiveChat({ sessionId, chatId }) {
  const userId = await resolveUserIdForSession(sessionId);
  const chat = await dbQuery(
    `SELECT id, name, status
     FROM chats
     WHERE user_id = $1 AND id = $2`,
    [userId, chatId]
  );
  const selectedChat = chat.rows[0];
  if (!selectedChat) {
    return null;
  }
  if (selectedChat.status !== "active") {
    return { ...selectedChat, notSwitchable: true };
  }

  await dbQuery(
    `UPDATE chat_sessions
     SET active_chat_id = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [sessionId, chatId]
  );
  return selectedChat;
}

export async function updateChatStatus({ sessionId, chatId, status }) {
  const userId = await resolveUserIdForSession(sessionId);
  const result = await dbQuery(
    `UPDATE chats
     SET status = $1,
         archived_at = CASE WHEN $1 = 'archived' THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE user_id = $2 AND id = $3
     RETURNING id, name, status, created_at, updated_at, archived_at, tag_filter_state`,
    [status, userId, chatId]
  );
  const chat = result.rows[0];
  if (!chat) {
    return null;
  }

  if (status === "archived") {
    const sessionRow = await dbQuery(
      "SELECT active_chat_id FROM chat_sessions WHERE id = $1 AND user_id = $2",
      [sessionId, userId]
    );
    if (sessionRow.rows[0]?.active_chat_id === chatId) {
      const fallbackResult = await dbQuery(
        `SELECT id
         FROM chats
         WHERE user_id = $1 AND status = 'active'
         ORDER BY updated_at DESC
         LIMIT 1`,
        [userId]
      );
      const fallbackChatId = fallbackResult.rows[0]?.id || null;
      await dbQuery(
        `UPDATE chat_sessions
         SET active_chat_id = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [sessionId, fallbackChatId]
      );
    }
  }

  return chat;
}

export async function updateChatName({ sessionId, chatId, name }) {
  const userId = await resolveUserIdForSession(sessionId);
  const nextName = String(name || "").trim();
  if (!nextName) {
    return null;
  }

  const result = await dbQuery(
    `UPDATE chats
     SET name = $1,
         updated_at = NOW()
     WHERE user_id = $2 AND id = $3
     RETURNING id, name, status, created_at, updated_at, archived_at, tag_filter_state`,
    [nextName, userId, chatId]
  );
  return result.rows[0] || null;
}

export async function getChatTagFilterState({ sessionId, chatId }) {
  const userId = await resolveUserIdForSession(sessionId);
  const result = await dbQuery(
    `SELECT tag_filter_state
     FROM chats
     WHERE user_id = $1 AND id = $2`,
    [userId, chatId]
  );
  const rawState = result.rows[0]?.tag_filter_state || { disabledTags: [] };
  return normalizeChatTagFilterState(rawState);
}

export async function updateChatTagFilterState({ sessionId, chatId, nextState }) {
  const userId = await resolveUserIdForSession(sessionId);
  const normalized = normalizeChatTagFilterState(nextState);
  const result = await dbQuery(
    `UPDATE chats
     SET tag_filter_state = $1::jsonb,
         updated_at = NOW()
     WHERE user_id = $2 AND id = $3
     RETURNING id, name, status, created_at, updated_at, archived_at, tag_filter_state`,
    [JSON.stringify(normalized), userId, chatId]
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  return {
    ...row,
    tag_filter_state: normalizeChatTagFilterState(row.tag_filter_state),
  };
}

export async function deleteChat({ sessionId, chatId }) {
  const userId = await resolveUserIdForSession(sessionId);
  const activeBeforeDelete = await dbQuery(
    "SELECT active_chat_id FROM chat_sessions WHERE id = $1 AND user_id = $2",
    [sessionId, userId]
  );
  const existing = await dbQuery(
    `SELECT id
     FROM chats
     WHERE user_id = $1 AND id = $2`,
    [userId, chatId]
  );
  if (!existing.rows[0]) {
    return false;
  }

  await dbQuery("DELETE FROM chats WHERE user_id = $1 AND id = $2", [userId, chatId]);

  if (activeBeforeDelete.rows[0]?.active_chat_id === chatId) {
    const fallbackResult = await dbQuery(
      `SELECT id
       FROM chats
       WHERE user_id = $1 AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId]
    );
    const fallbackChatId = fallbackResult.rows[0]?.id || null;
    await dbQuery(
      `UPDATE chat_sessions
       SET active_chat_id = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [sessionId, fallbackChatId]
    );
  }

  return true;
}

export async function resolveSessionChatId({ sessionId, requestedChatId = null, fallbackChatId = "default-chat" }) {
  await ensureSessionExists(sessionId);
  const userId = await resolveUserIdForSession(sessionId);

  const sessionResult = await dbQuery(
    "SELECT active_chat_id FROM chat_sessions WHERE id = $1 AND user_id = $2",
    [sessionId, userId]
  );
  const sessionActiveChatId = sessionResult.rows[0]?.active_chat_id || null;
  const normalizedFallbackChatId = String(fallbackChatId || "").trim() || "default-chat";
  const userScopedFallbackChatId = normalizedFallbackChatId === "default-chat"
    ? `default-chat-u${userId}`
    : normalizedFallbackChatId;

  const candidateChatIds = [];
  if (requestedChatId) {
    candidateChatIds.push(requestedChatId);
  }
  if (sessionActiveChatId && !candidateChatIds.includes(sessionActiveChatId)) {
    candidateChatIds.push(sessionActiveChatId);
  }
  if (!candidateChatIds.includes(userScopedFallbackChatId)) {
    candidateChatIds.push(userScopedFallbackChatId);
  }

  let resolvedChatId = null;
  let resolvedChat = null;
  for (const candidateChatId of candidateChatIds) {
    const ensured = await ensureChatContext({ sessionId, chatId: candidateChatId });
    if (!ensured || ensured.status !== "active") {
      continue;
    }
    resolvedChatId = candidateChatId;
    resolvedChat = ensured;
    break;
  }

  if (!resolvedChat || !resolvedChatId) {
    return null;
  }

  await dbQuery(
    `UPDATE chat_sessions
     SET active_chat_id = $2,
         updated_at = NOW()
     WHERE id = $1`,
    [sessionId, resolvedChatId]
  );

  return {
    chatId: resolvedChatId,
    chatName: resolvedChat.name,
  };
}

export async function addChatMessage({ sessionId, chatId, role, content, metadata = {} }) {
  const userId = await resolveUserIdForSession(sessionId);
  await dbQuery(
    `INSERT INTO chat_messages (session_id, chat_id, user_id, role, content, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [sessionId, chatId, userId, role, content, JSON.stringify(metadata || {})]
  );

  await dbQuery("UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1", [sessionId]);
  await dbQuery("UPDATE chats SET updated_at = NOW() WHERE id = $1", [chatId]);
}

export async function listChatMessages({ sessionId, chatId, limit = null }) {
  const userId = await resolveUserIdForSession(sessionId);
  const hasLimit = Number.isInteger(limit) && limit > 0;
  const result = hasLimit
    ? await dbQuery(
      `SELECT role, content, metadata, created_at
       FROM (
         SELECT id, role, content, metadata, created_at
         FROM chat_messages
         WHERE chat_id = $1 AND user_id = $2
         ORDER BY created_at DESC, id DESC
         LIMIT $3
       ) recent
       ORDER BY created_at ASC, id ASC`,
      [chatId, userId, limit]
    )
    : await dbQuery(
      `SELECT role, content, metadata, created_at
       FROM chat_messages
       WHERE chat_id = $1 AND user_id = $2
       ORDER BY created_at ASC, id ASC`,
      [chatId, userId]
    );

  return result.rows;
}

export async function listRecentPromptHistory({ sessionId, chatId, limit }) {
  const userId = await resolveUserIdForSession(sessionId);
  const safeLimit = Math.max(0, Number.parseInt(String(limit || 0), 10));
  if (safeLimit === 0) {
    return [];
  }

  const result = await dbQuery(
    `SELECT role, content
     FROM (
       SELECT id, role, content
       FROM chat_messages
       WHERE chat_id = $1 AND user_id = $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3
     ) recent
     ORDER BY id ASC`,
    [chatId, userId, safeLimit]
  );

  return result.rows.map((row) => [row.role === "assistant" ? "ai" : "human", row.content]);
}

export async function getIndexStateMap() {
  const result = await dbQuery("SELECT file_path, file_hash FROM file_metadata WHERE embedded = TRUE");
  return Object.fromEntries(result.rows.map((row) => [row.file_path, row.file_hash]));
}

export async function upsertFileMetadata(files, indexState, chunkCounts = {}) {
  for (const file of files) {
    await dbQuery(
      `INSERT INTO file_metadata (
         file_path, extension, size_bytes, last_modified, file_hash, chunk_count, detected_language, embedded, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (file_path) DO UPDATE SET
         extension = EXCLUDED.extension,
         size_bytes = EXCLUDED.size_bytes,
         last_modified = EXCLUDED.last_modified,
         file_hash = EXCLUDED.file_hash,
         chunk_count = COALESCE(EXCLUDED.chunk_count, file_metadata.chunk_count),
         detected_language = COALESCE(EXCLUDED.detected_language, file_metadata.detected_language),
         embedded = EXCLUDED.embedded,
         updated_at = NOW()`,
      [
        file.relativePath,
        file.extension,
        file.size,
        file.lastModified ? new Date(file.lastModified).toISOString() : null,
        file.hash,
        chunkCounts[file.relativePath] ?? null,
        file.detectedLanguage || null,
        indexState[file.relativePath] === file.hash,
      ]
    );
  }

  await ensureDefaultFileTags(files.map((file) => file.relativePath));
}

export async function removeDeletedMetadata(paths) {
  if (!paths.length) return;
  await dbQuery("DELETE FROM file_tags WHERE file_path = ANY($1)", [paths]);
  await dbQuery("DELETE FROM file_metadata WHERE file_path = ANY($1)", [paths]);
}

export async function listFileMetadata() {
  const result = await dbQuery(
    `SELECT
       m.file_path,
       m.extension,
       m.size_bytes,
       m.last_modified,
       m.file_hash,
       m.chunk_count,
       m.detected_language,
       m.embedded,
       COALESCE(
         ARRAY_AGG(t.tag ORDER BY t.tag) FILTER (WHERE t.tag IS NOT NULL),
         ARRAY[$1::text]
       ) AS tags
     FROM file_metadata m
     LEFT JOIN file_tags t ON t.file_path = m.file_path
     GROUP BY m.file_path, m.extension, m.size_bytes, m.last_modified, m.file_hash, m.chunk_count, m.detected_language, m.embedded
     ORDER BY file_path ASC`
    ,
    [DEFAULT_FILE_TAG]
  );
  return result.rows;
}

export async function listTagsForFilePathMap(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return new Map();
  }

  const result = await dbQuery(
    `SELECT file_path, ARRAY_AGG(tag ORDER BY tag) AS tags
     FROM file_tags
     WHERE file_path = ANY($1)
     GROUP BY file_path`,
    [filePaths]
  );

  const tagMap = new Map();
  for (const row of result.rows) {
    const normalized = normalizeFileTags(row.tags);
    tagMap.set(row.file_path, normalized.length > 0 ? normalized : [DEFAULT_FILE_TAG]);
  }

  for (const filePath of filePaths) {
    if (!tagMap.has(filePath)) {
      tagMap.set(filePath, [DEFAULT_FILE_TAG]);
    }
  }

  return tagMap;
}

export async function updateFileTags(filePath, tags) {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath) {
    return null;
  }

  const existing = await dbQuery(
    "SELECT 1 FROM file_metadata WHERE file_path = $1",
    [normalizedPath]
  );
  if (!existing.rowCount) {
    return null;
  }

  return replaceFileTags(normalizedPath, tags);
}

export async function setFileTagsForPath(filePath, tags) {
  return replaceFileTags(filePath, tags);
}

export async function ensureDefaultFileTags(filePaths) {
  const normalizedPaths = [...new Set(
    (Array.isArray(filePaths) ? filePaths : [])
      .map((filePath) => String(filePath || "").trim())
      .filter(Boolean)
  )];
  if (normalizedPaths.length === 0) {
    return;
  }

  await dbQuery(
    `INSERT INTO file_tags (file_path, tag, updated_at)
     SELECT m.file_path, $2, NOW()
     FROM file_metadata m
     WHERE m.file_path = ANY($1)
       AND NOT EXISTS (
         SELECT 1 FROM file_tags t WHERE t.file_path = m.file_path
       )`,
    [normalizedPaths, DEFAULT_FILE_TAG]
  );
}

export async function upsertManagedLibraryFile({
  filePath,
  originalName,
  source = "webui",
  sizeBytes,
  status = "uploaded",
  uploadedByUserId = null,
}) {
  await dbQuery(
    `INSERT INTO library_managed_files (
       file_path, original_name, source, upload_status, size_bytes, uploaded_by_user_id, uploaded_at, embedded_at, last_error, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NULL, NULL, NOW())
     ON CONFLICT (file_path) DO UPDATE SET
       original_name = EXCLUDED.original_name,
       source = EXCLUDED.source,
       upload_status = EXCLUDED.upload_status,
       size_bytes = EXCLUDED.size_bytes,
       uploaded_by_user_id = EXCLUDED.uploaded_by_user_id,
       uploaded_at = NOW(),
       embedded_at = NULL,
       last_error = NULL,
       updated_at = NOW()`,
    [filePath, originalName, source, status, sizeBytes, uploadedByUserId]
  );
}

export async function markManagedLibraryFilesStatus(filePaths, status, { jobId = null, error = null } = {}) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return;
  }

  await dbQuery(
    `UPDATE library_managed_files
     SET upload_status = $2,
         embedded_at = CASE WHEN $2 = 'ready' THEN NOW() ELSE embedded_at END,
         last_error = CASE WHEN $3::text IS NULL THEN last_error ELSE $3::text END,
         last_job_id = COALESCE($4::bigint, last_job_id),
         updated_at = NOW()
     WHERE file_path = ANY($1)`,
    [filePaths, status, error, jobId]
  );
}

export async function clearManagedLibraryFileErrors(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return;
  }

  await dbQuery(
    `UPDATE library_managed_files
     SET last_error = NULL,
         updated_at = NOW()
     WHERE file_path = ANY($1)`,
    [filePaths]
  );
}

export async function markManagedLibraryFileDeleted(filePath) {
  await dbQuery(
    `UPDATE library_managed_files
     SET upload_status = 'deleted',
         updated_at = NOW()
     WHERE file_path = $1`,
    [filePath]
  );
}

export async function setManagedLibraryFileStatus(filePath, status) {
  const result = await dbQuery(
    `UPDATE library_managed_files
     SET upload_status = $2,
         updated_at = NOW()
     WHERE file_path = $1
     RETURNING file_path, upload_status`,
    [filePath, status]
  );
  return result.rows[0] || null;
}

export async function getManagedLibraryFile(filePath) {
  const result = await dbQuery(
    `SELECT file_path, original_name, source, upload_status, size_bytes, uploaded_by_user_id, uploaded_at, embedded_at, last_error, last_job_id, updated_at
     FROM library_managed_files
     WHERE file_path = $1`,
    [filePath]
  );
  return result.rows[0] || null;
}

export async function hardDeleteManagedLibraryFile(filePath) {
  const normalizedPath = String(filePath || "").trim();
  if (!normalizedPath) {
    return false;
  }

  await dbQuery("DELETE FROM file_tags WHERE file_path = $1", [normalizedPath]);
  await dbQuery("DELETE FROM file_metadata WHERE file_path = $1", [normalizedPath]);
  const result = await dbQuery(
    `DELETE FROM library_managed_files
     WHERE file_path = $1`,
    [normalizedPath]
  );
  return result.rowCount > 0;
}

export async function listManagedLibraryFilesWithStatus() {
  const result = await dbQuery(
    `SELECT
       m.file_path,
       m.original_name,
       m.source,
       m.upload_status,
       m.size_bytes,
       m.uploaded_by_user_id,
       m.uploaded_at,
       m.embedded_at,
       m.last_error,
       m.last_job_id,
       m.updated_at,
       f.extension,
       f.last_modified,
       f.file_hash,
       f.chunk_count,
       f.detected_language,
       f.embedded
     FROM library_managed_files m
     LEFT JOIN file_metadata f ON f.file_path = m.file_path
     WHERE m.upload_status <> 'deleted'
     ORDER BY m.updated_at DESC, m.file_path ASC`
  );
  return result.rows;
}

export async function setManagedLibraryFileEnabledForUser({ userId, filePath, enabled }) {
  const normalizedUserId = Number.parseInt(String(userId || ""), 10);
  const normalizedPath = String(filePath || "").trim();
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0 || !normalizedPath) {
    return null;
  }

  const result = await dbQuery(
    `INSERT INTO user_library_file_preferences (user_id, file_path, enabled, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, file_path) DO UPDATE
       SET enabled = EXCLUDED.enabled,
           updated_at = NOW()
     RETURNING user_id, file_path, enabled, updated_at`,
    [normalizedUserId, normalizedPath, enabled !== false]
  );
  return result.rows[0] || null;
}

export async function listManagedLibraryFilesWithUserPreferences(userId) {
  const normalizedUserId = Number.parseInt(String(userId || ""), 10);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return listManagedLibraryFilesWithStatus();
  }

  const result = await dbQuery(
    `SELECT
       m.file_path,
       m.original_name,
       m.source,
       m.upload_status,
       m.size_bytes,
       m.uploaded_by_user_id,
       m.uploaded_at,
       m.embedded_at,
       m.last_error,
       m.last_job_id,
       m.updated_at,
       f.extension,
       f.last_modified,
       f.file_hash,
       f.chunk_count,
       f.detected_language,
       f.embedded,
       COALESCE(p.enabled, TRUE) AS enabled
     FROM library_managed_files m
     LEFT JOIN file_metadata f ON f.file_path = m.file_path
     LEFT JOIN user_library_file_preferences p
       ON p.file_path = m.file_path
      AND p.user_id = $1
     WHERE m.upload_status <> 'deleted'
     ORDER BY m.updated_at DESC, m.file_path ASC`,
    [normalizedUserId]
  );
  return result.rows;
}

export async function listDisabledManagedLibraryFilePathsForUser(userId, filePaths = null) {
  const normalizedUserId = Number.parseInt(String(userId || ""), 10);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0) {
    return [];
  }

  const normalizedPaths = Array.isArray(filePaths)
    ? [...new Set(filePaths.map((item) => String(item || "").trim()).filter(Boolean))]
    : [];

  const result = normalizedPaths.length > 0
    ? await dbQuery(
      `SELECT file_path
       FROM user_library_file_preferences
       WHERE user_id = $1
         AND enabled = FALSE
         AND file_path = ANY($2)`,
      [normalizedUserId, normalizedPaths]
    )
    : await dbQuery(
      `SELECT file_path
       FROM user_library_file_preferences
       WHERE user_id = $1
         AND enabled = FALSE`,
      [normalizedUserId]
    );

  return result.rows.map((row) => row.file_path).filter(Boolean);
}

export async function markIndexingStarted(startedAt) {
  const job = await dbQuery(
    `INSERT INTO indexing_jobs (status, started_at, updated_at)
     VALUES ('running', $1, NOW()) RETURNING id`,
    [startedAt]
  );
  const jobId = job.rows[0].id;

  await dbQuery(
    `INSERT INTO embedding_status (singleton, status, started_at, last_job_id, updated_at)
     VALUES (TRUE, 'running', $1, $2, NOW())
     ON CONFLICT (singleton) DO UPDATE
       SET status = EXCLUDED.status,
           started_at = EXCLUDED.started_at,
           finished_at = NULL,
           summary = NULL,
           error_message = NULL,
           last_job_id = EXCLUDED.last_job_id,
           updated_at = NOW()`,
    [startedAt, jobId]
  );

  return jobId;
}

export async function recordIndexingJobFile({
  jobId,
  filePath,
  action,
  status,
  chunkCount = null,
  error = null,
}) {
  await dbQuery(
    `INSERT INTO indexing_job_files (
       job_id, file_path, action, status, chunk_count, error_message, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [jobId, filePath, action, status, chunkCount, error]
  );
}

export async function markIndexingFinished({ jobId, status, startedAt, summary, error }) {
  const finishedAt = new Date().toISOString();
  await dbQuery(
    `UPDATE indexing_jobs
     SET status = $2, finished_at = $3, summary = $4::jsonb, error_message = $5, updated_at = NOW()
     WHERE id = $1`,
    [jobId, status, finishedAt, JSON.stringify(summary || null), error || null]
  );

  await dbQuery(
    `INSERT INTO embedding_status (singleton, status, started_at, finished_at, summary, error_message, last_job_id, updated_at)
     VALUES (TRUE, $1, $2, $3, $4::jsonb, $5, $6, NOW())
     ON CONFLICT (singleton) DO UPDATE
       SET status = EXCLUDED.status,
           started_at = EXCLUDED.started_at,
           finished_at = EXCLUDED.finished_at,
           summary = EXCLUDED.summary,
           error_message = EXCLUDED.error_message,
           last_job_id = EXCLUDED.last_job_id,
           updated_at = NOW()`,
    [status, startedAt, finishedAt, JSON.stringify(summary || null), error || null, jobId]
  );
}

export async function getEmbeddingStatus() {
  const result = await dbQuery(
    `SELECT status, started_at, finished_at, summary, error_message, last_job_id, updated_at
     FROM embedding_status WHERE singleton = TRUE`
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    summary: row.summary,
    error: row.error_message,
    lastJobId: row.last_job_id,
    updatedAt: row.updated_at,
  };
}
