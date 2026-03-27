import { parseAssistantModeContent, parseSystemInfoContent } from "./utils.js";

export const UI_MODE_OPTIONS = [
  { id: "clean", description: "Clean chat-focused UI without retrieval diagnostics.", shortDescription: "Focused chat view" },
  { id: "rag", description: "Retrieval-debug UI that includes evidence quality and similarity details.", shortDescription: "Show retrieval details" },
];
export const ASSISTANT_MODE_OPTIONS = [
  { id: "simple", label: "Simple", description: "For everyday simple tasks", shortDescription: "Fast and direct" },
  { id: "refine", label: "Refine", description: "For getting refined answers", shortDescription: "Draft then improve" },
  { id: "thinking", label: "Thinking", description: "For complex questions", shortDescription: "Deeper reasoning mode" },
];
export const PERSONALIZATION_OPTIONS = {
  baseStyleTone: [
    { id: "default", description: "Default response style." },
    { id: "professional", description: "Polished and precise." },
    { id: "friendly", description: "Warm and chatty." },
    { id: "direct", description: "Direct and encouraging." },
    { id: "quirky", description: "Playful and imaginative." },
    { id: "efficient", description: "Concise and plain." },
    { id: "sceptical", description: "Sceptical and critical." },
  ],
  warm: [
    { id: "more", description: "Friendlier and personable." },
    { id: "default", description: "Balanced warmth." },
    { id: "less", description: "More professional and factual." },
  ],
  enthusiastic: [
    { id: "more", description: "More energy and excitement." },
    { id: "default", description: "Balanced enthusiasm." },
    { id: "less", description: "Calmer and more neutral." },
  ],
  headersAndLists: [
    { id: "more", description: "Use clear formatting and lists." },
    { id: "default", description: "Balanced formatting and paragraphs." },
    { id: "less", description: "More paragraphs instead of lists." },
  ],
};
export const DEFAULT_PERSONALIZATION_PREFERENCES = {
  baseStyleTone: "default",
  warm: "default",
  enthusiastic: "default",
  headersAndLists: "default",
  customInstructions: "",
  nickname: "",
  occupation: "",
  moreAboutUser: "",
};
export const TEMPORARILY_DISABLED_ASSISTANT_MODES = new Set([]);
export const PROMPT_ATTACHMENT_RULES = {
  maxFiles: 3,
  allowedExtensions: [".md", ".txt", ".html", ".htm", ".pdf", ".csv", ".png", ".jpg", ".jpeg", ".webp"],
};
const ATTACHMENT_EXTENSION_COLOR_CLASS = {
  pdf: "is-red",
  epub: "is-red",
  md: "is-gray",
  txt: "is-gray",
  html: "is-blue",
  htm: "is-blue",
  png: "is-purple",
  jpg: "is-purple",
  jpeg: "is-purple",
  webp: "is-purple",
  csv: "is-green",
};
export const LIBRARY_UPLOAD_RULES = {
  maxFiles: 5,
  allowedExtensions: [".md", ".txt", ".html", ".htm", ".pdf", ".epub"],
};
export const SESSION_ID_STORAGE_KEY = "rag-session-id";
export const CHAT_ID_STORAGE_KEY = "rag-chat-id";
export const ASSISTANT_MODE_STORAGE_KEY = "rag-assistant-mode";
export const AUTH_SESSION_TOKEN_STORAGE_KEY = "rag-auth-session-token";
export const LOGIN_PAGE_HASH = "#login";
export const LIBRARY_PAGE_HASH = "#library";
export const ADMIN_PAGE_HASH = "#admin";
export const PREFERENCES_DIALOG_TABS = [
  { id: "general", label: "General", command: "/general" },
  { id: "personalization", label: "Personalization", command: "/personalization" },
  { id: "settings", label: "Settings", command: "/config" },
  { id: "filter", label: "Filter" },
  { id: "archive", label: "Archive" },
];
const AUXILIARY_DIALOG_TABS = [
  { id: "info", label: "Info", command: "/info" },
  { id: "help", label: "Help", command: "/help" },
];
export const DEFAULT_FILE_TAG_LABEL = "default";
export const ADMIN_PROTECTED_USERNAMES = new Set(["default", "defaultadm"]);
const BERLIN_DATE_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
});
const BERLIN_TIME_FORMATTER = new Intl.DateTimeFormat("de-DE", {
  timeZone: "Europe/Berlin",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function buildChatNameFromId(chatId) {
  const suffix = String(chatId || "").replace(/^chat-/, "").slice(0, 6) || Math.random().toString(36).slice(2, 8);
  return `chat-${suffix}`;
}

export function buildInitialChatList(activeChatId) {
  const primaryId = String(activeChatId || "").trim();
  if (!primaryId) {
    return [];
  }
  return [{ id: primaryId, name: buildChatNameFromId(primaryId) }];
}

export function getOrCreatePersistentId(storageKey, fallbackPrefix) {
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

export function getScoreSeverity(score) {
  if (!Number.isFinite(score)) return "unknown";
  if (score >= 0.8) return "high";
  if (score >= 0.6) return "medium";
  return "low";
}

export function formatScorePercent(score) {
  if (!Number.isFinite(score)) return "n/a";
  return `${(score * 100).toFixed(1).replace(".", ",")}%`;
}

export function getFileExtensionFromName(fileName) {
  const normalized = String(fileName || "").trim();
  if (!normalized) return "";
  const parts = normalized.split(".");
  if (parts.length <= 1) return "";
  return parts.pop().toLowerCase();
}

export function getAttachmentColorClass(fileName) {
  const extension = getFileExtensionFromName(fileName);
  return ATTACHMENT_EXTENSION_COLOR_CLASS[extension] || "is-gray";
}

export function normalizeLibraryPathDisplay(pathValue) {
  return String(pathValue || "").replace(/^_library\//, "");
}

export function formatLibraryUpdatedAt(value) {
  if (!value) {
    return { date: "n/a", time: "" };
  }
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return { date: "n/a", time: "" };
  }
  return {
    date: BERLIN_DATE_FORMATTER.format(parsedDate),
    time: BERLIN_TIME_FORMATTER.format(parsedDate),
  };
}

export function getCurrentUiModeFromInfoText(infoText) {
  const parsedGroups = parseSystemInfoContent(infoText || "");
  const appGroup = parsedGroups.find((group) => group.title === "App");
  const uiModeEntry = appGroup?.items?.find((item) => item.key.toLowerCase() === "ui mode");
  return uiModeEntry?.value || "clean";
}

export function getDialogTabById(tabId) {
  return PREFERENCES_DIALOG_TABS.concat(AUXILIARY_DIALOG_TABS).find((tab) => tab.id === tabId) || PREFERENCES_DIALOG_TABS[0];
}

export function getAssistantModeMeta(modeId) {
  const normalized = String(modeId || "").trim().toLowerCase();
  return ASSISTANT_MODE_OPTIONS.find((mode) => mode.id === normalized) || ASSISTANT_MODE_OPTIONS[0];
}

export function isKnownAssistantMode(modeId) {
  const normalized = String(modeId || "").trim().toLowerCase();
  return ASSISTANT_MODE_OPTIONS.some((mode) => mode.id === normalized);
}

export function mergeAssistantModes(parsedAssistantModes = [], availableModes = []) {
  const normalizedById = new Map();
  for (const mode of ASSISTANT_MODE_OPTIONS) {
    normalizedById.set(mode.id, {
      id: mode.id,
      label: mode.label,
      description: mode.description,
      shortDescription: mode.shortDescription,
    });
  }
  for (const mode of Array.isArray(parsedAssistantModes) ? parsedAssistantModes : []) {
    const id = String(mode?.id || "").trim().toLowerCase();
    if (!id) continue;
    const fallback = normalizedById.get(id) || { id, label: id, shortDescription: "", description: "" };
    normalizedById.set(id, {
      id,
      label: fallback.label,
      shortDescription: fallback.shortDescription,
      description: String(mode?.description || "").trim() || fallback.description,
    });
  }
  for (const mode of Array.isArray(availableModes) ? availableModes : []) {
    const id = String(mode?.id || "").trim().toLowerCase();
    if (!id) continue;
    const fallback = normalizedById.get(id) || { id, label: id, shortDescription: "", description: "" };
    normalizedById.set(id, {
      id,
      label: String(mode?.label || "").trim() || fallback.label,
      shortDescription: fallback.shortDescription,
      description: fallback.description,
    });
  }
  return Array.from(normalizedById.values());
}

export function buildGeneralAssistantPanelContent(assistantAnswer, statusData, currentAssistantMode) {
  const parsedAssistant = parseAssistantModeContent(assistantAnswer || "");
  const assistantModes = mergeAssistantModes(parsedAssistant.modes, statusData?.assistant?.availableModes);
  const parsedCurrentMode = String(parsedAssistant.currentMode || "").trim().toLowerCase();
  const statusCurrentMode = String(statusData?.assistant?.mode || "").trim().toLowerCase();
  const localCurrentMode = String(currentAssistantMode || "").trim().toLowerCase();
  const resolvedCurrentMode = isKnownAssistantMode(parsedCurrentMode)
    ? parsedCurrentMode
    : isKnownAssistantMode(statusCurrentMode)
      ? statusCurrentMode
      : isKnownAssistantMode(localCurrentMode)
        ? localCurrentMode
        : ASSISTANT_MODE_OPTIONS[0].id;
  return {
    currentMode: resolvedCurrentMode,
    modes: assistantModes,
  };
}

export function isAssistantModeTemporarilyDisabled(modeId) {
  const normalized = String(modeId || "").trim().toLowerCase();
  return TEMPORARILY_DISABLED_ASSISTANT_MODES.has(normalized);
}

export function getPendingAssistantMessage(modeId, chainStage) {
  const normalizedMode = String(modeId || "").trim().toLowerCase();
  const normalizedStage = String(chainStage || "").trim().toLowerCase();
  if (normalizedStage === "searching") {
    return "Searching the knowledge base…";
  }
  if (normalizedMode === "refine") {
    if (normalizedStage === "refining") {
      return "Refining the final answer…";
    }
    return "Drafting an answer…";
  }
  if (normalizedMode === "thinking") {
    if (normalizedStage === "analyse_plan") {
      return "Analyzing and planning the response…";
    }
    if (normalizedStage === "drafting") {
      return "Drafting an answer…";
    }
    if (normalizedStage === "refining") {
      return "Refining the final answer…";
    }
  }
  return "Assistant is thinking…";
}

export function buildPendingAssistantTrailText(statusTrail) {
  const normalizedTrail = Array.isArray(statusTrail)
    ? statusTrail.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (normalizedTrail.length === 0) {
    return "Assistant is thinking…";
  }
  return normalizedTrail.join("\n");
}

export function dedupeStatusTrail(statusTrail) {
  const deduped = [];
  for (const step of Array.isArray(statusTrail) ? statusTrail : []) {
    const normalized = String(step || "").trim();
    if (!normalized) continue;
    if (deduped[deduped.length - 1] === normalized) continue;
    deduped.push(normalized);
  }
  return deduped;
}

export function buildPersonalizationContent(preferences) {
  return {
    sections: [
      {
        id: "personalization",
        title: "Personalization",
        settings: {
          baseStyleTone: {
            label: "Base style and tone",
            currentId: preferences.baseStyleTone,
            options: PERSONALIZATION_OPTIONS.baseStyleTone,
          },
          warm: {
            label: "Warm",
            currentId: preferences.warm,
            options: PERSONALIZATION_OPTIONS.warm,
          },
          enthusiastic: {
            label: "Enthusiastic",
            currentId: preferences.enthusiastic,
            options: PERSONALIZATION_OPTIONS.enthusiastic,
          },
          headersAndLists: {
            label: "Headers and Lists",
            currentId: preferences.headersAndLists,
            options: PERSONALIZATION_OPTIONS.headersAndLists,
          },
        },
      },
      {
        id: "custom-instructions",
        title: "Custom Instructions",
        description: "Define custom response instructions that will be merged into your session profile prompt.",
      },
      {
        id: "about-you",
        title: "About You",
        description: "Store user context and background details for this session profile.",
      },
    ],
  };
}

export function buildWebUiHelpContent() {
  return {
    sections: [
      {
        id: "chat-usage",
        title: "Chat Usage",
        paragraphs: [
          "Create a chat with the + New Chat button in the sidebar. Use separate chats for separate topics so answers stay focused.",
          "Open the chat menu (⋯) to rename chats, download chats, archive chats you no longer need, or remove chats. Here you can also filter the applied knowledge base for this specific chat by the provided tags.",
        ],
        userInputHeading: "User input",
        userInputNotes: [
          "Use the input field at the bottom to type your question or instruction, make sure to be percise and think of good prompting and give the needed context.",
          "Press Enter to send, or Shift+Enter for a new line.",
          "You can attach up to 3 files to a single prompt.",
        ],
        extensionHeading: "Attachable file extensions",
        extensions: PROMPT_ATTACHMENT_RULES.allowedExtensions,
      },
      {
        id: "library",
        title: "Library",
        paragraphs: [
          "The Library can include system/admin controlled files and user controlled files. System/admin files are managed centrally and are available to users without giving edit or delete access.",
          "User controlled files are the files you upload yourself. You can manage their availability per file with disable/enable and remove them when they are no longer needed.",
          "Disable removes a file from retrieval results without deleting it. Enable makes the file available for retrieval again.",
          "Delete permanently removes your own uploaded file from your user scope. It does not delete system/admin managed files for other users.",
        ],
        extensionHeading: "Embeddable file extensions",
        extensions: LIBRARY_UPLOAD_RULES.allowedExtensions,
      },
      {
        id: "personalization",
        title: "Personalization",
        paragraphs: [
          "Custom instructions are persistent guidance for how the assistant should behave across your chats (for example tone or response format preferences).",
        ],
        assistantModes: ASSISTANT_MODE_OPTIONS.map((mode) => ({
          label: mode.label,
          description: mode.description,
        })),
      },
      {
        id: "preferences",
        title: "Preferences",
        paragraphs: [
          "Settings Tab: you can adjust runtime retrieval settings that affect how many matches are considered and how strict matching should be, helping you tune recall versus precision.",
          "Filter Tab: you manage global tag filters for your session. Tags disabled here are excluded in all chats, and chat-level filters cannot re-enable globally disabled tags.",
          "Archive Tab: you can review archived chats and restore or permanently remove them. This helps keep the active chat list clean while still keeping older work accessible when needed.",
        ],
      },
    ],
  };
}
