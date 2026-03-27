export function getRouteMatches(pathname) {
  return {
    isStatusRoute: ["/api/status", "/internal/retriever/status"].includes(pathname),
    isFilesRoute: ["/api/files", "/internal/retriever/files"].includes(pathname),
    isFileTagsRoute: ["/api/files/tags", "/internal/retriever/files/tags"].includes(pathname),
    isTagFiltersRoute: ["/api/files/tag-filters", "/internal/retriever/files/tag-filters"].includes(pathname),
    isMessagesRoute: ["/api/messages", "/internal/retriever/messages"].includes(pathname),
    isPromptRoute: ["/api/prompt", "/internal/retriever/prompt"].includes(pathname),
    isGeneralPreferencesRoute: ["/api/preferences/general", "/internal/retriever/preferences/general"].includes(pathname),
    isChatsRoute: ["/api/chats", "/internal/retriever/chats"].includes(pathname),
    isPersonalizationRoute: ["/api/personalization", "/internal/retriever/personalization"].includes(pathname),
    chatRouteMatch: pathname.match(/^\/(?:api|internal\/retriever)\/chats\/([^/]+)$/),
    chatDownloadRouteMatch: pathname.match(/^\/(?:api|internal\/retriever)\/chats\/([^/]+)\/download$/),
  };
}

export function createRetrieverRequestHandler({
  json,
  handleStatus,
  handleFiles,
  handleTagFilters,
  handleFileTags,
  handleMessages,
  handleListChats,
  handleCreateChat,
  handlePersonalization,
  handlePatchChat,
  handleDownloadChat,
  handleDeleteChat,
  handlePrompt,
  handleGeneralPreferences,
}) {
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

    const {
      isStatusRoute,
      isFilesRoute,
      isFileTagsRoute,
      isTagFiltersRoute,
      isMessagesRoute,
      isPromptRoute,
      isGeneralPreferencesRoute,
      isChatsRoute,
      isPersonalizationRoute,
      chatRouteMatch,
      chatDownloadRouteMatch,
    } = getRouteMatches(url.pathname);

    if (req.method === "GET" && isStatusRoute) {
      await handleStatus(req, res);
      return;
    }

    if (req.method === "GET" && isFilesRoute) {
      await handleFiles(req, res, url);
      return;
    }

    if (isTagFiltersRoute && (req.method === "GET" || req.method === "PATCH")) {
      await handleTagFilters(req, res, url);
      return;
    }

    if (req.method === "PATCH" && isFileTagsRoute) {
      await handleFileTags(req, res);
      return;
    }

    if (req.method === "GET" && isMessagesRoute) {
      await handleMessages(req, res);
      return;
    }

    if (req.method === "GET" && isChatsRoute) {
      await handleListChats(req, res);
      return;
    }

    if (req.method === "POST" && isChatsRoute) {
      await handleCreateChat(req, res);
      return;
    }

    if ((req.method === "GET" || req.method === "PATCH") && isPersonalizationRoute) {
      await handlePersonalization(req, res);
      return;
    }

    if ((req.method === "GET" || req.method === "PATCH") && isGeneralPreferencesRoute) {
      await handleGeneralPreferences(req, res);
      return;
    }

    if (req.method === "PATCH" && chatRouteMatch) {
      await handlePatchChat(req, res, decodeURIComponent(chatRouteMatch[1]));
      return;
    }

    if (req.method === "GET" && chatDownloadRouteMatch) {
      await handleDownloadChat(req, res, decodeURIComponent(chatDownloadRouteMatch[1]));
      return;
    }

    if (req.method === "DELETE" && chatRouteMatch) {
      await handleDeleteChat(req, res, decodeURIComponent(chatRouteMatch[1]));
      return;
    }

    if (req.method === "POST" && isPromptRoute) {
      await handlePrompt(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/healthz") {
      json(res, 200, { ok: true });
      return;
    }

    json(res, 404, { error: "Not found" });
  };
}
