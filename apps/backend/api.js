import { dbQuery, ensureDatabaseReady, pingDatabase } from "../../shared/db/index.js";
import http from "http";
import crypto from "crypto";
import {
  deleteManagedLibraryFile,
  listManagedLibraryFiles,
  saveManagedLibraryFile,
  toggleManagedLibraryFile,
} from "./library-service.js";
import { syncUsersFromConfigFile } from "./user-bootstrap.js";
import { getGlobalPasswordSalt, hashPasswordWithGlobalSalt, hashPasswordWithSalt } from "../../shared/src/auth.js";

const MAX_LIBRARY_UPLOAD_FILES_PER_REQUEST = 5;
const SESSION_INITIAL_TTL_MS = 2 * 60 * 60 * 1000;
const SESSION_REFRESH_THRESHOLD_MS = SESSION_INITIAL_TTL_MS / 2;
const SESSION_MAX_LIFETIME_MS = 24 * 60 * 60 * 1000;

const PORT = parseInt(process.env.BACKEND_API_PORT || "3100", 10);
const HOST = process.env.BACKEND_API_HOST || "0.0.0.0";
const RETRIEVER_BASE_URL = process.env.RETRIEVER_BASE_URL || "http://retriever:3000";
const EMBEDDER_BASE_URL = process.env.EMBEDDER_BASE_URL || "http://embedder:3200";
const MAX_API_BODY_BYTES = Number.parseInt(process.env.MAX_API_BODY_BYTES || String(25 * 1024 * 1024), 10);

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Session-Token",
  });
  res.end(JSON.stringify(payload));
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(`${getGlobalPasswordSalt()}:${String(token || "")}`).digest("hex");
}

function buildSessionWindow(now = new Date()) {
  const createdAt = new Date(now);
  const maxExpiresAt = new Date(createdAt.getTime() + SESSION_MAX_LIFETIME_MS);
  const expiresAt = new Date(Math.min(createdAt.getTime() + SESSION_INITIAL_TTL_MS, maxExpiresAt.getTime()));
  return { createdAt, expiresAt, maxExpiresAt };
}

