export function createBackendRequestHandler({
  json,
  handleLogin,
  handleChangePassword,
  handleSession,
  handleLogout,
  handleAdminUsersList,
  handleAdminUserCreate,
  handleAdminUserUpdate,
  handleAdminUserDelete,
  handleStatus,
  handleLibraryList,
  handleLibraryUpload,
  handleLibraryDelete,
  handleLibraryToggle,
  handleChatInputTranscription,
  getDbHealth,
  isAdminSession,
  requireValidatedSession,
  proxyRetriever,
  retrieverBaseUrl,
  embedderBaseUrl,
}) {
  async function requireAdminSession(req, res, url) {
    const session = await requireValidatedSession(req, res, url);
    if (!session) return null;
    if (!isAdminSession(session)) {
      json(res, 403, { ok: false, error: "Admin access required." });
      return null;
    }
    return session;
  }

  async function proxyRetrieverWithSession(req, res, url, session, { fromPath, toPath, includeSearch = true }) {
    const suffix = includeSearch ? `${url.pathname}${url.search}` : url.pathname;
    await proxyRetriever({
      req,
      res,
      targetPath: suffix.replace(fromPath, toPath),
      sessionId: session.sessionId,
    });
  }

  async function handleAdminRoutes(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/admin/users") {
      const session = await requireAdminSession(req, res, url);
      if (!session) return true;
      await handleAdminUsersList(res);
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/admin/users") {
      const session = await requireAdminSession(req, res, url);
      if (!session) return true;
      await handleAdminUserCreate(req, res);
      return true;
    }

    if ((req.method === "PATCH" || req.method === "DELETE") && url.pathname.startsWith("/api/admin/users/")) {
      const session = await requireAdminSession(req, res, url);
      if (!session) return true;
      const username = decodeURIComponent(url.pathname.slice("/api/admin/users/".length)).trim();
      if (!username) {
        json(res, 400, { ok: false, error: "Username is required." });
        return true;
      }
      if (req.method === "PATCH") {
        await handleAdminUserUpdate(req, res, username, session);
        return true;
      }
      await handleAdminUserDelete(res, username, session);
      return true;
    }

    return false;
  }

  async function handleAuthedRoutes(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/status") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return true;
      await handleStatus(req, res, session.sessionId);
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/files") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return true;
      await proxyRetrieverWithSession(req, res, url, session, {
        fromPath: "/api/files",
        toPath: "/internal/retriever/files",
      });
      return true;
    }

    if (req.method === "PATCH" && url.pathname === "/api/files/tags") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return true;
      await proxyRetriever({ req, res, targetPath: "/internal/retriever/files/tags", sessionId: session.sessionId });
      return true;
    }

    if ((req.method === "GET" || req.method === "PATCH") && url.pathname === "/api/files/tag-filters") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return true;
      await proxyRetrieverWithSession(req, res, url, session, {
        fromPath: "/api/files/tag-filters",
        toPath: "/internal/retriever/files/tag-filters",
      });
      return true;
    }

    if (url.pathname === "/api/library/files") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return true;
      if (req.method === "GET") {
        await handleLibraryList(res, session);
        return true;
      }
      if (req.method === "POST") {
        await handleLibraryUpload(req, res, session);
        return true;
      }
      if (req.method === "DELETE") {
        await handleLibraryDelete(url, res, session);
        return true;
      }
      if (req.method === "PATCH") {
        await handleLibraryToggle(req, res, session);
        return true;
      }
    }

    if (req.method === "GET" && url.pathname === "/api/messages") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return true;
      await proxyRetrieverWithSession(req, res, url, session, {
        fromPath: "/api/messages",
        toPath: "/internal/retriever/messages",
      });
      return true;
    }

    if ((req.method === "GET" || req.method === "PATCH") && url.pathname === "/api/personalization") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return true;
      await proxyRetrieverWithSession(req, res, url, session, {
        fromPath: "/api/personalization",
        toPath: "/internal/retriever/personalization",
      });
      return true;
    }

    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/chats") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return true;
      await proxyRetrieverWithSession(req, res, url, session, {
        fromPath: "/api/chats",
        toPath: "/internal/retriever/chats",
      });
      return true;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/chats/") && url.pathname.endsWith("/download")) {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return true;
      await proxyRetrieverWithSession(req, res, url, session, {
        fromPath: "/api/chats/",
        toPath: "/internal/retriever/chats/",
      });
      return true;
    }

    if ((req.method === "PATCH" || req.method === "DELETE") && url.pathname.startsWith("/api/chats/")) {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return true;
      await proxyRetrieverWithSession(req, res, url, session, {
        fromPath: "/api/chats/",
        toPath: "/internal/retriever/chats/",
      });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/prompt") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return true;
      await proxyRetriever({ req, res, targetPath: "/internal/retriever/prompt", sessionId: session.sessionId });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/transcription/chat-input") {
      const session = await requireValidatedSession(req, res, url);
      if (!session) return true;
      await handleChatInputTranscription(req, res, session);
      return true;
    }

    return false;
  }

  return async function handleRequest(req, res) {
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

    if (await handleAdminRoutes(req, res, url)) {
      return;
    }

    if (req.method === "GET" && url.pathname === "/healthz") {
      const db = await getDbHealth();
      json(res, db.ok ? 200 : 503, {
        ok: db.ok,
        service: "backend-api",
        retrieverBaseUrl,
        embedderBaseUrl,
        postgres: db,
      });
      return;
    }

    if (await handleAuthedRoutes(req, res, url)) {
      return;
    }

    json(res, 404, { error: "Not found" });
  };
}
