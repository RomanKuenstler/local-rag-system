import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";
import { marked } from "https://esm.sh/marked@13";
import DOMPurify from "https://esm.sh/dompurify@3";
import {
  API_BASE_URL,
  PANEL_COMMANDS,
  createMessage,
  formatBytes,
  formatSeverityLabel,
  getOverallHealth,
  getPanelTitle,
  normalizeStatusBadge,
  parseAssistantModeContent,
  parseHelpContent,
  parsePanelText,
  parseProfileContent,
  parseSystemInfoContent,
  resizeComposerInput,
} from "./utils.js";
import { renderPanelContent } from "./panel-content.js";

const UI_MODE_OPTIONS = [
  { id: "clean", description: "Clean chat-focused UI without retrieval diagnostics." },
  { id: "rag", description: "Retrieval-debug UI that includes evidence quality and similarity details." },
];
const PROMPT_ATTACHMENT_RULES = {
  maxFiles: 3,
  allowedExtensions: [".md", ".txt", ".html", ".htm", ".pdf"],
};
const LIBRARY_UPLOAD_RULES = {
  maxFiles: 10,
  allowedExtensions: [".md", ".txt", ".html", ".htm", ".pdf"],
};
const SESSION_ID_STORAGE_KEY = "rag-session-id";
const CHAT_ID_STORAGE_KEY = "rag-chat-id";
const MENU_DIALOG_TABS = [
  { id: "settings", label: "Settings", command: "/config" },
  { id: "personalization", label: "Personalization", command: "/personalization" },
  { id: "info", label: "Info", command: "/info" },
  { id: "help", label: "Help", command: "/help" },
];

function buildChatNameFromId(chatId) {
  const suffix = String(chatId || "").replace(/^chat-/, "").slice(0, 6) || Math.random().toString(36).slice(2, 8);
  return `chat-${suffix}`;
}

function buildInitialChatList(activeChatId) {
  const primaryId = String(activeChatId || "").trim() || `chat-${crypto.randomUUID()}`;
  return [{ id: primaryId, name: buildChatNameFromId(primaryId) }];
}

function getOrCreatePersistentId(storageKey, fallbackPrefix) {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) return stored;
    const created = `${fallbackPrefix}-${crypto.randomUUID()}`;
    window.localStorage.setItem(storageKey, created);
    return created;
  } catch {
    return `${fallbackPrefix}-fallback`;
  }
}