async function createOrReplaceSession({ userId, sessionId }) {
  const now = new Date();
  const { createdAt, expiresAt, maxExpiresAt } = buildSessionWindow(now);
  const sessionToken = crypto.randomUUID();
  const sessionTokenHash = hashSessionToken(sessionToken);

  await dbQuery(
    `INSERT INTO sessions (user_id, session_identifier, session_token_hash, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_identifier) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           session_token_hash = EXCLUDED.session_token_hash,
           created_at = EXCLUDED.created_at,
           expires_at = EXCLUDED.expires_at`,
    [userId, sessionId, sessionTokenHash, createdAt.toISOString(), expiresAt.toISOString()]
  );

  return {
    sessionId,
    sessionToken,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    maxExpiresAt: maxExpiresAt.toISOString(),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let sizeBytes = 0;

    req.on("data", (chunk) => {
      sizeBytes += chunk.length;
      if (sizeBytes > MAX_API_BODY_BYTES) {
        reject(new Error("Payload too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function isJsonContentType(contentType) {
  return String(contentType || "").toLowerCase().includes("application/json");
}

async function proxyRetriever({ req, res, targetPath, sessionId }) {
  const method = req.method || "GET";
  const targetUrl = new URL(`${RETRIEVER_BASE_URL}${targetPath}`);
  if (sessionId) {
    targetUrl.searchParams.set("sessionId", sessionId);
  }
  const contentType = String(req.headers["content-type"] || "application/json");
  let body = undefined;
  if (["POST", "PATCH", "DELETE"].includes(method)) {
    const rawBody = await readBody(req);
    if (sessionId && rawBody && isJsonContentType(contentType)) {
      try {
        const parsed = JSON.parse(rawBody);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          body = JSON.stringify({
            ...parsed,
            sessionId,
          });
        } else {
          body = rawBody;
        }
      } catch {
        body = rawBody;
      }
    } else if (sessionId && !rawBody && isJsonContentType(contentType)) {
      body = JSON.stringify({ sessionId });
    } else {
      body = rawBody;
    }
  }

  const upstreamResponse = await fetch(targetUrl, {
    method,
    headers: {
      "content-type": contentType,
    },
    body,
  });

  const text = await upstreamResponse.text();
  const upstreamContentType = upstreamResponse.headers.get("content-type") || "application/json";

  res.writeHead(upstreamResponse.status, {
    "Content-Type": upstreamContentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Session-Token",
  });
  res.end(text);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getSessionIdFromRequest(url, body = null) {
  const fromQuery = String(url.searchParams.get("sessionId") || "").trim();
  if (fromQuery) return fromQuery;
  const fromBody = String(body?.sessionId || "").trim();
  return fromBody;
}

async function validateAndRefreshSession({ req, url, body = null, refresh = true }) {
  const requestedSessionId = getSessionIdFromRequest(url, body);
  const sessionToken = String(req.headers["x-session-token"] || "").trim();
  if (!sessionToken) {
    return { ok: false, statusCode: 401, error: "Missing session token." };
  }
  const expectedTokenHash = hashSessionToken(sessionToken);

  const result = requestedSessionId
    ? await dbQuery(
      `SELECT s.user_id, s.session_identifier, s.session_token_hash, s.created_at, s.expires_at, u.username, u.display_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.session_identifier = $1
       LIMIT 1`,
      [requestedSessionId]
    )
    : await dbQuery(
      `SELECT s.user_id, s.session_identifier, s.session_token_hash, s.created_at, s.expires_at, u.username, u.display_name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.session_token_hash = $1
       LIMIT 1`,
      [expectedTokenHash]
    );
  const session = result.rows[0];
  if (!session || !session.session_token_hash) {
    return { ok: false, statusCode: 401, error: "Session not found." };
  }
  const resolvedSessionId = String(session.session_identifier || "").trim();

  if (expectedTokenHash !== session.session_token_hash) {
    return { ok: false, statusCode: 401, error: "Session token is invalid." };
  }

  const nowMs = Date.now();
  const createdMs = new Date(session.created_at).getTime();
  const expiresMs = session.expires_at ? new Date(session.expires_at).getTime() : 0;
  const maxExpiresMs = createdMs + SESSION_MAX_LIFETIME_MS;

  if (nowMs >= maxExpiresMs) {
    await dbQuery("DELETE FROM sessions WHERE session_identifier = $1", [resolvedSessionId]);
    return { ok: false, statusCode: 401, error: "Session reached its maximum lifetime. Please log in again." };
  }

  if (!expiresMs || nowMs >= expiresMs) {
    await dbQuery("DELETE FROM sessions WHERE session_identifier = $1", [resolvedSessionId]);
    return { ok: false, statusCode: 401, error: "Session expired. Please log in again." };
  }

  let nextExpiresAt = new Date(expiresMs).toISOString();
  if (refresh && (expiresMs - nowMs) <= SESSION_REFRESH_THRESHOLD_MS) {
    const refreshedMs = Math.min(nowMs + SESSION_INITIAL_TTL_MS, maxExpiresMs);
    if (refreshedMs > expiresMs) {
      nextExpiresAt = new Date(refreshedMs).toISOString();
      await dbQuery(
        `UPDATE sessions
         SET expires_at = $2
         WHERE session_identifier = $1`,
        [resolvedSessionId, nextExpiresAt]
      );
    }
  }

  return {
    ok: true,
    session: {
      userId: Number(session.user_id),
      sessionId: resolvedSessionId,
      username: session.username,
      displayName: session.display_name,
      createdAt: new Date(createdMs).toISOString(),
      expiresAt: nextExpiresAt,
      maxExpiresAt: new Date(maxExpiresMs).toISOString(),
    },
  };
}

async function handleStatus(req, res, sessionId) {
  const retrieverStatusUrl = `${RETRIEVER_BASE_URL}/internal/retriever/status?sessionId=${encodeURIComponent(sessionId)}`;
  const retrieverStatusPromise = fetchJson(retrieverStatusUrl);
  const embedderStatusPromise = fetchJson(`${EMBEDDER_BASE_URL}/internal/embedder/status`).catch(() => null);

  const [retrieverStatus, embedderStatus] = await Promise.all([retrieverStatusPromise, embedderStatusPromise]);
  const responsePayload = {
    ...(retrieverStatus || {}),
    orchestration: {
      entrypoint: "backend-api",
      version: "v1",
    },
    services: {
      backend: {
        role: "backend-api",
        baseUrl: `http://${HOST}:${PORT}`,
      },
      retriever: {
        role: retrieverStatus?.app?.role || "retriever-api",
        baseUrl: RETRIEVER_BASE_URL,
      },
      embedder: {
        role: embedderStatus?.service || "embedder",
        baseUrl: EMBEDDER_BASE_URL,
        status: embedderStatus,
      },
    },
  };

  if (embedderStatus?.embeddingStatus) {
    responsePayload.embedding = {
      ...(responsePayload.embedding || {}),
      workerStatus: embedderStatus.embeddingStatus,
    };
  }

  json(res, 200, responsePayload);
}

async function getDbHealth() {
  try {
    await pingDatabase();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function handleLibraryUpload(req, res, session) {
  const rawBody = await readBody(req);
  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    json(res, 400, { ok: false, error: "Invalid JSON payload" });
    return;
  }

  try {
    const rawFiles = Array.isArray(body.files)
      ? body.files
      : (body.name || body.contentBase64)
        ? [{
          name: body.name,
          contentBase64: body.contentBase64,
          overwrite: body.overwrite,
          tags: body.tags,
        }]
        : [];

    if (rawFiles.length === 0) {
      json(res, 400, { ok: false, error: "No files provided." });
      return;
    }

    if (rawFiles.length > MAX_LIBRARY_UPLOAD_FILES_PER_REQUEST) {
      json(res, 400, {
        ok: false,
        error: `Please upload up to ${MAX_LIBRARY_UPLOAD_FILES_PER_REQUEST} files per request.`,
      });
      return;
    }

    const uploadResults = await Promise.all(rawFiles.map(async (entry) => {
      try {
        const file = await saveManagedLibraryFile({
          fileName: entry?.name,
          contentBase64: entry?.contentBase64,
          overwrite: Boolean(entry?.overwrite),
          tags: entry?.tags,
          uploadedByUserId: session.userId,
        });
        return { ok: true, fileName: entry?.name, file };
      } catch (error) {
        return { ok: false, fileName: entry?.name, error: error.message };
      }
    }));

    const statusCode = uploadResults.every((result) => result.ok)
      ? 201
      : uploadResults.some((result) => result.ok)
        ? 207
        : 400;

    json(res, statusCode, {
      ok: uploadResults.every((result) => result.ok),
      files: uploadResults,
    });
  } catch (error) {
    if (error.message === "Payload too large") {
      json(res, 413, { ok: false, error: error.message });
      return;
    }
    const statusCode = error.message === "File already exists." ? 409 : 400;
    json(res, statusCode, { ok: false, error: error.message });
  }
}

async function handleLibraryDelete(url, res) {
  const filePath = String(url.searchParams.get("path") || "");
  if (!filePath) {
    json(res, 400, { ok: false, error: "Missing 'path' query parameter." });
    return;
  }

  const result = await deleteManagedLibraryFile(filePath);
  if (!result.deleted) {
    json(res, 404, { ok: false, error: "Managed file not found." });
    return;
  }

  json(res, 200, { ok: true, path: result.path });
}

async function handleLibraryToggle(req, res, session) {
  const rawBody = await readBody(req);
  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    json(res, 400, { ok: false, error: "Invalid JSON payload" });
    return;
  }

  const filePath = String(body.path || "");
  const action = String(body.action || "").toLowerCase();
  if (!filePath) {
    json(res, 400, { ok: false, error: "Missing 'path' in request body." });
    return;
  }
  if (!["disable", "activate"].includes(action)) {
    json(res, 400, { ok: false, error: "Action must be either 'disable' or 'activate'." });
    return;
  }

  const result = await toggleManagedLibraryFile(filePath, action === "activate", { userId: session.userId });
  if (!result.updated) {
    json(res, 404, { ok: false, error: "Managed file not found for this user." });
    return;
  }
  json(res, 200, { ok: true, file: result });
}

async function handleLibraryList(res, session) {
  const files = await listManagedLibraryFiles({ userId: session.userId });
  json(res, 200, {
    ok: true,
    files,
    total: files.length,
    ready: files.filter((file) => file.uploadStatus === "ready").length,
    embedding: files.filter((file) => file.uploadStatus === "embedding").length,
    error: files.filter((file) => file.uploadStatus === "error").length,
  });
}

async function handleLogin(req, res, url) {
  const rawBody = await readBody(req);
  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    json(res, 400, { ok: false, error: "Invalid JSON payload" });
    return;
  }

  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");
  const sessionId = getSessionIdFromRequest(url, body);
  if (!username || !password) {
    json(res, 400, { ok: false, error: "Username and password are required." });
    return;
  }
  if (!sessionId) {
    json(res, 400, { ok: false, error: "Session id is required." });
    return;
  }

  const userResult = await dbQuery(
    `SELECT id, username, display_name, password_hash, password_salt, is_active, require_changepw
     FROM users
     WHERE username = $1
     LIMIT 1`,
    [username]
  );
  const user = userResult.rows[0];
  if (!user) {
    json(res, 404, { ok: false, error: "User does not exist." });
    return;
  }
  if (!user.is_active) {
    json(res, 403, { ok: false, error: "User account is inactive." });
    return;
  }

  const enteredPasswordHash = hashPasswordWithSalt(password, user.password_salt);
  if (enteredPasswordHash !== user.password_hash) {
    json(res, 401, { ok: false, error: "Invalid password." });
    return;
  }

  if (user.require_changepw) {
    json(res, 200, {
      ok: true,
      requirePasswordChange: true,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
      },
    });
    return;
  }

  const session = await createOrReplaceSession({ userId: user.id, sessionId });
  json(res, 200, {
    ok: true,
    requirePasswordChange: false,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
    },
    session,
  });
}

async function handleChangePassword(req, res, url) {
  const rawBody = await readBody(req);
  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    json(res, 400, { ok: false, error: "Invalid JSON payload" });
    return;
  }

  const username = String(body?.username || "").trim();
  const oldPassword = String(body?.oldPassword || "");
  const newPassword = String(body?.newPassword || "");
  const confirmNewPassword = String(body?.confirmNewPassword || "");
  const sessionId = getSessionIdFromRequest(url, body);
  if (!username || !oldPassword || !newPassword || !confirmNewPassword) {
    json(res, 400, { ok: false, error: "All fields are required." });
    return;
  }
  if (!sessionId) {
    json(res, 400, { ok: false, error: "Session id is required." });
    return;
  }
  if (newPassword !== confirmNewPassword) {
    json(res, 400, { ok: false, error: "New password and confirmation do not match." });
    return;
  }

  const userResult = await dbQuery(
    `SELECT id, username, display_name, password_hash, password_salt, is_active
     FROM users
     WHERE username = $1
     LIMIT 1`,
    [username]
  );
  const user = userResult.rows[0];
  if (!user) {
    json(res, 404, { ok: false, error: "User does not exist." });
    return;
  }
  if (!user.is_active) {
    json(res, 403, { ok: false, error: "User account is inactive." });
    return;
  }

  const enteredOldPasswordHash = hashPasswordWithSalt(oldPassword, user.password_salt);
  if (enteredOldPasswordHash !== user.password_hash) {
    json(res, 401, { ok: false, error: "Old password is invalid." });
    return;
  }

  const newPasswordHash = hashPasswordWithGlobalSalt(newPassword);
  const globalSalt = getGlobalPasswordSalt();
  await dbQuery(
    `UPDATE users
     SET password_hash = $1,
         password_salt = $2,
         require_changepw = FALSE,
         updated_at = NOW()
     WHERE id = $3`,
    [newPasswordHash, globalSalt, user.id]
  );

  const session = await createOrReplaceSession({ userId: user.id, sessionId });
  json(res, 200, {
    ok: true,
    requirePasswordChange: false,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
    },
    session,
  });
}

async function handleSession(req, res, url) {
  const validation = await validateAndRefreshSession({ req, url, refresh: true });
  if (!validation.ok) {
    json(res, validation.statusCode || 401, { ok: false, error: validation.error });
    return;
  }

  json(res, 200, {
    ok: true,
    user: {
      username: validation.session.username,
      displayName: validation.session.displayName,
    },
    session: {
      sessionId: validation.session.sessionId,
      createdAt: validation.session.createdAt,
      expiresAt: validation.session.expiresAt,
      maxExpiresAt: validation.session.maxExpiresAt,
    },
  });
}

async function handleLogout(req, res, url) {
  const rawBody = await readBody(req);
  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    json(res, 400, { ok: false, error: "Invalid JSON payload" });
    return;
  }

  const validation = await validateAndRefreshSession({ req, url, body, refresh: false });
  if (!validation.ok) {
    json(res, validation.statusCode || 401, { ok: false, error: validation.error });
    return;
  }

  await dbQuery("DELETE FROM sessions WHERE session_identifier = $1", [validation.session.sessionId]);
  json(res, 200, { ok: true, loggedOut: true });
}

