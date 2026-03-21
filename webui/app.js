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
  const [activeView, setActiveView] = useState(getInitialView);
  const sessionIdRef = useRef(getOrCreatePersistentId(SESSION_ID_STORAGE_KEY, "session"));
  const chatIdRef = useRef(getOrCreatePersistentId(CHAT_ID_STORAGE_KEY, "chat"));

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

  async function loadMessagesFromDb() {
    const sessionId = sessionIdRef.current;
    const chatId = chatIdRef.current;
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
    loadMessagesFromDb().catch(() => {
      setMessages([]);
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
    }

    document.addEventListener("pointerdown", closeMenuOnOutside);
    return () => document.removeEventListener("pointerdown", closeMenuOnOutside);
  }, []);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === "Escape") {
        setPanelData(null);
      }
    }

    if (panelData) {
      document.addEventListener("keydown", handleEscape);
      return () => document.removeEventListener("keydown", handleEscape);
    }

    return undefined;
  }, [panelData]);

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

  async function openPersonalizationPanel() {
    if (isSending || !isEmbeddingReady) return;

    setIsMenuOpen(false);
    setIsSending(true);

    try {
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
      await refreshCurrentPanel(panelData?.command);
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
  const fileUploadIconPath = "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zm0 1.5L18.5 9H14zM11 17v-4.6l-1.7 1.7-1.4-1.4L12 8.6l4.1 4.1-1.4 1.4-1.7-1.7V17z";
  const trashIconPath = "M9 3h6l1 2h4v2H4V5h4zm1 6h2v8h-2zm4 0h2v8h-2zM7 9h2v8H7z";
  const keepIconPath = "M9.6 16.6 5.4 12.4l1.4-1.4 2.8 2.8 7.6-7.6 1.4 1.4z";
  const renderAssistantMarkdown = (text) => {
    const rendered = marked.parse(String(text || ""));
    const sanitized = DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } });
    return React.createElement("div", {
      className: "assistant-markdown",
      dangerouslySetInnerHTML: { __html: sanitized },
    });
  };

  const panelTitle = getPanelTitle(panelData?.command);

  const parsedAssistantPanel = panelData?.command === "/assistant"
    ? parseAssistantModeContent(Array.isArray(panelData.content) ? panelData.content.join("\n") : String(panelData.content || ""))
    : null;
  const parsedProfilePanel = panelData?.command === "/profile"
    ? parseProfileContent(Array.isArray(panelData.content) ? panelData.content.join("\n") : String(panelData.content || ""))
    : null;
  const parsedInfoGroups = panelData?.command === "/info"
    ? parseSystemInfoContent(Array.isArray(panelData.content) ? panelData.content.join("\n") : String(panelData.content || ""))
    : [];
  const parsedHelpPanel = panelData?.command === "/help" || panelData?.command === "?"
    ? parseHelpContent(Array.isArray(panelData.content) ? panelData.content.join("\n") : String(panelData.content || ""))
    : null;
  const configSections = panelData?.command === "/config" && panelData.configView
    ? panelData.configView.sections
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

  return React.createElement(
    "div",
    { className: `page${panelData ? " modal-open" : ""}` },
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
            React.createElement(
              "button",
              { type: "button", className: "send header-chat-link", onClick: openChatPage },
              icon(chatIconPath),
              "Chat"
            ),
            React.createElement("h2", { className: "header-title" }, "Library")
          )
          : null
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
                file.canDelete
                  ? React.createElement(
                    "button",
                    {
                      type: "button",
                      className: "library-delete-button",
                      "aria-label": `Delete ${file.path}`,
                      onClick: () => setDeleteConfirmFile(file),
                    },
                    icon(trashIconPath)
                  )
                  : React.createElement("span", null, "—")
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
      isMenuOpen
        ? React.createElement(
          "div",
          { className: "floating-menu-panel" },
          React.createElement(
            "button",
            { type: "button", onClick: async () => { setIsMenuOpen(false); await sendRawPrompt("/info"); }, disabled: isSending || !isEmbeddingReady },
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
            { type: "button", onClick: async () => { setIsMenuOpen(false); await sendRawPrompt("/config"); }, disabled: isSending || !isEmbeddingReady },
            icon("M19.14 12.94a7.14 7.14 0 0 0 .05-.94 7.14 7.14 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.14 7.14 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.14 7.14 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.14 7.14 0 0 0-.05.94 7.14 7.14 0 0 0 .05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.59-.23 1.13-.55 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5"),
            "Settings"
          ),
          React.createElement(
            "button",
            { type: "button", onClick: async () => { setIsMenuOpen(false); await sendRawPrompt("/help"); }, disabled: isSending || !isEmbeddingReady },
            icon("M12 2 2 12l10 10 10-10Zm0 4.5a3 3 0 0 1 3 3c0 2.2-3 2.4-3 5h-2c0-3.4 3-3.8 3-5a1 1 0 0 0-2 0H9a3 3 0 0 1 3-3Zm-1 10h2v2h-2z"),
            "Help"
          )
        )
        : null,
      React.createElement(
        "button",
        {
          className: "floating-menu-toggle",
          type: "button",
          onClick: () => setIsMenuOpen((current) => !current),
          "aria-label": isMenuOpen ? "Close menu" : "Open menu",
        },
        isMenuOpen
          ? icon("M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.29 19.7 2.88 18.3 9.17 12 2.88 5.71 4.29 4.3l6.3 6.29 6.3-6.29z")
          : icon("M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z")
      )
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
            "Are you sure you want to delete ",
            React.createElement("span", { className: "library-delete-filename" }, deleteConfirmFile.path),
            "?"
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