function getScoreSeverity(score) {
  if (!Number.isFinite(score)) return "unknown";
  if (score >= 0.8) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

function getCurrentUiModeFromInfoText(infoText) {
  const parsedGroups = parseSystemInfoContent(infoText || "");
  const appGroup = parsedGroups.find((group) => group.title === "App");
  const uiModeEntry = appGroup?.items?.find((item) => item.key.toLowerCase() === "ui mode");
  return uiModeEntry?.value || "clean";
}

function getMenuTabById(tabId) {
  return MENU_DIALOG_TABS.find((tab) => tab.id === tabId) || MENU_DIALOG_TABS[0];
}

marked.setOptions({
  gfm: true,
  breaks: true,
});

function App() {
  const getInitialView = () => (window.location.hash === "#library" ? "library" : "chat");
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [attachedPromptFiles, setAttachedPromptFiles] = useState([]);
  const [attachmentNotice, setAttachmentNotice] = useState("");
  const [panelData, setPanelData] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [statusData, setStatusData] = useState(null);
  const [filesData, setFilesData] = useState(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [libraryManagedData, setLibraryManagedData] = useState(null);
  const [libraryNotice, setLibraryNotice] = useState("");
  const [pendingLibraryUploads, setPendingLibraryUploads] = useState([]);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState(null);
  const [hasShownReadyGreeting, setHasShownReadyGreeting] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isUnifiedDialogOpen, setIsUnifiedDialogOpen] = useState(false);
  const [activeDialogTab, setActiveDialogTab] = useState("settings");
  const [dialogTabPanels, setDialogTabPanels] = useState({});
  const [isDialogTabLoading, setIsDialogTabLoading] = useState(false);
  const [dialogTabError, setDialogTabError] = useState("");
  const [activeView, setActiveView] = useState(getInitialView);
  const sessionIdRef = useRef(getOrCreatePersistentId(SESSION_ID_STORAGE_KEY, "session"));
  const chatIdRef = useRef(getOrCreatePersistentId(CHAT_ID_STORAGE_KEY, "chat"));
  const [activeChatId, setActiveChatId] = useState(chatIdRef.current);
  const [chatList, setChatList] = useState(() => buildInitialChatList(chatIdRef.current));
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [openChatMenuId, setOpenChatMenuId] = useState(null);
  const [renameDialogChat, setRenameDialogChat] = useState(null);
  const [renameInputValue, setRenameInputValue] = useState("");
  const [deleteConfirmChat, setDeleteConfirmChat] = useState(null);
  const [isChatActionPending, setIsChatActionPending] = useState(false);

  const previousEmbeddingReadyRef = useRef(null);
  const pollTimeoutRef = useRef(null);
  const lastMessageRef = useRef(null);
  const composerInputRef = useRef(null);
  const promptFileInputRef = useRef(null);
  const libraryFileInputRef = useRef(null);
  const menuRef = useRef(null);

  const isEmbeddingReady = statusData?.embedding?.readiness?.ready === true;
  const currentUiMode = String(statusData?.app?.uiMode || "clean").toLowerCase();
  const isRagMode = currentUiMode === "rag";
  const healthState = useMemo(() => getOverallHealth(statusData, filesData), [statusData, filesData]);

  function getMessageBadge(message) {
    if (message.interaction?.type === "weak_confirmation") {
      return { tone: "warning", label: "Warning" };
    }
    if (message.evidenceSeverity === "source_attached" || message.upload?.uploadedCount > 0) {
      return { tone: "source", label: "Source: attached file" };
    }
    if (message.responseType) {
      return { tone: "system", label: "System Message" };
    }
    if (message.evidenceSeverity) {
      return {
        tone: String(message.evidenceSeverity).toLowerCase(),
        label: `evidence: ${formatSeverityLabel(message.evidenceSeverity)}`,
      };
    }
    return null;
  }

  async function refreshStatus() {
    try {
      const [statusRes, filesRes, libraryRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/status`),
        fetch(`${API_BASE_URL}/api/files`),
        fetch(`${API_BASE_URL}/api/library/files`),
      ]);

      if (statusRes.ok) {
        const newStatus = await statusRes.json();
        setStatusData((previous) => {
          const previousReady = previous?.embedding?.readiness?.ready === true;
          const nextReady = newStatus?.embedding?.readiness?.ready === true;

          if (!previousReady && nextReady && !hasShownReadyGreeting) {
            setMessages((prev) => prev.concat(createMessage("assistant", "How can I help you today?", { isVolatile: true })));
            setHasShownReadyGreeting(true);
          }

          previousEmbeddingReadyRef.current = nextReady;
          return newStatus;
        });
      }

      if (filesRes.ok) {
        setFilesData(await filesRes.json());
      }

      if (libraryRes.ok) {
        const payload = await libraryRes.json();
        setLibraryManagedData(payload);
        const knownPaths = new Set(Array.isArray(payload.files) ? payload.files.map((file) => file.path) : []);
        setPendingLibraryUploads((previous) => previous.filter((file) => !knownPaths.has(file.path)));
      }
    } catch {
      setStatusData(null);
      setFilesData(null);
      setLibraryManagedData(null);
    } finally {
      setIsLoadingStatus(false);
    }
  }

  async function loadMessagesFromDb(explicitChatId = null) {
    const sessionId = sessionIdRef.current;
    const chatId = explicitChatId || chatIdRef.current;
    const messageLoadLimit = 40;
    const response = await fetch(
      `${API_BASE_URL}/api/messages?sessionId=${encodeURIComponent(sessionId)}&chatId=${encodeURIComponent(chatId)}&limit=${messageLoadLimit}`
    );
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || "Failed to load messages");
    }

    const normalized = Array.isArray(payload.messages)
      ? payload.messages.map((message) => {
        const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
        return createMessage(message.role, message.content, {
          evidenceSeverity: metadata.evidenceSeverity || null,
          responseType: metadata.responseType || null,
          retrieval: metadata.retrieval || null,
          interaction: metadata.interaction || null,
          upload: metadata.upload || null,
          attachedFiles: Array.isArray(metadata.attachedFiles) ? metadata.attachedFiles : [],
        });
      })
      : [];

    setMessages((previous) => {
      const volatileMessages = previous.filter((message) => message.isVolatile);
      return normalized.concat(volatileMessages);
    });
  }

  async function refreshChats({ preferredChatId = null } = {}) {
    const sessionId = sessionIdRef.current;
    setIsLoadingChats(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/chats?sessionId=${encodeURIComponent(sessionId)}`
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load chats");
      }

      const nextChats = Array.isArray(payload.chats)
        ? payload.chats.map((chat) => ({
          id: chat.id,
          name: chat.name || buildChatNameFromId(chat.id),
          status: chat.status || "active",
        }))
        : [];

      const fallbackChatId = preferredChatId || payload.activeChatId || chatIdRef.current;
      const nextActiveChat = nextChats.find((chat) => chat.id === fallbackChatId)
        ? fallbackChatId
        : (payload.activeChatId || nextChats[0]?.id || chatIdRef.current);

      setChatList(nextChats.length > 0 ? nextChats : buildInitialChatList(nextActiveChat));
      setActiveChatId(nextActiveChat);
      chatIdRef.current = nextActiveChat;
      try {
        window.localStorage.setItem(CHAT_ID_STORAGE_KEY, nextActiveChat);
      } catch {
        // ignore storage write errors
      }
    } finally {
      setIsLoadingChats(false);
    }
  }

  useEffect(() => {
    async function poll() {
      await refreshStatus();
      const delay = previousEmbeddingReadyRef.current ? 8000 : 2000;
      pollTimeoutRef.current = window.setTimeout(poll, delay);
    }

    poll();

    return () => {
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, [hasShownReadyGreeting]);

  useEffect(() => {
    loadMessagesFromDb(activeChatId).catch(() => {
      setMessages([]);
    });
  }, [activeChatId]);

  useEffect(() => {
    refreshChats({ preferredChatId: chatIdRef.current }).catch(() => {
      setChatList(buildInitialChatList(chatIdRef.current));
    });
  }, []);

  useEffect(() => {
    if (lastMessageRef.current) {
      lastMessageRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    if (composerInputRef.current) {
      resizeComposerInput(composerInputRef.current);
    }
  }, []);

  useEffect(() => {
    function syncViewFromHash() {
      setActiveView(window.location.hash === "#library" ? "library" : "chat");
    }

    window.addEventListener("hashchange", syncViewFromHash);
    return () => window.removeEventListener("hashchange", syncViewFromHash);
  }, []);

  useEffect(() => {
    function closeMenuOnOutside(event) {
      if (!menuRef.current?.contains(event.target)) {
        setIsMenuOpen(false);
      }
      if (!event.target.closest(".chat-item-actions")) {
        setOpenChatMenuId(null);
      }
    }

    document.addEventListener("pointerdown", closeMenuOnOutside);
    return () => document.removeEventListener("pointerdown", closeMenuOnOutside);
  }, []);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") {
        setPanelData(null);
        setIsUnifiedDialogOpen(false);
      }
    }

    if (panelData || isUnifiedDialogOpen) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }

    return undefined;
  }, [panelData, isUnifiedDialogOpen]);

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const rawResult = String(reader.result || "");
        const [, base64 = ""] = rawResult.split(",");
        resolve(base64);
      };
      reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  async function buildUploadedFilesPayload(files) {
    const normalizedFiles = Array.isArray(files) ? files : [];
    if (normalizedFiles.length === 0) {
      return [];
    }

    const limitedFiles = normalizedFiles.slice(0, PROMPT_ATTACHMENT_RULES.maxFiles);
    return Promise.all(limitedFiles.map(async (file) => ({
      name: file.name,
      contentBase64: await fileToBase64(file),
    })));
  }

  function getFileExtension(filename) {
    const normalized = String(filename || "");
    const extension = normalized.includes(".")
      ? `.${normalized.split(".").pop()?.toLowerCase() || ""}`
      : "";
    return extension;
  }

  function validatePromptAttachments(files) {
    const selectedFiles = Array.isArray(files) ? files : [];

    if (selectedFiles.length > PROMPT_ATTACHMENT_RULES.maxFiles) {
      return {
        validFiles: [],
        notice: `You can attach up to ${PROMPT_ATTACHMENT_RULES.maxFiles} files per prompt.`,
      };
    }

    const invalidFiles = selectedFiles.filter((file) => {
      const extension = getFileExtension(file.name);
      return !PROMPT_ATTACHMENT_RULES.allowedExtensions.includes(extension);
    });

    if (invalidFiles.length > 0) {
      return {
        validFiles: [],
        notice: `Unsupported file type: ${invalidFiles.map((file) => file.name).join(", ")}`,
      };
    }

    return {
      validFiles: selectedFiles,
      notice: `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} selected.`,
    };
  }

  function validateLibraryUploads(files) {
    const selectedFiles = Array.isArray(files) ? files : [];
    if (selectedFiles.length === 0) {
      return { validFiles: [], notice: "No files selected." };
    }

    if (selectedFiles.length > LIBRARY_UPLOAD_RULES.maxFiles) {
      return {
        validFiles: [],
        notice: `Please upload up to ${LIBRARY_UPLOAD_RULES.maxFiles} files at once.`,
      };
    }

    const invalidFiles = selectedFiles.filter((file) => {
      const extension = getFileExtension(file.name);
      return !LIBRARY_UPLOAD_RULES.allowedExtensions.includes(extension);
    });

    if (invalidFiles.length > 0) {
      return {
        validFiles: [],
        notice: `Unsupported extension: ${invalidFiles.map((file) => file.name).join(", ")}`,
      };
    }

    return {
      validFiles: selectedFiles,
      notice: `${selectedFiles.length} file${selectedFiles.length > 1 ? "s" : ""} queued for upload.`,
    };
  }

  async function uploadLibraryFiles(files) {
    const queued = files.map((file) => ({
      tempId: crypto.randomUUID(),
      path: `_library/${file.name}`,
      originalName: file.name,
      uploadStatus: "uploading",
      embedded: false,
      chunkCount: null,
      sizeBytes: file.size,
      extension: getFileExtension(file.name),
      isVolatile: true,
      lastError: null,
      canDelete: false,
      updatedAt: new Date().toISOString(),
    }));
    setPendingLibraryUploads((previous) => queued.concat(previous));

    const uploadResults = await Promise.all(files.map(async (file) => {
      const contentBase64 = await fileToBase64(file);
      const response = await fetch(`${API_BASE_URL}/api/library/files`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          contentBase64,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      return { ok: response.ok, payload, fileName: file.name };
    }));

    setPendingLibraryUploads((previous) => previous.map((row) => {
      const result = uploadResults.find((item) => item.fileName === row.originalName);
      if (!result) return row;
      if (!result.ok) {
        return {
          ...row,
          uploadStatus: "error",
          lastError: result.payload?.error || "Upload failed",
          canDelete: false,
          updatedAt: new Date().toISOString(),
        };
      }
      return {
        ...row,
        path: result.payload?.file?.path || row.path,
        uploadStatus: "embedding",
        canDelete: true,
        updatedAt: new Date().toISOString(),
      };
    }));

    const failed = uploadResults.filter((result) => !result.ok).length;
    setLibraryNotice(
      failed > 0
        ? `${failed} upload${failed > 1 ? "s" : ""} failed.`
        : `Uploaded ${uploadResults.length} file${uploadResults.length > 1 ? "s" : ""}. Embedding started.`
    );

    await refreshStatus();
  }

  async function handleLibraryFileSelection(event) {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = "";

    const validation = validateLibraryUploads(selectedFiles);
    setLibraryNotice(validation.notice);
    if (validation.validFiles.length === 0) {
      return;
    }

    await uploadLibraryFiles(validation.validFiles);
  }

  async function confirmDeleteLibraryFile() {
    const target = deleteConfirmFile;
    setDeleteConfirmFile(null);
    if (!target?.path) {
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/library/files?path=${encodeURIComponent(target.path)}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Delete failed.");
      }
      setLibraryNotice(`Deleted ${target.path}.`);
      setPendingLibraryUploads((previous) => previous.filter((file) => file.path !== target.path));
      await refreshStatus();
    } catch (error) {
      setLibraryNotice(error.message || "Delete failed.");
    }
  }

  async function toggleLibraryFile(file, action) {
    if (!file?.path || !["disable", "activate"].includes(action)) {
      return;
    }

    const pendingStatus = action === "disable" ? "removing" : "embedding";
    setLibraryNotice(action === "disable" ? `Disabling ${file.path}...` : `Activating ${file.path}...`);
    setLibraryManagedData((previous) => {
      if (!previous?.files) return previous;
      return {
        ...previous,
        files: previous.files.map((entry) => (
          entry.path === file.path
            ? { ...entry, uploadStatus: pendingStatus, embedded: action === "activate" }
            : entry
        )),
      };
    });

    try {
      const response = await fetch(`${API_BASE_URL}/api/library/files`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path, action }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "File status update failed.");
      }
      setLibraryNotice(action === "disable" ? `Disabled ${file.path}.` : `Activated ${file.path}.`);
      await refreshStatus();
    } catch (error) {
      setLibraryNotice(error.message || "File status update failed.");
      await refreshStatus();
    }
  }

  async function sendRawPrompt(rawPrompt, promptFiles = []) {
    const prompt = String(rawPrompt || "").trim();
    const isSlashCommand = prompt.startsWith("/");
    const isPanelCommand = PANEL_COMMANDS.has(prompt.toLowerCase());
    const hasPromptFiles = Array.isArray(promptFiles) && promptFiles.length > 0;
    if (!prompt || isSending) return;

    const selectedPromptFiles = hasPromptFiles ? [...promptFiles] : [];
    if (hasPromptFiles || attachedPromptFiles.length > 0) {
      setAttachedPromptFiles([]);
      setAttachmentNotice("");
    }
    if (!isPanelCommand && !isSlashCommand) {
      setMessages((prev) => prev.concat(createMessage("user", prompt, {
        attachedFiles: selectedPromptFiles.map((file) => file.name),
      })));
    }

    setInputValue("");
    if (composerInputRef.current) {
      composerInputRef.current.style.height = "";
      resizeComposerInput(composerInputRef.current);
    }

    if (!isEmbeddingReady) {
      setMessages((prev) => prev.concat(createMessage(
        "assistant",
        "Embedding is still running. Please wait until indexing is finished before sending prompts.",
        { evidenceSeverity: "warn", isVolatile: true }
      )));
      return;
    }

    setIsSending(true);
    const pendingMessageId = crypto.randomUUID();
    setMessages((prev) => prev.concat(createMessage("assistant", "Assistant is thinking…", {
      id: pendingMessageId,
      isPending: true,
    })));

    try {
      if (isPanelCommand && hasPromptFiles) {
        throw new Error("File attachments are only supported for normal chat prompts, not slash commands.");
      }

      const uploadedFilesPayload = isPanelCommand ? [] : await buildUploadedFilesPayload(selectedPromptFiles);
      const response = await fetch(`${API_BASE_URL}/api/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          sessionId: sessionIdRef.current,
          chatId: chatIdRef.current,
          attachedFiles: selectedPromptFiles.map((file) => file.name),
          uploadedFiles: uploadedFilesPayload,
        }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Request failed");

      if (isPanelCommand) {
        setMessages((prev) => prev.filter((message) => message.id !== pendingMessageId));
        setPanelData({
          id: crypto.randomUUID(),
          command: prompt.toLowerCase(),
          title: payload.responseType || prompt,
          content: parsePanelText(payload.answer || ""),
          severity: payload.evidenceSeverity || null,
          responseType: payload.responseType || null,
          configView: payload.configView || payload.webConfigView || null,
        });
      } else {
        setMessages((prev) => prev.map((message) => {
          if (message.id !== pendingMessageId) return message;
          return {
            ...message,
            text: payload.answer || "No answer generated.",
            evidenceSeverity: payload.evidenceSeverity || null,
            responseType: payload.responseType || null,
            retrieval: payload.retrieval || null,
            interaction: payload.interaction || null,
            upload: payload.upload || null,
            isPending: false,
          };
        }));
      }

    } catch (error) {
      setMessages((prev) => prev.map((message) => {
        if (message.id !== pendingMessageId) return message;
        return {
          ...message,
          text: `Error: ${error.message}`,
          evidenceSeverity: "error",
          responseType: null,
          retrieval: null,
          isPending: false,
          isVolatile: true,
        };
      }));
    } finally {
      setIsSending(false);
      await loadMessagesFromDb().catch(() => {});
      await refreshStatus();
    }
  }

  async function fetchPanelCommand(command) {
    const response = await fetch(`${API_BASE_URL}/api/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: command, sessionId: sessionIdRef.current, chatId: chatIdRef.current }),
    });

    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || `Request failed for ${command}`);
    return payload;
  }

  function buildPanelDataFromCommand(command, payload) {
    if (command === "/config") {
      return {
        id: crypto.randomUUID(),
        command: "/config",
        title: payload.responseType || "/config",
        content: parsePanelText(payload.answer || ""),
        severity: payload.evidenceSeverity || null,
        responseType: payload.responseType || null,
        configView: payload.configView || payload.webConfigView || null,
      };
    }

    if (command === "/info") {
      return {
        id: crypto.randomUUID(),
        command: "/info",
        title: payload.responseType || "/info",
        content: parsePanelText(payload.answer || ""),
        severity: payload.evidenceSeverity || null,
        responseType: payload.responseType || null,
        configView: payload.configView || payload.webConfigView || null,
      };
    }

    if (command === "/help") {
      return {
        id: crypto.randomUUID(),
        command: "/help",
        title: payload.responseType || "/help",
        content: parsePanelText(payload.answer || ""),
        severity: payload.evidenceSeverity || null,
        responseType: payload.responseType || null,
        configView: payload.configView || payload.webConfigView || null,
      };
    }

    return null;
  }

  async function loadUnifiedDialogTab(tabId, { forceReload = false } = {}) {
    const selectedTab = getMenuTabById(tabId);
    const existingPanel = dialogTabPanels[selectedTab.id];
    setActiveDialogTab(selectedTab.id);
    setDialogTabError("");
    if (existingPanel && !forceReload) return;

    if (!isEmbeddingReady) return;
    setIsSending(true);
    setIsDialogTabLoading(true);

    try {
      let nextPanel = null;
      if (selectedTab.command === "/personalization") {
        const [assistantPayload, profilePayload, infoPayload] = await Promise.all([
          fetchPanelCommand("/assistant"),
          fetchPanelCommand("/profile"),
          fetchPanelCommand("/info"),
        ]);
        nextPanel = {
          id: crypto.randomUUID(),
          command: "/personalization",
          title: "Personalization",
          content: {
            ui: {
              currentMode: getCurrentUiModeFromInfoText(infoPayload.answer || ""),
              modes: UI_MODE_OPTIONS,
            },
            assistant: parseAssistantModeContent(assistantPayload.answer || ""),
            profile: parseProfileContent(profilePayload.answer || ""),
          },
          severity: null,
          responseType: null,
          configView: null,
        };
      } else {
        const payload = await fetchPanelCommand(selectedTab.command);
        nextPanel = buildPanelDataFromCommand(selectedTab.command, payload);
      }

      if (nextPanel) {
        setDialogTabPanels((previous) => ({ ...previous, [selectedTab.id]: nextPanel }));
      }
    } catch (error) {
      setDialogTabError(error.message);
    } finally {
      setIsDialogTabLoading(false);
      setIsSending(false);
      await refreshStatus();
    }
  }

  async function openUnifiedDialog(tabId) {
    if (isSending || !isEmbeddingReady) return;
    setIsMenuOpen(false);
    setPanelData(null);
    setIsUnifiedDialogOpen(true);
    await loadUnifiedDialogTab(tabId);
  }

  async function openPersonalizationPanel() {
    await openUnifiedDialog("personalization");
  }

  async function refreshCurrentPanel(activeCommand) {
    if (activeCommand === "/assistant") {
      const assistantPayload = await fetchPanelCommand("/assistant");
      setPanelData({
        id: crypto.randomUUID(),
        command: "/assistant",
        title: assistantPayload.responseType || "/assistant",
        content: parsePanelText(assistantPayload.answer || ""),
        severity: assistantPayload.evidenceSeverity || null,
        responseType: assistantPayload.responseType || null,
        configView: assistantPayload.configView || assistantPayload.webConfigView || null,
      });
      return;
    }

    if (activeCommand === "/profile") {
      const profilePayload = await fetchPanelCommand("/profile");
      setPanelData({
        id: crypto.randomUUID(),
        command: "/profile",
        title: profilePayload.responseType || "/profile",
        content: parsePanelText(profilePayload.answer || ""),
        severity: profilePayload.evidenceSeverity || null,
        responseType: profilePayload.responseType || null,
        configView: profilePayload.configView || profilePayload.webConfigView || null,
      });
      return;
    }

    if (activeCommand === "/personalization") {
      const [assistantPayload, profilePayload, infoPayload] = await Promise.all([
        fetchPanelCommand("/assistant"),
        fetchPanelCommand("/profile"),
        fetchPanelCommand("/info"),
      ]);

      setPanelData({
        id: crypto.randomUUID(),
        command: "/personalization",
        title: "Personalization",
        content: {
          ui: {
            currentMode: getCurrentUiModeFromInfoText(infoPayload.answer || ""),
            modes: UI_MODE_OPTIONS,
          },
          assistant: parseAssistantModeContent(assistantPayload.answer || ""),
          profile: parseProfileContent(profilePayload.answer || ""),
        },
        severity: null,
        responseType: null,
        configView: null,
      });
    }
  }

  async function applyPersonalizationChange(kind, selectedId) {
    if (isSending || !isEmbeddingReady) return;

    const command = kind === "assistant"
      ? `/assistant ${selectedId}`
      : kind === "profile"
        ? `/profile ${selectedId}`
        : `/mode ${selectedId}`;

    setIsSending(true);
    try {
      await fetchPanelCommand(command);
      if (isUnifiedDialogOpen) {
        setDialogTabPanels((previous) => {
          const nextPanels = { ...previous };
          delete nextPanels.personalization;
          delete nextPanels.info;
          return nextPanels;
        });
        await loadUnifiedDialogTab(activeDialogTab, { forceReload: true });
      } else {
        await refreshCurrentPanel(panelData?.command);
      }
    } catch (error) {
      setMessages((prev) => prev.concat(createMessage("assistant", `Error: ${error.message}`, {
        evidenceSeverity: "error",
        isVolatile: true,
      })));
    } finally {
      setIsSending(false);
      await refreshStatus();
    }
  }

  async function sendPrompt(event) {
    event.preventDefault();
    await sendRawPrompt(inputValue, attachedPromptFiles);
  }

  function openPromptFilePicker() {
    if (isSending || !isEmbeddingReady) return;
    promptFileInputRef.current?.click();
  }

  function handlePromptFileSelection(event) {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) {
      return;
    }

    const validation = validatePromptAttachments(selectedFiles);
    setAttachedPromptFiles(validation.validFiles);
    setAttachmentNotice(validation.notice);
    event.target.value = "";
  }

  async function submitConfigChange(configName, rawValue) {
    const value = String(rawValue || "").trim();
    if (!value) return;
    await sendRawPrompt(`/config set '${configName}' ${value}`);
  }

  const icon = (path) => React.createElement(
    "svg",
    { viewBox: "0 0 24 24", className: "icon", "aria-hidden": "true" },
    React.createElement("path", { d: path })
  );
  const chatIconPath = "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-4.5 3V17H6a2 2 0 0 1-2-2zm4 2h8v2H8zm0 4h5v2H8z";
  const libraryIconPath = "M4 6a3 3 0 0 1 3-3h13v16H7a2 2 0 0 0-2 2H4zm2 0v11.2A4 4 0 0 1 7 17h11V5H7a1 1 0 0 0-1 1";
  const plusChatIconPath = "M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1";
  const settingsIconPath = "M19.14 12.94a7.14 7.14 0 0 0 .05-.94 7.14 7.14 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.14 7.14 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.14 7.14 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.14 7.14 0 0 0-.05.94 7.14 7.14 0 0 0 .05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.59-.23 1.13-.55 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5";
  const fileUploadIconPath = "M11 18h2v-8h3l-4-4-4 4h3zm-6 2h14v-2H5z";
  const trashIconPath = "M9 3h6l1.4 2H20a1 1 0 1 1 0 2h-1v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V7H4a1 1 0 1 1 0-2h3.6zM7 7v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7zm3 3a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1m4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1";
  const eyeIconPath = "M12 2v3a7 7 0 0 1 6.5 9.5l1.8 1.8A10 10 0 0 0 14 2.4V1zm0 20v-3a7 7 0 0 1-6.5-9.5l-1.8-1.8A10 10 0 0 0 10 21.6V23zm9.2-12.7A10 10 0 0 1 12 19v3l6-6h-3a7 7 0 0 0 6.2-6.7zM2.8 14.7A10 10 0 0 1 12 5V2L6 8h3a7 7 0 0 0-6.2 6.7z";
  const eyeOffIconPath = "M12 2v3a7 7 0 0 1 6.5 9.5l1.8 1.8A10 10 0 0 0 14 2.4V1zm0 20v-3a7 7 0 0 1-6.5-9.5l-1.8-1.8A10 10 0 0 0 10 21.6V23zm9.2-12.7A10 10 0 0 1 12 19v3l6-6h-3a7 7 0 0 0 6.2-6.7zM2.8 14.7A10 10 0 0 1 12 5V2L6 8h3a7 7 0 0 0-6.2 6.7zM3.7 2.3 2.3 3.7l18 18 1.4-1.4z";
  const keepIconPath = "M9.6 16.6 5.4 12.4l1.4-1.4 2.8 2.8 7.6-7.6 1.4 1.4z";
  const dotsIconPath = "M6 12a1.5 1.5 0 1 0 0 .01V12m6 0a1.5 1.5 0 1 0 0 .01V12m6 0a1.5 1.5 0 1 0 0 .01V12";
  const renameIconPath = "M4 17.2V20h2.8l8.2-8.2-2.8-2.8zm13.7-8.4a1 1 0 0 0 0-1.4l-1.1-1.1a1 1 0 0 0-1.4 0l-1.2 1.2 2.8 2.8z";
  const archiveIconPath = "M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v2A2.5 2.5 0 0 1 18.5 11H18v7.5A2.5 2.5 0 0 1 15.5 21h-7A2.5 2.5 0 0 1 6 18.5V11h-.5A2.5 2.5 0 0 1 3 8.5zm2.5-.5a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5zM8 11v7.5a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V11zm2 2h4v2h-4z";
  const renderAssistantMarkdown = (text) => {
    const rendered = marked.parse(String(text || ""));
    const sanitized = DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } });
    return React.createElement("div", {
      className: "assistant-markdown",
      dangerouslySetInnerHTML: { __html: sanitized },
    });
  };

  const activeUnifiedPanel = dialogTabPanels[activeDialogTab] || null;
  const activeModalPanel = isUnifiedDialogOpen ? activeUnifiedPanel : panelData;
  const panelTitle = isUnifiedDialogOpen ? "Preferences" : getPanelTitle(panelData?.command);

  const parsedAssistantPanel = activeModalPanel?.command === "/assistant"
    ? parseAssistantModeContent(Array.isArray(activeModalPanel.content) ? activeModalPanel.content.join("\n") : String(activeModalPanel.content || ""))
    : null;
  const parsedProfilePanel = activeModalPanel?.command === "/profile"
    ? parseProfileContent(Array.isArray(activeModalPanel.content) ? activeModalPanel.content.join("\n") : String(activeModalPanel.content || ""))
    : null;
  const parsedInfoGroups = activeModalPanel?.command === "/info"
    ? parseSystemInfoContent(Array.isArray(activeModalPanel.content) ? activeModalPanel.content.join("\n") : String(activeModalPanel.content || ""))
    : [];
  const parsedHelpPanel = activeModalPanel?.command === "/help" || activeModalPanel?.command === "?"
    ? parseHelpContent(Array.isArray(activeModalPanel.content) ? activeModalPanel.content.join("\n") : String(activeModalPanel.content || ""))
    : null;
  const configSections = activeModalPanel?.command === "/config" && activeModalPanel.configView
    ? activeModalPanel.configView.sections
    : [];
  const editableConfigRows = configSections.flatMap((section) => section.entries
    .filter((entry) => entry.editable)
    .map((entry) => ({ ...entry, section: section.label })));
  const restartConfigRows = configSections.flatMap((section) => section.entries
    .filter((entry) => !entry.editable)
    .map((entry) => ({ ...entry, section: section.label })));
  const retrieverStatus = normalizeStatusBadge(statusData?.services?.retriever?.role || statusData?.app?.role);
  const embedderStatus = normalizeStatusBadge(statusData?.embedding?.readiness?.status);
  const libraryFiles = Array.isArray(filesData?.files) ? filesData.files : [];
  const managedLibraryFiles = Array.isArray(libraryManagedData?.files) ? libraryManagedData.files : [];
  const managedByPath = new Map(managedLibraryFiles.map((file) => [file.path, file]));
  const retrieverRows = libraryFiles.map((file) => {
    const managed = managedByPath.get(file.path);
    return {
      path: file.path,
      uploadStatus: managed?.uploadStatus || (file.embedded ? "ready" : "discovered"),
      sizeBytes: file.sizeBytes,
      chunkCount: file.chunkCount,
      extension: file.extension,
      embedded: Boolean(file.embedded),
      hash: file.hash,
      updatedAt: managed?.updatedAt || file.lastModified || null,
      canDelete: Boolean(managed),
      lastError: managed?.lastError || null,
    };
  });
  const managedOnlyRows = managedLibraryFiles
    .filter((managed) => !libraryFiles.some((file) => file.path === managed.path))
    .map((managed) => ({
      path: managed.path,
      uploadStatus: managed.uploadStatus || "uploaded",
      sizeBytes: managed.sizeBytes,
      chunkCount: managed.chunkCount,
      extension: managed.extension || getFileExtension(managed.originalName),
      embedded: Boolean(managed.embedded),
      hash: managed.hash,
      updatedAt: managed.updatedAt || managed.uploadedAt || null,
      canDelete: true,
      lastError: managed.lastError || null,
    }));
  const dbRows = retrieverRows.concat(managedOnlyRows).sort((left, right) => {
    const a = Date.parse(String(left.updatedAt || 0));
    const b = Date.parse(String(right.updatedAt || 0));
    return b - a;
  });
  const libraryRows = pendingLibraryUploads.concat(dbRows);
  const libraryTotalChunks = libraryFiles.reduce((sum, file) => sum + (Number(file.chunkCount) || 0), 0);

  function openLibraryPage() {
    setIsMenuOpen(false);
    setPanelData(null);
    window.location.hash = "#library";
  }

  function openChatPage() {
    setIsMenuOpen(false);
    window.location.hash = "";
  }

  async function createNewChat() {
    const sessionId = sessionIdRef.current;
    setIsMenuOpen(false);
    window.location.hash = "";
    try {
      const response = await fetch(`${API_BASE_URL}/api/chats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to create new chat");
      }

      const newChatId = payload?.chat?.id || payload?.activeChatId;
      if (!newChatId) {
        throw new Error("Chat was created but no chat id was returned.");
      }

      setPanelData(null);
      setMessages([]);
      await refreshChats({ preferredChatId: newChatId });
      await loadMessagesFromDb(newChatId).catch(() => {
        setMessages([]);
      });
    } catch (error) {
      setMessages((prev) => prev.concat(createMessage("assistant", `Error: ${error.message}`, {
        evidenceSeverity: "error",
        isVolatile: true,
      })));
    }
  }

  async function switchChat(chatId) {
    const selectedId = String(chatId || "").trim();
    if (!selectedId || selectedId === activeChatId) {
      return;
    }
    const sessionId = sessionIdRef.current;
    setPanelData(null);
    setIsMenuOpen(false);
    window.location.hash = "";
    try {
      const response = await fetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(selectedId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, action: "switch" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to switch chat");
      }

      await refreshChats({ preferredChatId: selectedId });
      await loadMessagesFromDb(selectedId).catch(() => {
        setMessages([]);
      });
    } catch (error) {
      setMessages((prev) => prev.concat(createMessage("assistant", `Error: ${error.message}`, {
        evidenceSeverity: "error",
        isVolatile: true,
      })));
    }
  }

  function openRenameDialog(chat) {
    setOpenChatMenuId(null);
    setRenameDialogChat(chat);
    setRenameInputValue(String(chat?.name || ""));
  }

  async function confirmRenameChat() {
    const targetChat = renameDialogChat;
    if (!targetChat || isChatActionPending) return;
    const nextName = String(renameInputValue || "").trim();
    if (!nextName) return;

    setIsChatActionPending(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(targetChat.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          action: "rename",
          name: nextName,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to rename chat");
      }

      setRenameDialogChat(null);
      setRenameInputValue("");
      await refreshChats({ preferredChatId: activeChatId });
    } catch (error) {
      setMessages((prev) => prev.concat(createMessage("assistant", `Error: ${error.message}`, {
        evidenceSeverity: "error",
        isVolatile: true,
      })));
    } finally {
      setIsChatActionPending(false);
    }
  }

  async function archiveChat(chatId) {
    if (!chatId || isChatActionPending) return;
    setIsChatActionPending(true);
    setOpenChatMenuId(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(chatId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          action: "archive",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to archive chat");
      }
      await refreshChats({ preferredChatId: payload?.activeChatId || activeChatId });
      if (payload?.activeChatId) {
        await loadMessagesFromDb(payload.activeChatId).catch(() => setMessages([]));
      }
    } catch (error) {
      setMessages((prev) => prev.concat(createMessage("assistant", `Error: ${error.message}`, {
        evidenceSeverity: "error",
        isVolatile: true,
      })));
    } finally {
      setIsChatActionPending(false);
    }
  }

  async function confirmDeleteChat() {
    const targetChat = deleteConfirmChat;
    if (!targetChat || isChatActionPending) return;
    setIsChatActionPending(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/chats/${encodeURIComponent(targetChat.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to delete chat");
      }
      setDeleteConfirmChat(null);
      await refreshChats({ preferredChatId: payload?.activeChatId || activeChatId });
      if (payload?.activeChatId) {
        await loadMessagesFromDb(payload.activeChatId).catch(() => setMessages([]));
      } else {
        setMessages([]);
      }
    } catch (error) {
      setMessages((prev) => prev.concat(createMessage("assistant", `Error: ${error.message}`, {
        evidenceSeverity: "error",
        isVolatile: true,
      })));
    } finally {
      setIsChatActionPending(false);
    }
  }

  async function openSettingsDialog() {
    await openUnifiedDialog("settings");
  }

  return React.createElement(
    "div",
    { className: `page${panelData || isUnifiedDialogOpen ? " modal-open" : ""}` },
    React.createElement(
      "header",
      { className: "topbar" },
      React.createElement(
        "div",
        { className: "brand" },
        React.createElement("h1", null, "RAG"),
        React.createElement("span", { className: `brand-status-light ${healthState}`, "aria-label": `System status: ${healthState}` })
      ),
      React.createElement("div", { className: "header-center-spacer", "aria-hidden": "true" }),
      React.createElement(
        "div",
        { className: "quick-actions" },
        activeView === "library"
          ? React.createElement(
            React.Fragment,
            null,
            React.createElement("h2", { className: "header-title" }, "Library")
          )
          : null
      )
    ),
    React.createElement(
      "aside",
      { className: "side-nav" },
      React.createElement(
        "div",
        { className: "side-nav-top" },
        React.createElement(
          "button",
          { type: "button", className: "side-nav-item", onClick: createNewChat },
          icon(plusChatIconPath),
          React.createElement("span", null, "New chat")
        ),
        React.createElement(
          "button",
          {
            type: "button",
            className: "side-nav-item",
            onClick: activeView === "library" ? openChatPage : openLibraryPage,
          },
          icon(activeView === "library" ? chatIconPath : libraryIconPath),
          React.createElement("span", null, activeView === "library" ? "Chat" : "Library")
        ),
        React.createElement(
          "button",
          {
            type: "button",
            className: `side-nav-item${panelData?.command === "/config" || (isUnifiedDialogOpen && activeDialogTab === "settings") ? " active" : ""}`,
            onClick: openSettingsDialog,
            disabled: isSending || !isEmbeddingReady,
          },
          icon(settingsIconPath),
          React.createElement("span", null, "Settings")
        )
      ),
      React.createElement("h3", { className: "side-nav-headline" }, "Your chats"),
      React.createElement(
        "div",
        { className: "side-nav-chat-list", role: "navigation", "aria-label": "Your chats" },
        isLoadingChats
          ? React.createElement("p", { className: "side-nav-loading" }, "Loading chats…")
          : null,
        ...chatList.map((chat) => {
          const isActiveChat = chat.id === activeChatId;
          const isMenuOpenForChat = openChatMenuId === chat.id;
          return React.createElement(
            "div",
            {
              key: chat.id,
              className: `side-nav-chat-row${isActiveChat ? " active" : ""}${isMenuOpenForChat ? " menu-open" : ""}`,
            },
            React.createElement(
              "button",
              {
                type: "button",
                className: `side-nav-chat-item${isActiveChat ? " active" : ""}`,
                onClick: () => switchChat(chat.id),
                disabled: isLoadingChats,
              },
              chat.name
            ),
            React.createElement(
              "div",
              { className: "chat-item-actions" },
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "chat-item-actions-trigger",
                  "aria-label": `Open actions for ${chat.name}`,
                  "aria-haspopup": "menu",
                  "aria-expanded": isMenuOpenForChat ? "true" : "false",
                  onClick: (event) => {
                    event.stopPropagation();
                    setOpenChatMenuId((previous) => previous === chat.id ? null : chat.id);
                  },
                },
                icon(dotsIconPath)
              ),
              isMenuOpenForChat
                ? React.createElement(
                  "ul",
                  { className: "chat-item-actions-menu", role: "menu" },
                  React.createElement(
                    "li",
                    { role: "none" },
                    React.createElement(
                      "button",
                      {
                        type: "button",
                        className: "chat-item-actions-option",
                        role: "menuitem",
                        onClick: () => openRenameDialog(chat),
                      },
                      icon(renameIconPath),
                      React.createElement("span", null, "Rename")
                    )
                  ),
                  React.createElement(
                    "li",
                    { role: "none" },
                    React.createElement(
                      "button",
                      {
                        type: "button",
                        className: "chat-item-actions-option",
                        role: "menuitem",
                        onClick: () => archiveChat(chat.id),
                      },
                      icon(archiveIconPath),
                      React.createElement("span", null, "Archive")
                    )
                  ),
                  React.createElement(
                    "li",
                    { role: "none" },
                    React.createElement(
                      "button",
                      {
                        type: "button",
                        className: "chat-item-actions-option delete",
                        role: "menuitem",
                        onClick: () => {
                          setOpenChatMenuId(null);
                          setDeleteConfirmChat(chat);
                        },
                      },
                      icon(trashIconPath),
                      React.createElement("span", null, "Delete")
                    )
                  )
                )
                : null
            )
          );
        })
      ),
      React.createElement(
        "div",
        { className: "side-nav-bottom" },
        React.createElement(
          "div",
          { className: "side-nav-user" },
          React.createElement("div", { className: "side-nav-avatar-placeholder", "aria-hidden": "true" }, "U"),
          React.createElement(
            "div",
            { className: "side-nav-user-meta" },
            React.createElement("strong", null, "Username"),
            React.createElement("small", null, "Account placeholder")
          )
        )
      )
    ),
    React.createElement(
      "div",
      { className: "workspace" },
      activeView === "library"
        ? React.createElement(
          "section",
          { className: "chat-column library-column" },
          React.createElement(
            "section",
            { className: "info-group-card library-summary-card" },
            React.createElement("h4", null, "Library summary"),
            React.createElement("div", { className: "info-row" }, React.createElement("span", null, "content path"), React.createElement("strong", null, filesData?.contentPath || "n/a")),
            React.createElement("div", { className: "info-row" }, React.createElement("span", null, "files"), React.createElement("strong", null, String(filesData?.totalFiles ?? 0))),
            React.createElement("div", { className: "info-row" }, React.createElement("span", null, "embedded files"), React.createElement("strong", null, String(filesData?.embeddedFiles ?? 0))),
            React.createElement("div", { className: "info-row" }, React.createElement("span", null, "total chunks"), React.createElement("strong", null, String(libraryTotalChunks)))
          ),
          React.createElement(
            "section",
            { className: "info-group-card library-table-card" },
            React.createElement(
              "div",
              { className: "library-table-header" },
              React.createElement("h4", null, "Embeddable files"),
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "restart-button library-upload-button",
                  onClick: () => libraryFileInputRef.current?.click(),
                },
                icon(fileUploadIconPath),
                "Upload"
              ),
              React.createElement("input", {
                ref: libraryFileInputRef,
                type: "file",
                className: "composer-file-input",
                multiple: true,
                accept: LIBRARY_UPLOAD_RULES.allowedExtensions.join(","),
                onChange: handleLibraryFileSelection,
                "aria-hidden": "true",
                tabIndex: -1,
              })
            ),
            libraryNotice ? React.createElement("p", { className: "library-notice" }, libraryNotice) : null,
            React.createElement(
              "div",
              { className: "library-table", role: "table", "aria-label": "Library files" },
              React.createElement(
                "div",
                { className: "library-table-head", role: "row" },
                React.createElement("span", null, "File"),
                React.createElement("span", null, "Status"),
                React.createElement("span", null, "Size"),
                React.createElement("span", null, "Chunks"),
                React.createElement("span", null, "Extension"),
                React.createElement("span", null, "Embedded"),
                React.createElement("span", null, "Updated"),
                React.createElement("span", null, "Action")
              ),
              ...libraryRows.map((file) => React.createElement(
                "div",
                {
                  key: `${file.path}-${file.uploadStatus}-${file.updatedAt || "n/a"}-${file.isVolatile ? "volatile" : "db"}`,
                  className: "library-table-row",
                  role: "row",
                },
                React.createElement("strong", { className: "library-path" }, file.path),
                React.createElement(
                  "span",
                  { className: "library-status-cell" },
                  React.createElement(
                    "span",
                    {
                      className: `status-badge ${
                        ["ready", "embedded", "discovered"].includes(String(file.uploadStatus))
                          ? "active"
                          : file.uploadStatus === "error"
                            ? "error"
                            : "pending"
                      }`,
                    },
                    file.uploadStatus || "unknown"
                  ),
                  file.lastError ? React.createElement("small", { className: "library-row-error" }, file.lastError) : null
                ),
                React.createElement("span", null, formatBytes(file.sizeBytes)),
                React.createElement("span", null, String(file.chunkCount ?? "0")),
                React.createElement("span", null, file.extension || "n/a"),
                (() => {
                  const embeddingInProgress = ["uploading", "uploaded", "embedding"].includes(String(file.uploadStatus));
                  const removingInProgress = file.uploadStatus === "removing"
                    || (file.uploadStatus === "deleted" && Boolean(file.embedded));
                  const showProgress = embeddingInProgress || removingInProgress;
                  const embeddedLabel = embeddingInProgress
                    ? "embedding"
                    : removingInProgress
                      ? "removing"
                      : file.embedded ? "yes" : "no";
                  return React.createElement(
                    "span",
                    null,
                    React.createElement(
                      "span",
                      { className: `status-badge ${file.embedded ? "active" : "pending"} ${showProgress ? "with-spinner" : ""}` },
                      showProgress
                        ? React.createElement("span", { className: "spinner spinner-inline", "aria-hidden": "true" })
                        : null,
                      embeddedLabel
                    )
                  );
                })(),
                React.createElement("span", null, file.updatedAt ? new Date(file.updatedAt).toISOString() : "n/a"),
                React.createElement(
                  "div",
                  { className: "library-row-actions" },
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "library-toggle-button",
                      "aria-label": file.uploadStatus === "disabled" ? `Activate ${file.path}` : `Disable ${file.path}`,
                      onClick: () => toggleLibraryFile(file, file.uploadStatus === "disabled" ? "activate" : "disable"),
                      disabled: !file.canDelete,
                    },
                    icon(file.uploadStatus === "disabled" ? eyeIconPath : eyeOffIconPath)
                  ),
                  React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "library-delete-button",
                      "aria-label": `Delete ${file.path}`,
                      onClick: () => setDeleteConfirmFile(file),
                      disabled: !file.canDelete,
                    },
                    icon(trashIconPath)
                  )
                )
              ))
            )
          )
        )
        : React.createElement(
        "section",
        { className: "chat-column" },
        React.createElement(
          "section",
          { className: "chat" },
          !isEmbeddingReady && !isLoadingStatus
            ? null
            : messages.slice(-20).map((message, index, visibleMessages) => {
              const messageBadge = getMessageBadge(message);
              return React.createElement(
                "article",
                {
                  key: message.id,
                  className: `msg ${message.role}${message.isPending ? " pending" : ""}`,
                  ref: index === visibleMessages.length - 1 ? lastMessageRef : null,
                },
                React.createElement(
                  "div",
                  { className: "msg-header" },
                  React.createElement("span", null, message.role === "user" ? "You" : "Assistant"),
                  messageBadge
                    ? React.createElement(
                      "small",
                      { className: `evidence-pill ${messageBadge.tone}` },
                      messageBadge.label
                    )
                    : null
                ),
              message.responseType
                ? React.createElement(
                  "div",
                  { className: `msg-command ${message.responseType}` },
                  React.createElement("pre", null, message.text)
                )
                : message.role === "assistant"
                  && isRagMode
                  && message.retrieval
                  && message.interaction?.type !== "weak_confirmation"
                  && message.evidenceSeverity !== "source_attached"
                  && !(message.upload?.uploadedCount > 0)
                  ? React.createElement(
                    "div",
                    { className: "assistant-rag-layout" },
                    React.createElement(
                      "section",
                      { className: "assistant-answer-block" },
                      React.createElement("small", null, "Answer"),
                      renderAssistantMarkdown(message.text)
                    ),
                    React.createElement(
                      "details",
                      { className: "assistant-evidence-block" },
                      React.createElement("summary", null, React.createElement("small", null, "Evidence details")),
                      React.createElement(
                        "div",
                        { className: "assistant-evidence-content" },
                        React.createElement(
                          "p",
                          { className: "assistant-evidence-summary" },
                          `Quality: ${formatSeverityLabel(message.evidenceSeverity || "unknown")} • Matches: ${message.retrieval.matches?.length || 0} • Cosine limit: ${message.retrieval.cosineLimit ?? "n/a"}`
                        ),
                        Array.isArray(message.retrieval.matches) && message.retrieval.matches.length > 0
                          ? React.createElement(
                            "ul",
                            { className: "assistant-evidence-list" },
                            ...message.retrieval.matches.slice(0, 4).map((match) => React.createElement(
                              "li",
                              { key: `${message.id}-${match.rank}-${match.source}` },
                              React.createElement(
                                "div",
                                { className: "assistant-evidence-meta" },
                                React.createElement("strong", null, `#${match.rank}`),
                                React.createElement(
                                  "span",
                                  { className: `assistant-evidence-score ${getScoreSeverity(match.score)}` },
                                  `score: ${Number.isFinite(match.score) ? match.score.toFixed(3) : "n/a"}`
                                ),
                                React.createElement("span", null, match.source || "unknown source")
                              ),
                              match.title ? React.createElement("div", { className: "assistant-evidence-title" }, match.title) : null,
                              match.preview ? React.createElement("p", null, match.preview) : null
                            ))
                          )
                          : React.createElement("p", { className: "assistant-evidence-empty" }, "No retrieval matches were returned.")
                      )
                    )
                  )
                  : message.role === "assistant"
                    ? renderAssistantMarkdown(message.text)
                    : React.createElement(
                      "div",
                      { className: "user-message-content" },
                      React.createElement("p", null, message.text),
                      Array.isArray(message.attachedFiles) && message.attachedFiles.length > 0
                        ? React.createElement(
                          "div",
                          { className: "user-attachment-box" },
                          React.createElement(
                            "small",
                            { className: "user-attachment-label" },
                            `Attached file${message.attachedFiles.length > 1 ? "s" : ""}`
                          ),
                          React.createElement(
                            "ul",
                            { className: "user-attachment-list" },
                            ...message.attachedFiles.map((fileName) => React.createElement("li", { key: `${message.id}-${fileName}` }, fileName))
                          )
                        )
                        : null
                    )
              );
            })
        ),
        React.createElement(
          "form",
          { className: "composer", onSubmit: sendPrompt },
          React.createElement(
            "div",
            { className: "composer-input-shell" },
            React.createElement("input", {
              ref: promptFileInputRef,
              type: "file",
              className: "composer-file-input",
              multiple: true,
              accept: PROMPT_ATTACHMENT_RULES.allowedExtensions.join(","),
              onChange: handlePromptFileSelection,
              "aria-hidden": "true",
              tabIndex: -1,
            }),
            React.createElement(
              "button",
              {
                className: "composer-attach-button",
                type: "button",
                onClick: openPromptFilePicker,
                disabled: isSending || !isEmbeddingReady,
                "aria-label": "Attach files",
                "data-testid": "composer-attach-button",
                title: `Attach files (${PROMPT_ATTACHMENT_RULES.allowedExtensions.join(", ")})`,
              },
              icon("M8 7.5v8a4 4 0 0 0 8 0v-9a2.5 2.5 0 0 0-5 0V15a1 1 0 0 0 2 0V8.5h1.8V15a2.8 2.8 0 0 1-5.6 0V6.5a4.3 4.3 0 1 1 8.6 0v9a5.8 5.8 0 0 1-11.6 0v-8z")
            ),
            React.createElement("textarea", {
              ref: composerInputRef,
              value: inputValue,
              onChange: (event) => {
                setInputValue(event.target.value);
                resizeComposerInput(event.target);
              },
              onInput: (event) => resizeComposerInput(event.target),
              onKeyDown: (event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (inputValue.trim() && !isSending && isEmbeddingReady) {
                    void sendRawPrompt(inputValue, attachedPromptFiles);
                  }
                }
              },
              rows: 1,
              placeholder: "Ask anything about your knowledge base...",
              disabled: isSending || !isEmbeddingReady,
            })
          ),
          React.createElement(
            "button",
            { className: "send", type: "submit", disabled: isSending || !isEmbeddingReady || !inputValue.trim() },
            icon("M2 21l20-9L2 3v7l14 2-14 2z"),
            React.createElement("span", null, isSending ? "Sending..." : "Send")
          ),
          attachedPromptFiles.length > 0
            ? React.createElement(
              "p",
              { className: "composer-attachment-list" },
              `Attached: ${attachedPromptFiles.map((file) => file.name).join(", ")}`
            )
            : null,
          attachmentNotice
            ? React.createElement(
              "p",
              { className: `composer-attachment-notice${attachedPromptFiles.length > 0 ? " valid" : " invalid"}` },
              attachmentNotice
            )
            : null
        )
      )
    ),
    React.createElement(
      "div",
      { className: "floating-menu", ref: menuRef },
      React.createElement(
        "button",
        {
          className: "floating-menu-toggle",
          type: "button",
          onClick: () => setIsMenuOpen((current) => !current),
          "aria-label": isMenuOpen ? "Close quick actions" : "Open quick actions",
        },
        icon("M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z")
      ),
      isMenuOpen
        ? React.createElement(
          "div",
          { className: "floating-menu-panel" },
          React.createElement(
            "button",
            { type: "button", onClick: () => openUnifiedDialog("info"), disabled: isSending || !isEmbeddingReady },
            icon("M11 17h2v-6h-2zm1-8a1.25 1.25 0 1 0 0 2.5A1.25 1.25 0 0 0 12 9m0 13A10 10 0 1 1 12 2a10 10 0 0 1 0 20"),
            "Info"
          ),
          activeView === "library"
            ? React.createElement(
              "button",
              { type: "button", onClick: openChatPage },
              icon(chatIconPath),
              "Chat"
            )
            : React.createElement(
              "button",
              { type: "button", onClick: openLibraryPage },
              icon(libraryIconPath),
              "Library"
            ),
          React.createElement(
            "button",
            { type: "button", onClick: openPersonalizationPanel, disabled: isSending || !isEmbeddingReady },
            icon("M12 2a5 5 0 0 1 5 5c0 2.7-2.1 4.8-4.7 5A7 7 0 0 1 19 19h-2a5 5 0 0 0-10 0H5a7 7 0 0 1 6.7-7c-2.6-.2-4.7-2.3-4.7-5a5 5 0 0 1 5-5"),
            "Personalization"
          ),
          React.createElement(
            "button",
            { type: "button", onClick: () => openUnifiedDialog("settings"), disabled: isSending || !isEmbeddingReady },
            icon("M19.14 12.94a7.14 7.14 0 0 0 .05-.94 7.14 7.14 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.14 7.14 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.14 7.14 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.14 7.14 0 0 0-.05.94 7.14 7.14 0 0 0 .05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.59-.23 1.13-.55 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5"),
            "Settings"
          ),
          React.createElement(
            "button",
            { type: "button", onClick: () => openUnifiedDialog("help"), disabled: isSending || !isEmbeddingReady },
            icon("M12 2 2 12l10 10 10-10Zm0 4.5a3 3 0 0 1 3 3c0 2.2-3 2.4-3 5h-2c0-3.4 3-3.8 3-5a1 1 0 0 0-2 0H9a3 3 0 0 1 3-3Zm-1 10h2v2h-2z"),
            "Help"
          )
        )
        : null,
      null
    ),
    activeView !== "library" && !isEmbeddingReady && !isLoadingStatus
      ? React.createElement(
        "div",
        { className: "embedding-loading-overlay" },
        React.createElement(
          "div",
          { className: "embedding-loading" },
          React.createElement("span", { className: "spinner", "aria-hidden": "true" }),
          React.createElement("strong", null, "Embedding in progress"),
          React.createElement("p", null, "Your documents are being indexed. You can browse dialogs while indexing completes.")
        )
      )
      : null,
    deleteConfirmFile
      ? React.createElement(
        "div",
        {
          className: "panel-modal-backdrop",
          onClick: () => setDeleteConfirmFile(null),
        },
        React.createElement(
          "section",
          {
            className: "library-delete-modal",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": "Confirm library file deletion",
            onClick: (event) => event.stopPropagation(),
          },
          React.createElement("h4", null, "Delete file?"),
          React.createElement(
            "p",
            null,
            "Are you sure you want to delete this file?",
            React.createElement("span", { className: "library-delete-filename" }, deleteConfirmFile.path)
          ),
          React.createElement(
            "div",
            { className: "library-delete-actions" },
            React.createElement(
              "button",
              {
                type: "button",
                className: "library-delete-confirm",
                onClick: confirmDeleteLibraryFile,
              },
              icon(trashIconPath),
              "Delete"
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "library-delete-cancel",
                onClick: () => setDeleteConfirmFile(null),
              },
              icon(keepIconPath),
              "Keep"
            )
          )
        )
      )
      : null,
    renameDialogChat
      ? React.createElement(
        "div",
        {
          className: "panel-modal-backdrop",
          onClick: () => {
            if (isChatActionPending) return;
            setRenameDialogChat(null);
            setRenameInputValue("");
          },
        },
        React.createElement(
          "section",
          {
            className: "chat-rename-modal",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": "Rename chat",
            onClick: (event) => event.stopPropagation(),
          },
          React.createElement("h4", null, "Rename"),
          React.createElement("input", {
            type: "text",
            className: "chat-rename-input",
            value: renameInputValue,
            maxLength: 240,
            autoFocus: true,
            onChange: (event) => setRenameInputValue(event.target.value),
          }),
          React.createElement(
            "div",
            { className: "chat-rename-actions" },
            React.createElement(
              "button",
              {
                type: "button",
                className: "chat-rename-cancel",
                onClick: () => {
                  setRenameDialogChat(null);
                  setRenameInputValue("");
                },
                disabled: isChatActionPending,
              },
              "Cancel"
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "chat-rename-save",
                onClick: confirmRenameChat,
                disabled: isChatActionPending || !String(renameInputValue || "").trim(),
              },
              icon(keepIconPath),
              "Save"
            )
          )
        )
      )
      : null,
    deleteConfirmChat
      ? React.createElement(
        "div",
        {
          className: "panel-modal-backdrop",
          onClick: () => {
            if (isChatActionPending) return;
            setDeleteConfirmChat(null);
          },
        },
        React.createElement(
          "section",
          {
            className: "library-delete-modal",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": "Confirm chat deletion",
            onClick: (event) => event.stopPropagation(),
          },
          React.createElement("h4", null, "Delete chat?"),
          React.createElement(
            "p",
            null,
            "Are you sure you want to delete this chat?",
            React.createElement("span", { className: "library-delete-filename" }, deleteConfirmChat.name)
          ),
          React.createElement(
            "div",
            { className: "library-delete-actions" },
            React.createElement(
              "button",
              {
                type: "button",
                className: "library-delete-cancel",
                onClick: () => setDeleteConfirmChat(null),
                disabled: isChatActionPending,
              },
              icon(keepIconPath),
              "Keep"
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "library-delete-confirm",
                onClick: confirmDeleteChat,
                disabled: isChatActionPending,
              },
              icon(trashIconPath),
              "Delete"
            )
          )
        )
      )
      : null,
    isUnifiedDialogOpen
      ? React.createElement(
        "div",
        {
          className: "panel-modal-backdrop",
          onClick: () => setIsUnifiedDialogOpen(false),
        },
        React.createElement(
          "section",
          {
            className: "panel-modal panel-modal-with-tabs",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": "Preferences dialog",
            onClick: (event) => event.stopPropagation(),
          },
          React.createElement(
            "div",
            { className: "panel-modal-head" },
            React.createElement("strong", null, "Preferences"),
            React.createElement(
              "div",
              { className: "panel-modal-head-actions" },
              React.createElement(
                "button",
                {
                  className: "panel-close",
                  type: "button",
                  onClick: () => setIsUnifiedDialogOpen(false),
                  "aria-label": "Close preferences dialog",
                },
                "×"
              )
            )
          ),
          React.createElement(
            "div",
            { className: "panel-modal-tab-layout" },
            React.createElement(
              "nav",
              { className: "panel-tab-nav", "aria-label": "Preferences sections" },
              ...MENU_DIALOG_TABS.map((tab) => React.createElement(
                "button",
                {
                  key: tab.id,
                  type: "button",
                  className: `panel-tab-button${tab.id === activeDialogTab ? " active" : ""}`,
                  onClick: () => loadUnifiedDialogTab(tab.id),
                  disabled: isDialogTabLoading && tab.id === activeDialogTab,
                  "aria-current": tab.id === activeDialogTab ? "page" : undefined,
                },
                tab.label
              ))
            ),
            React.createElement(
              "div",
              { className: "panel-modal-content" },
              dialogTabError
                ? React.createElement("p", { className: "panel-modal-error" }, `Error: ${dialogTabError}`)
                : isDialogTabLoading && !activeModalPanel
                  ? React.createElement("p", { className: "panel-modal-loading" }, "Loading section…")
                  : activeModalPanel
                    ? renderPanelContent({
                      panelData: activeModalPanel,
                      parsedInfoGroups,
                      parsedAssistantPanel,
                      parsedProfilePanel,
                      parsedHelpPanel,
                      editableConfigRows,
                      restartConfigRows,
                      retrieverStatus,
                      embedderStatus,
                      isSending,
                      isEmbeddingReady,
                      submitConfigChange,
                      applyPersonalizationChange,
                      icon,
                    })
                    : React.createElement("p", null, "Select a section.")
            )
          )
        )
      )
      : null,
    panelData
      ? React.createElement(
        "div",
        {
          className: "panel-modal-backdrop",
          onClick: () => setPanelData(null),
        },
        React.createElement(
          "section",
          {
            className: "panel-modal",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": panelTitle,
            onClick: (event) => event.stopPropagation(),
          },
          React.createElement(
            "div",
            { className: "panel-modal-head" },
            React.createElement("strong", null, panelTitle),
            React.createElement(
              "div",
              { className: "panel-modal-head-actions" },
              panelData.severity
                ? React.createElement(
                  "small",
                  { className: `evidence-pill ${panelData.severity}` },
                  formatSeverityLabel(panelData.severity)
                )
                : null,
              React.createElement(
                "button",
                {
                  className: "panel-close",
                  type: "button",
                  onClick: () => setPanelData(null),
                  "aria-label": "Close details panel",
                },
                "×"
              )
            )
          ),
          React.createElement(
            "div",
            { className: "panel-modal-content" },
            renderPanelContent({
              panelData,
              parsedInfoGroups,
              parsedAssistantPanel,
              parsedProfilePanel,
              parsedHelpPanel,
              editableConfigRows,
              restartConfigRows,
              retrieverStatus,
              embedderStatus,
              isSending,
              isEmbeddingReady,
              submitConfigChange,
              applyPersonalizationChange,
              icon,
            })
          )
        )
      )
      : null
  );
}

createRoot(document.getElementById("root")).render(React.createElement(App));