async function requireValidatedSession(req, res, url, { body = null, refresh = true } = {}) {
  const validatedSession = await validateAndRefreshSession({ req, url, body, refresh });
  if (!validatedSession.ok) {
    json(res, validatedSession.statusCode || 401, { ok: false, error: validatedSession.error });
    return null;
  }
  return validatedSession.session;
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      json(res, 400, { error: "Missing request URL" });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      await handleLogin(req, res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/change-password") {
      await handleChangePassword(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/auth/session") {
      await handleSession(req, res, url);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      await handleLogout(req, res, url);
      return;
    }

    if (req.method === "GET" && url.pathname === "/healthz") {
      const db = await getDbHealth();
      json(res, db.ok ? 200 : 503, {
        ok: db.ok,
        service: "backend-api",
        retrieverBaseUrl: RETRIEVER_BASE_URL,
        embedderBaseUrl: EMBEDDER_BASE_URL,
        postgres: db,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return;
      await handleStatus(req, res, session.sessionId);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/files") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return;
      await proxyRetriever({
        req,
        res,
        targetPath: `${url.pathname}${url.search}`.replace("/api/files", "/internal/retriever/files"),
        sessionId: session.sessionId,
      });
      return;
    }

    if (req.method === "PATCH" && url.pathname === "/api/files/tags") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return;
      await proxyRetriever({ req, res, targetPath: "/internal/retriever/files/tags", sessionId: session.sessionId });
      return;
    }


    if ((req.method === "GET" || req.method === "PATCH") && url.pathname === "/api/files/tag-filters") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return;
      await proxyRetriever({
        req,
        res,
        targetPath: `${url.pathname}${url.search}`.replace("/api/files/tag-filters", "/internal/retriever/files/tag-filters"),
        sessionId: session.sessionId,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/library/files") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return;
      await handleLibraryList(res, session);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/library/files") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return;
      await handleLibraryUpload(req, res, session);
      return;
    }

    if (req.method === "DELETE" && url.pathname === "/api/library/files") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return;
      await handleLibraryDelete(url, res);
      return;
    }

    if (req.method === "PATCH" && url.pathname === "/api/library/files") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return;
      await handleLibraryToggle(req, res, session);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/messages") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return;
      await proxyRetriever({
        req,
        res,
        targetPath: `${url.pathname}${url.search}`.replace("/api/messages", "/internal/retriever/messages"),
        sessionId: session.sessionId,
      });
      return;
    }

    if ((req.method === "GET" || req.method === "PATCH") && url.pathname === "/api/personalization") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return;
      await proxyRetriever({
        req,
        res,
        targetPath: `${url.pathname}${url.search}`.replace("/api/personalization", "/internal/retriever/personalization"),
        sessionId: session.sessionId,
      });
      return;
    }

    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/chats") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return;
      await proxyRetriever({
        req,
        res,
        targetPath: `${url.pathname}${url.search}`.replace("/api/chats", "/internal/retriever/chats"),
        sessionId: session.sessionId,
      });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/chats/") && url.pathname.endsWith("/download")) {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return;
      await proxyRetriever({
        req,
        res,
        targetPath: `${url.pathname}${url.search}`.replace("/api/chats/", "/internal/retriever/chats/"),
        sessionId: session.sessionId,
      });
      return;
    }

    if ((req.method === "PATCH" || req.method === "DELETE") && url.pathname.startsWith("/api/chats/")) {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return;
      await proxyRetriever({
        req,
        res,
        targetPath: `${url.pathname}${url.search}`.replace("/api/chats/", "/internal/retriever/chats/"),
        sessionId: session.sessionId,
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/prompt") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return;
      await proxyRetriever({ req, res, targetPath: "/internal/retriever/prompt", sessionId: session.sessionId });
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (error) {
    if (error.message === "Payload too large") {
      json(res, 413, {
        error: error.message,
      });
      return;
    }

    json(res, 502, {
      error: "Upstream request failed",
      details: error.message,
    });
  }
});

await ensureDatabaseReady();
const syncedUsers = await syncUsersFromConfigFile();
console.log(`[backend] synced users from ${syncedUsers.filePath} (configured: ${syncedUsers.configured})`);

server.listen(PORT, HOST, () => {
  console.log(`Backend API listening on http://${HOST}:${PORT}`);
  console.log("Endpoints: POST /api/auth/login, POST /api/auth/change-password, GET /api/auth/session, POST /api/auth/logout, GET /api/status, GET /api/files, PATCH /api/files/tags, GET|PATCH /api/files/tag-filters, GET|POST /api/chats, PATCH|DELETE /api/chats/:chatId, GET /api/chats/:chatId/download, GET /api/messages, GET|PATCH /api/personalization, GET|POST|PATCH|DELETE /api/library/files, POST /api/prompt");
});
