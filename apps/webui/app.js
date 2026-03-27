import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { marked } from "marked";
import DOMPurify from "dompurify";
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
  parseSystemInfoContent,
  resizeComposerInput,
} from "./utils.js";
import { renderPanelContent } from "./panel-content.js";
import {
  buildChatDownloadFileName,
  buildFallbackChatExportPayload,
  triggerJsonDownload,
} from "./chat-export.js";
import { createApiClient } from "./api-client.js";

import {
  ADMIN_PAGE_HASH,
  ADMIN_PROTECTED_USERNAMES,
  ASSISTANT_MODE_STORAGE_KEY,
  ASSISTANT_MODE_OPTIONS,
  AUTH_SESSION_TOKEN_STORAGE_KEY,
  CHAT_ID_STORAGE_KEY,
  DEFAULT_FILE_TAG_LABEL,
  DEFAULT_PERSONALIZATION_PREFERENCES,
  LIBRARY_PAGE_HASH,
  LIBRARY_UPLOAD_RULES,
  LOGIN_PAGE_HASH,
  PREFERENCES_DIALOG_TABS,
  PROMPT_ATTACHMENT_RULES,
  SESSION_ID_STORAGE_KEY,
  TEMPORARILY_DISABLED_ASSISTANT_MODES,
  UI_MODE_OPTIONS,
  buildChatNameFromId,
  buildGeneralAssistantPanelContent,
  buildInitialChatList,
  buildPendingAssistantTrailText,
  buildPersonalizationContent,
  buildWebUiHelpContent,
  dedupeStatusTrail,
  formatLibraryUpdatedAt,
  formatScorePercent,
  getAssistantModeMeta,
  getAttachmentColorClass,
  getCurrentUiModeFromInfoText,
  getDialogTabById,
  getFileExtensionFromName,
  getOrCreatePersistentId,
  getPendingAssistantMessage,
  getScoreSeverity,
  isAssistantModeTemporarilyDisabled,
  isKnownAssistantMode,
  normalizeLibraryPathDisplay,
} from "./app-shared.js";

marked.setOptions({
  gfm: true,
  breaks: true,
});

function App() {
  const getInitialView = () => {
    const currentHash = String(window.location.hash || "").trim().toLowerCase();
    if (currentHash === LIBRARY_PAGE_HASH) return "library";
    if (currentHash === ADMIN_PAGE_HASH) return "admin";
    return "chat";
  };
  const buildEnabledTagMapFromDisabledTags = (disabledTags) => {
    const next = {};
    const disabled = Array.isArray(disabledTags) ? disabledTags : [];
    for (const tag of disabled) {
      const normalizedTag = String(tag || "").trim().toLowerCase();
      if (!normalizedTag) continue;
      next[normalizedTag] = false;
    }
    return next;
  };
  const getInitialAssistantMode = () => {
    const fallback = ASSISTANT_MODE_OPTIONS[0].id;
    try {
      const storedMode = String(window.localStorage.getItem(ASSISTANT_MODE_STORAGE_KEY) || "").trim().toLowerCase();
      if (isKnownAssistantMode(storedMode)) {
        return storedMode;
      }
    } catch {
      return fallback;
    }
    return fallback;
  };
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
  const [adminUsersData, setAdminUsersData] = useState([]);
  const [adminUsersNotice, setAdminUsersNotice] = useState("");
  const [isCreateUserDialogOpen, setIsCreateUserDialogOpen] = useState(false);
  const [newUserDraft, setNewUserDraft] = useState({ username: "", displayName: "", role: "users" });
  const [isCreateUserRoleDropdownOpen, setIsCreateUserRoleDropdownOpen] = useState(false);
  const [isCreateUserSubmitting, setIsCreateUserSubmitting] = useState(false);
  const [pendingLibraryUploads, setPendingLibraryUploads] = useState([]);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [libraryUploadDrafts, setLibraryUploadDrafts] = useState([]);
  const [deleteConfirmFile, setDeleteConfirmFile] = useState(null);
  const [deleteConfirmUser, setDeleteConfirmUser] = useState(null);
  const [hasShownReadyGreeting, setHasShownReadyGreeting] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isUnifiedDialogOpen, setIsUnifiedDialogOpen] = useState(false);
  const [activeDialogTab, setActiveDialogTab] = useState("general");
  const [dialogTabPanels, setDialogTabPanels] = useState({});
  const [isDialogTabLoading, setIsDialogTabLoading] = useState(false);
  const [dialogTabError, setDialogTabError] = useState("");
  const [settingsTabError, setSettingsTabError] = useState("");
  const [settingsInputResetTokenByKey, setSettingsInputResetTokenByKey] = useState({});
  const [activeView, setActiveView] = useState(getInitialView);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authenticatedUsername, setAuthenticatedUsername] = useState("");
  const [authenticatedDisplayName, setAuthenticatedDisplayName] = useState("");
  const [authenticatedRole, setAuthenticatedRole] = useState("users");
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginMode, setLoginMode] = useState("signin");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [isLoginPasswordVisible, setIsLoginPasswordVisible] = useState(false);
  const [isNewPasswordVisible, setIsNewPasswordVisible] = useState(false);
  const [isConfirmPasswordVisible, setIsConfirmPasswordVisible] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [isLoginSubmitting, setIsLoginSubmitting] = useState(false);
  const sessionIdRef = useRef(getOrCreatePersistentId(SESSION_ID_STORAGE_KEY, "session"));
  const authSessionTokenRef = useRef("");
  const chatIdRef = useRef(getOrCreatePersistentId(CHAT_ID_STORAGE_KEY, "chat"));
  const [activeChatId, setActiveChatId] = useState(null);
  const [chatList, setChatList] = useState([]);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [volatileChat, setVolatileChat] = useState(null);
  const [openChatMenuId, setOpenChatMenuId] = useState(null);
  const [renameDialogChat, setRenameDialogChat] = useState(null);
  const [renameInputValue, setRenameInputValue] = useState("");
  const [chatFilterDialogChat, setChatFilterDialogChat] = useState(null);
  const [chatTagFilterEnabledByChatId, setChatTagFilterEnabledByChatId] = useState({});
  const [isChatFilterSaving, setIsChatFilterSaving] = useState(false);
  const [deleteConfirmChat, setDeleteConfirmChat] = useState(null);
  const [isChatActionPending, setIsChatActionPending] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [openEvidenceMenuMessageId, setOpenEvidenceMenuMessageId] = useState(null);
  const [openEvidenceMenuPlacement, setOpenEvidenceMenuPlacement] = useState("up");
  const [openEvidenceMenuMaxHeight, setOpenEvidenceMenuMaxHeight] = useState(320);
  const [currentAssistantMode, setCurrentAssistantMode] = useState(getInitialAssistantMode);
  const [isAssistantModeMenuOpen, setIsAssistantModeMenuOpen] = useState(false);
  const [personalizationPreferences, setPersonalizationPreferences] = useState(DEFAULT_PERSONALIZATION_PREFERENCES);
  const [customInstructionsDraft, setCustomInstructionsDraft] = useState("");
  const [isCustomInstructionsDirty, setIsCustomInstructionsDirty] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState("");
  const [occupationDraft, setOccupationDraft] = useState("");
  const [moreAboutUserDraft, setMoreAboutUserDraft] = useState("");
  const [isNicknameDirty, setIsNicknameDirty] = useState(false);
  const [isOccupationDirty, setIsOccupationDirty] = useState(false);
  const [isMoreAboutUserDirty, setIsMoreAboutUserDirty] = useState(false);
  const [tagFilterEnabledByTag, setTagFilterEnabledByTag] = useState({});
  const [isTagFilterSaving, setIsTagFilterSaving] = useState(false);

  const previousEmbeddingReadyRef = useRef(null);
  const pollTimeoutRef = useRef(null);
  const lastMessageRef = useRef(null);
  const composerInputRef = useRef(null);
  const promptFileInputRef = useRef(null);
  const libraryUploadDialogInputRef = useRef(null);
  const menuRef = useRef(null);
  const assistantModeMenuRef = useRef(null);
  const createUserRoleDropdownRef = useRef(null);
  const userMenuRef = useRef(null);
  const volatileChatCreatePromiseRef = useRef(null);
  const sendingStatusPollRef = useRef(null);
  const postLoginHashRef = useRef("");

  const isEmbeddingReady = statusData?.embedding?.readiness?.ready === true;
  const currentUiMode = String(statusData?.app?.uiMode || "clean").toLowerCase();
  const isRagMode = currentUiMode === "rag";
  const healthState = useMemo(() => getOverallHealth(statusData, filesData), [statusData, filesData]);
  const disabledAssistantModesList = useMemo(
    () => Array.from(TEMPORARILY_DISABLED_ASSISTANT_MODES),
    []
  );
  const displayedChatList = volatileChat
    ? [volatileChat].concat(chatList.filter((chat) => chat.id !== volatileChat.id))
    : chatList;
  const activeChainProgress = statusData?.assistant?.chainProgress || null;
  const activeChainStage = String(activeChainProgress?.stage || "").toLowerCase();
  const trimmedLoginUsername = loginUsername.trim();
  const isChangePasswordMode = loginMode === "change-password";
  const doNewPasswordsMatch = newPassword === confirmNewPassword;
  const isLoginFormValid = isChangePasswordMode
    ? trimmedLoginUsername.length >= 4
      && loginPassword.length >= 8
      && newPassword.length >= 8
      && confirmNewPassword.length >= 8
      && doNewPasswordsMatch
    : trimmedLoginUsername.length >= 4 && loginPassword.length >= 8;

  function clearAuthenticatedSessionState() {
    const currentHash = String(window.location.hash || "").trim().toLowerCase();
    if (currentHash === LIBRARY_PAGE_HASH || currentHash === ADMIN_PAGE_HASH) {
      postLoginHashRef.current = currentHash;
    } else if (currentHash !== LOGIN_PAGE_HASH) {
      postLoginHashRef.current = "";
    }
    authSessionTokenRef.current = "";
    try {
      window.localStorage.removeItem(AUTH_SESSION_TOKEN_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    setIsUserMenuOpen(false);
    setIsMenuOpen(false);
    setIsAssistantModeMenuOpen(false);
    setIsUnifiedDialogOpen(false);
    setPanelData(null);
    setDeleteConfirmFile(null);
    setDeleteConfirmUser(null);
    setDeleteConfirmChat(null);
    setIsUploadDialogOpen(false);
    setLibraryUploadDrafts([]);
    setRenameDialogChat(null);
    setChatFilterDialogChat(null);
    setOpenChatMenuId(null);
    setIsAuthenticated(false);
    setAuthenticatedRole("users");
    setAdminUsersData([]);
    setAdminUsersNotice("");
    setIsCreateUserDialogOpen(false);
    setNewUserDraft({ username: "", displayName: "", role: "users" });
    setIsCreateUserSubmitting(false);
    setCurrentAssistantMode(ASSISTANT_MODE_OPTIONS[0].id);
    if (window.location.hash !== LOGIN_PAGE_HASH) {
      window.location.hash = LOGIN_PAGE_HASH;
    }
  }

  const { apiFetch, apiFetchForPreferences } = createApiClient({
    apiBaseUrl: API_BASE_URL,
    getSessionToken: () => authSessionTokenRef.current,
    onUnauthorized: clearAuthenticatedSessionState,
    isAuthenticated: () => Boolean(isAuthenticated && authSessionTokenRef.current),
  });

  async function restoreActiveSession() {
    let storedToken = "";
    try {
      storedToken = String(window.localStorage.getItem(AUTH_SESSION_TOKEN_STORAGE_KEY) || "");
    } catch {
      storedToken = "";
    }
    if (!storedToken) return false;

    authSessionTokenRef.current = storedToken;
    const sessionPath = `/api/auth/session?sessionId=${encodeURIComponent(sessionIdRef.current)}`;
    const response = await apiFetch(sessionPath, {}, { skipAuth: false });
    if (!response.ok) {
      clearAuthenticatedSessionState();
      return false;
    }

    const payload = await response.json().catch(() => ({}));
    const user = payload?.user || {};
    setAuthenticatedUsername(String(user.username || ""));
    setAuthenticatedDisplayName(String(user.displayName || user.username || ""));
    setAuthenticatedRole(String(user.role || "users").trim().toLowerCase() === "admin" ? "admin" : "users");
    setIsAuthenticated(true);
    return true;
  }

  useEffect(() => {
    if (!isSending) {
      return;
    }
    const backendStageTrail = Array.isArray(activeChainProgress?.trail)
      ? activeChainProgress.trail
      : [];
    const normalizedMode = String(activeChainProgress?.mode || currentAssistantMode || "").trim().toLowerCase();
    const mappedBackendTrail = dedupeStatusTrail(backendStageTrail.map((stage) => (
      getPendingAssistantMessage(normalizedMode, stage)
    )));
    const nextPendingText = getPendingAssistantMessage(currentAssistantMode, activeChainStage);
    setMessages((previous) => previous.map((message) => {
      if (!message.isPending || message.role !== "assistant") {
        return message;
      }
      let nextTrail = Array.isArray(message.pendingStatusTrail)
        ? dedupeStatusTrail(message.pendingStatusTrail)
        : [];
      if (mappedBackendTrail.length > 0) {
        nextTrail = mappedBackendTrail;
      } else if (nextTrail[nextTrail.length - 1] !== nextPendingText) {
        nextTrail = dedupeStatusTrail(nextTrail.concat(nextPendingText));
      }
      if (nextTrail.length === 0) {
        nextTrail = [nextPendingText];
      }
      const nextText = buildPendingAssistantTrailText(nextTrail);
      if (message.text === nextText) return message;
      return {
        ...message,
        pendingStatusTrail: nextTrail,
        text: nextText,
      };
    }));
  }, [isSending, currentAssistantMode, activeChainProgress, activeChainStage]);

  useEffect(() => {
    const persistedSettings = statusData?.assistant?.personalization || {};
    const persistedBaseStyleTone = String(persistedSettings.baseStyleTone || "").trim().toLowerCase();
    const persistedWarm = String(persistedSettings.warm || "").trim().toLowerCase();
    const persistedEnthusiastic = String(persistedSettings.enthusiastic || "").trim().toLowerCase();
    const persistedHeadersAndLists = String(persistedSettings.headersAndLists || "").trim().toLowerCase();
    const persistedCustomInstructions = String(persistedSettings.customInstructions || "");
    const persistedNickname = String(persistedSettings.nickname || "");
    const persistedOccupation = String(persistedSettings.occupation || "");
    const persistedMoreAboutUser = String(persistedSettings.moreAboutUser || persistedSettings.aboutUser || "");
    setPersonalizationPreferences((previous) => {
      const nextPreferences = {
        ...previous,
        baseStyleTone: persistedBaseStyleTone || DEFAULT_PERSONALIZATION_PREFERENCES.baseStyleTone,
        warm: persistedWarm || DEFAULT_PERSONALIZATION_PREFERENCES.warm,
        enthusiastic: persistedEnthusiastic || DEFAULT_PERSONALIZATION_PREFERENCES.enthusiastic,
        headersAndLists: persistedHeadersAndLists || DEFAULT_PERSONALIZATION_PREFERENCES.headersAndLists,
        customInstructions: persistedCustomInstructions,
        nickname: persistedNickname,
        occupation: persistedOccupation,
        moreAboutUser: persistedMoreAboutUser,
      };
      if (
        previous.baseStyleTone === nextPreferences.baseStyleTone
        && previous.warm === nextPreferences.warm
        && previous.enthusiastic === nextPreferences.enthusiastic
        && previous.headersAndLists === nextPreferences.headersAndLists
        && previous.customInstructions === nextPreferences.customInstructions
        && previous.nickname === nextPreferences.nickname
        && previous.occupation === nextPreferences.occupation
        && previous.moreAboutUser === nextPreferences.moreAboutUser
      ) return previous;
      return {
        ...nextPreferences,
      };
    });
    if (!isCustomInstructionsDirty) {
      setCustomInstructionsDraft(persistedCustomInstructions);
    }
    if (!isNicknameDirty) {
      setNicknameDraft(persistedNickname);
    }
    if (!isOccupationDirty) {
      setOccupationDraft(persistedOccupation);
    }
    if (!isMoreAboutUserDirty) {
      setMoreAboutUserDraft(persistedMoreAboutUser);
    }
  }, [statusData, isCustomInstructionsDirty, isNicknameDirty, isOccupationDirty, isMoreAboutUserDirty]);

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

  async function submitLogin(event) {
    event?.preventDefault?.();
    if (!isLoginFormValid || isLoginSubmitting) return;

    if (isChangePasswordMode && !doNewPasswordsMatch) {
      setLoginError("New password and confirmation must match.");
      return;
    }

    setLoginError("");
    setIsLoginSubmitting(true);
    try {
      const endpoint = isChangePasswordMode
        ? `${API_BASE_URL}/api/auth/change-password`
        : `${API_BASE_URL}/api/auth/login`;
      const body = isChangePasswordMode
        ? {
          username: trimmedLoginUsername,
          oldPassword: loginPassword,
          newPassword,
          confirmNewPassword,
          sessionId: sessionIdRef.current,
        }
        : {
          username: trimmedLoginUsername,
          password: loginPassword,
          sessionId: sessionIdRef.current,
        };
      const response = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }, { skipAuth: true });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || (isChangePasswordMode ? "Password change failed." : "Sign in failed."));
      }

      const user = payload?.user || {};
      if (payload?.requirePasswordChange === true && !isChangePasswordMode) {
        setLoginMode("change-password");
        setLoginPassword("");
        setNewPassword("");
        setConfirmNewPassword("");
        setLoginError("");
        return;
      }
      const nextSessionToken = String(payload?.session?.sessionToken || "").trim();
      if (!nextSessionToken) {
        throw new Error("Session was not created.");
      }
      authSessionTokenRef.current = nextSessionToken;
      try {
        window.localStorage.setItem(AUTH_SESSION_TOKEN_STORAGE_KEY, nextSessionToken);
      } catch {
        // ignore storage errors
      }
      setAuthenticatedUsername(String(user.username || trimmedLoginUsername));
      setAuthenticatedDisplayName(String(user.displayName || user.username || trimmedLoginUsername));
      setAuthenticatedRole(String(user.role || "users").trim().toLowerCase() === "admin" ? "admin" : "users");
      setIsAuthenticated(true);
      if (window.location.hash === LOGIN_PAGE_HASH) {
        window.location.hash = [LIBRARY_PAGE_HASH, ADMIN_PAGE_HASH].includes(postLoginHashRef.current)
          ? postLoginHashRef.current
          : "";
      }
      setLoginMode("signin");
      setLoginPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
      setLoginError("");
    } catch (error) {
      setLoginError(error.message || (isChangePasswordMode ? "Password change failed." : "Sign in failed."));
    } finally {
      setIsLoginSubmitting(false);
    }
  }

  function handleLogout() {
    setIsUserMenuOpen(false);
    apiFetch(`/api/auth/logout?sessionId=${encodeURIComponent(sessionIdRef.current)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: sessionIdRef.current }),
    }).catch(() => null);
    clearAuthenticatedSessionState();
    setLoginMode("signin");
    setLoginPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setLoginError("");
  }

  function openChangePasswordFlow() {
    const preferredUsername = authenticatedUsername || trimmedLoginUsername;
    clearAuthenticatedSessionState();
    setLoginMode("change-password");
    setLoginUsername(preferredUsername);
    setLoginPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setLoginError("");
  }

  function openInfoFromUserMenu() {
    setIsUserMenuOpen(false);
    openUnifiedDialog("info");
  }

  function openHelpFromUserMenu() {
    setIsUserMenuOpen(false);
    openUnifiedDialog("help");
  }

  function openPreferencesFromUserMenu() {
    setIsUserMenuOpen(false);
    openSettingsDialog();
  }

  useEffect(() => {
    restoreActiveSession().catch(() => {
      clearAuthenticatedSessionState();
    });
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return undefined;

    const pollSession = async () => {
      try {
        const response = await apiFetch(
          `/api/auth/session?sessionId=${encodeURIComponent(sessionIdRef.current)}`
        );
        if (response.ok) {
          const payload = await response.json().catch(() => ({}));
          const user = payload?.user || {};
          setAuthenticatedUsername(String(user.username || ""));
          setAuthenticatedDisplayName(String(user.displayName || user.username || ""));
          setAuthenticatedRole(String(user.role || "users").trim().toLowerCase() === "admin" ? "admin" : "users");
        }
      } catch {
        clearAuthenticatedSessionState();
      }
    };

    const timerId = window.setInterval(pollSession, 60_000);
    return () => window.clearInterval(timerId);
  }, [isAuthenticated]);

  useEffect(() => {
    try {
      if (isKnownAssistantMode(currentAssistantMode)) {
        window.localStorage.setItem(ASSISTANT_MODE_STORAGE_KEY, currentAssistantMode);
      }
    } catch {
      // ignore localStorage write issues (private mode, quota, etc.)
    }
  }, [currentAssistantMode]);

  async function refreshStatus() {
    try {
      const [statusRes, filesRes, libraryRes] = await Promise.all([
        apiFetch(`/api/status?sessionId=${encodeURIComponent(sessionIdRef.current)}`),
        apiFetch(`/api/files?sessionId=${encodeURIComponent(sessionIdRef.current)}`),
        apiFetch(`/api/library/files`),
      ]);

      if (statusRes.ok) {
        const newStatus = await statusRes.json();
        const nextAssistantMode = String(newStatus?.assistant?.mode || "").trim().toLowerCase();
        if (isKnownAssistantMode(nextAssistantMode)) {
          setCurrentAssistantMode(nextAssistantMode);
        }
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

      if (authenticatedRole === "admin") {
        const adminUsersRes = await apiFetch(`/api/admin/users`);
        if (adminUsersRes.ok) {
          const payload = await adminUsersRes.json().catch(() => ({}));
          setAdminUsersData(Array.isArray(payload?.users) ? payload.users : []);
        }
      }
    } catch {
      setStatusData(null);
      setFilesData(null);
      setLibraryManagedData(null);
      setAdminUsersData([]);
    } finally {
      setIsLoadingStatus(false);
    }
  }

  async function loadMessagesFromDb(explicitChatId = null) {
    const sessionId = sessionIdRef.current;
    const chatId = explicitChatId || chatIdRef.current;
    const messageLoadLimit = 40;
    const response = await apiFetch(
      `${API_BASE_URL}/api/messages?sessionId=${encodeURIComponent(sessionId)}&chatId=${encodeURIComponent(chatId)}&limit=${messageLoadLimit}`
    );
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error || "Failed to load messages");
    }

    const normalized = Array.isArray(payload.messages)
      ? payload.messages.map((message) => {
        const metadata = message.metadata && typeof message.metadata === "object" ? message.metadata : {};
        const normalizedText = String(message.content || "").trim()
          || (message.role === "assistant" ? "No answer generated." : "");
        return createMessage(message.role, message.content, {
          text: normalizedText,
          evidenceSeverity: metadata.evidenceSeverity || null,
          responseType: metadata.responseType || null,
          retrieval: metadata.retrieval || null,
          interaction: metadata.interaction || null,
          upload: metadata.upload || null,
          attachedFiles: Array.isArray(metadata.attachedFiles) ? metadata.attachedFiles : [],
        });
      })
      : [];

    setMessages(normalized);
  }

  async function refreshChats({ preferredChatId = null } = {}) {
    const sessionId = sessionIdRef.current;
    setIsLoadingChats(true);
    try {
      let response = await apiFetch(
        `${API_BASE_URL}/api/chats?sessionId=${encodeURIComponent(sessionId)}`
      );
      let payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load chats");
      }

      let nextChats = Array.isArray(payload.chats)
        ? payload.chats.map((chat) => ({
          id: chat.id,
          name: chat.name || buildChatNameFromId(chat.id),
          status: chat.status || "active",
          tagFilters: chat.tagFilters && typeof chat.tagFilters === "object"
            ? chat.tagFilters
            : { disabledTags: [] },
        }))
        : [];

      if (nextChats.length === 0) {
        const createResponse = await apiFetch(`/api/chats`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const createPayload = await createResponse.json().catch(() => ({}));
        if (!createResponse.ok) {
          throw new Error(createPayload?.error || "Failed to create initial chat");
        }

        response = await apiFetch(
          `${API_BASE_URL}/api/chats?sessionId=${encodeURIComponent(sessionId)}`
        );
        payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load chats");
        }
        nextChats = Array.isArray(payload.chats)
          ? payload.chats.map((chat) => ({
            id: chat.id,
            name: chat.name || buildChatNameFromId(chat.id),
            status: chat.status || "active",
            tagFilters: chat.tagFilters && typeof chat.tagFilters === "object"
              ? chat.tagFilters
              : { disabledTags: [] },
          }))
          : [];
      }

      const fallbackChatId = preferredChatId || payload.activeChatId || chatIdRef.current;
      const nextActiveChat = nextChats.find((chat) => chat.id === fallbackChatId)
        ? fallbackChatId
        : (payload.activeChatId || nextChats[0]?.id || null);

      setChatList(nextChats);
      setActiveChatId(nextActiveChat);
      chatIdRef.current = nextActiveChat || "";
      if (nextActiveChat) {
        try {
          window.localStorage.setItem(CHAT_ID_STORAGE_KEY, nextActiveChat);
        } catch {
          // ignore storage write errors
        }
      }
    } finally {
      setIsLoadingChats(false);
    }
  }

  function appendPendingStatusStep(pendingMessageId, stepText) {
    const normalizedStep = String(stepText || "").trim();
    if (!normalizedStep) return;
    setMessages((previous) => previous.map((message) => {
      if (message.id !== pendingMessageId || !message.isPending || message.role !== "assistant") {
        return message;
      }
      const previousTrail = Array.isArray(message.pendingStatusTrail)
        ? dedupeStatusTrail(message.pendingStatusTrail)
        : [];
      if (previousTrail[previousTrail.length - 1] === normalizedStep) {
        return message;
      }
      const nextTrail = dedupeStatusTrail(previousTrail.concat(normalizedStep));
      return {
        ...message,
        pendingStatusTrail: nextTrail,
        text: buildPendingAssistantTrailText(nextTrail),
      };
    }));
  }

  useEffect(() => {
    if (!isAuthenticated) {
      return undefined;
    }

    async function poll() {
      await refreshStatus();
      const delay = previousEmbeddingReadyRef.current ? 8000 : 2000;
      pollTimeoutRef.current = window.setTimeout(poll, delay);
    }

    poll();

    return () => {
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, [hasShownReadyGreeting, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !activeChatId) return;
    loadMessagesFromDb(activeChatId).catch(() => {
      setMessages([]);
    });
  }, [activeChatId, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    refreshChats({ preferredChatId: chatIdRef.current }).catch(() => {
      setChatList([]);
      setActiveChatId(null);
    });
  }, [isAuthenticated]);

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
      const currentHash = String(window.location.hash || "").trim().toLowerCase();
      const isAdmin = authenticatedRole === "admin";
      if (!isAuthenticated) {
        if (currentHash !== LOGIN_PAGE_HASH) {
          if (currentHash === LIBRARY_PAGE_HASH || currentHash === ADMIN_PAGE_HASH) {
            postLoginHashRef.current = currentHash;
          }
          window.location.hash = LOGIN_PAGE_HASH;
        }
        return;
      }
      if (currentHash === LOGIN_PAGE_HASH) {
        window.location.hash = [LIBRARY_PAGE_HASH, ADMIN_PAGE_HASH].includes(postLoginHashRef.current)
          ? postLoginHashRef.current
          : "";
        return;
      }
      if (currentHash === ADMIN_PAGE_HASH && !isAdmin) {
        window.location.hash = "";
        return;
      }
      setActiveView(currentHash === LIBRARY_PAGE_HASH ? "library" : currentHash === ADMIN_PAGE_HASH ? "admin" : "chat");
    }

    syncViewFromHash();
    window.addEventListener("hashchange", syncViewFromHash);
    return () => window.removeEventListener("hashchange", syncViewFromHash);
  }, [authenticatedRole, isAuthenticated]);

  useEffect(() => () => {
    if (sendingStatusPollRef.current) {
      window.clearInterval(sendingStatusPollRef.current);
      sendingStatusPollRef.current = null;
    }
  }, []);

  useEffect(() => {
    function closeMenuOnOutside(event) {
      if (!menuRef.current?.contains(event.target)) {
        setIsMenuOpen(false);
      }
      if (!assistantModeMenuRef.current?.contains(event.target)) {
        setIsAssistantModeMenuOpen(false);
      }
      if (!event.target.closest(".chat-item-actions")) {
        setOpenChatMenuId(null);
      }
      if (!userMenuRef.current?.contains(event.target)) {
        setIsUserMenuOpen(false);
      }
      if (!event.target.closest(".assistant-evidence-wrap")) {
        setOpenEvidenceMenuMessageId(null);
      }
      if (!createUserRoleDropdownRef.current?.contains(event.target)) {
        setIsCreateUserRoleDropdownOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeMenuOnOutside);
    return () => document.removeEventListener("pointerdown", closeMenuOnOutside);
  }, []);

  useEffect(() => {
    if (!isCreateUserDialogOpen) {
      setIsCreateUserRoleDropdownOpen(false);
    }
  }, [isCreateUserDialogOpen]);

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

  function resolveEvidenceMenuLayout(triggerElement) {
    if (!triggerElement || typeof window === "undefined") {
      return { placement: "up", maxHeight: 360 };
    }
    const triggerRect = triggerElement.getBoundingClientRect();
    const viewportPadding = 16;
    const spaceAbove = Math.max(0, triggerRect.top - viewportPadding);
    const spaceBelow = Math.max(0, window.innerHeight - triggerRect.bottom - viewportPadding);
    const comfortableMenuHeight = 320;

    let placement = "up";
    if (spaceBelow >= comfortableMenuHeight && spaceBelow >= spaceAbove) {
      placement = "down";
    } else if (spaceAbove >= comfortableMenuHeight) {
      placement = "up";
    } else {
      placement = spaceBelow > spaceAbove ? "down" : "up";
    }

    const availableSpace = placement === "down" ? spaceBelow : spaceAbove;
    const maxHeight = Math.max(220, Math.min(460, Math.floor(availableSpace)));
    return { placement, maxHeight };
  }

  function toggleEvidenceMenu(messageId, event) {
    setOpenEvidenceMenuMessageId((current) => {
      if (current === messageId) {
        return null;
      }
      const { placement, maxHeight } = resolveEvidenceMenuLayout(event?.currentTarget);
      setOpenEvidenceMenuPlacement(placement);
      setOpenEvidenceMenuMaxHeight(maxHeight);
      return messageId;
    });
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
      notice: "",
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

  function parseLibraryTagInput(input) {
    const raw = String(input || "");
    const normalized = raw
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
    return [...new Set(normalized)];
  }

  async function uploadLibraryFiles(fileDrafts) {
    const isAdminUser = authenticatedRole === "admin";
    const draftsWithTags = fileDrafts.map((draft) => ({
      ...draft,
      parsedTags: parseLibraryTagInput(draft.tagsInput),
    }));
    const queued = draftsWithTags.map((draft) => ({
      tempId: crypto.randomUUID(),
      path: isAdminUser ? draft.file.name : `_library/${draft.file.name}`,
      originalName: draft.file.name,
      uploadStatus: "uploading",
      embedded: false,
      chunkCount: null,
      sizeBytes: draft.file.size,
      extension: getFileExtension(draft.file.name),
      isVolatile: true,
      lastError: null,
      canDelete: false,
      tags: draft.parsedTags.length > 0 ? draft.parsedTags : ["default"],
      updatedAt: new Date().toISOString(),
    }));
    setPendingLibraryUploads((previous) => queued.concat(previous));

    const requestFiles = await Promise.all(draftsWithTags.map(async (draft) => ({
      name: draft.file.name,
      contentBase64: await fileToBase64(draft.file),
      tags: draft.parsedTags,
    })));

    const response = await apiFetch(`/api/library/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: requestFiles }),
    });
    const payload = await response.json().catch(() => ({}));
    const uploadResults = Array.isArray(payload.files)
      ? payload.files
      : fileDrafts.map((draft) => ({
        ok: false,
        fileName: draft.file.name,
        error: payload?.details || payload?.error || "Upload failed",
      }));

    setPendingLibraryUploads((previous) => previous.map((row) => {
      const result = uploadResults.find((item) => item.fileName === row.originalName);
      if (!result) return row;
      if (!result.ok) {
        return {
          ...row,
          uploadStatus: "error",
          lastError: result.error || "Upload failed",
          canDelete: false,
          updatedAt: new Date().toISOString(),
        };
      }
      return {
        ...row,
        path: result.file?.path || row.path,
        tags: Array.isArray(result.file?.tags) ? result.file.tags : row.tags,
        uploadStatus: "embedding",
        canDelete: true,
        updatedAt: new Date().toISOString(),
      };
    }));

    const failed = uploadResults.filter((result) => !result.ok).length;
    const firstFailure = uploadResults.find((result) => !result.ok);
    setLibraryNotice(
      failed > 0
        ? `${failed} upload${failed > 1 ? "s" : ""} failed.${firstFailure?.error ? ` ${firstFailure.error}` : ""}`
        : `Uploaded ${uploadResults.length} file${uploadResults.length > 1 ? "s" : ""}. Embedding started.`
    );

    await refreshStatus();
  }

  function openLibraryUploadDialog() {
    setLibraryUploadDrafts([]);
    setIsUploadDialogOpen(true);
  }

  function closeLibraryUploadDialog() {
    setIsUploadDialogOpen(false);
    setLibraryUploadDrafts([]);
    if (libraryUploadDialogInputRef.current) {
      libraryUploadDialogInputRef.current.value = "";
    }
  }

  function handleLibraryUploadDraftSelection(event) {
    const selectedFiles = Array.from(event.target.files || []);
    event.target.value = "";

    const validation = validateLibraryUploads(selectedFiles);
    setLibraryNotice(validation.notice);
    if (validation.validFiles.length === 0) {
      return;
    }
    setLibraryUploadDrafts(validation.validFiles.map((file) => ({
      id: crypto.randomUUID(),
      file,
      tagsInput: "",
    })));
  }

  function setLibraryDraftTags(draftId, nextInput) {
    setLibraryUploadDrafts((previous) => previous.map((draft) => (
      draft.id === draftId ? { ...draft, tagsInput: nextInput } : draft
    )));
  }

  async function confirmLibraryUploadDialog() {
    if (libraryUploadDrafts.length === 0) {
      return;
    }
    await uploadLibraryFiles(libraryUploadDrafts);
    closeLibraryUploadDialog();
  }

  async function confirmDeleteLibraryFile() {
    const target = deleteConfirmFile;
    setDeleteConfirmFile(null);
    if (!target?.path) {
      return;
    }

    try {
      setLibraryManagedData((previous) => {
        if (!previous?.files) return previous;
        return {
          ...previous,
          files: previous.files.map((entry) => (
            entry.path === target.path
              ? { ...entry, uploadStatus: "removing" }
              : entry
          )),
        };
      });
      const response = await apiFetch(`/api/library/files?path=${encodeURIComponent(target.path)}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Delete failed.");
      }
      const removedVectors = Number(payload?.removedVectors);
      const removedSuffix = Number.isFinite(removedVectors) && removedVectors >= 0
        ? ` Removed ${removedVectors} vector chunk${removedVectors === 1 ? "" : "s"}.`
        : "";
      setLibraryNotice(`Deleted ${target.path}.${removedSuffix}`);
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

    const nextEnabled = action === "activate";
    setLibraryNotice(action === "disable" ? `Disabling ${file.path}...` : `Activating ${file.path}...`);
    setLibraryManagedData((previous) => {
      if (!previous?.files) return previous;
      return {
        ...previous,
        files: previous.files.map((entry) => (
          entry.path === file.path
            ? { ...entry, enabled: nextEnabled }
            : entry
        )),
      };
    });

    try {
      const response = await apiFetch(`/api/library/files`, {
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

  async function updateAdminUser(username, updates) {
    const normalizedUsername = String(username || "").trim();
    if (!normalizedUsername) return;
    try {
      const response = await apiFetch(`/api/admin/users/${encodeURIComponent(normalizedUsername)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "User update failed.");
      }
      const nextUser = payload?.user;
      if (nextUser?.username) {
        setAdminUsersData((previous) => previous.map((entry) => (
          entry.username === nextUser.username ? nextUser : entry
        )));
      }
      setAdminUsersNotice("");
    } catch (error) {
      setAdminUsersNotice(error.message || "User update failed.");
      await refreshStatus();
    }
  }

  function openCreateUserDialog() {
    setNewUserDraft({ username: "", displayName: "", role: "users" });
    setAdminUsersNotice("");
    setIsCreateUserDialogOpen(true);
  }

  function closeCreateUserDialog() {
    if (isCreateUserSubmitting) return;
    setIsCreateUserDialogOpen(false);
    setNewUserDraft({ username: "", displayName: "", role: "users" });
  }

  async function confirmCreateUser() {
    if (isCreateUserSubmitting) return;
    const username = String(newUserDraft.username || "").trim();
    const displayName = String(newUserDraft.displayName || "").trim();
    const role = String(newUserDraft.role || "users").trim().toLowerCase() === "admin" ? "admin" : "users";
    if (username.length < 4 || displayName.length < 2) {
      setAdminUsersNotice("Please provide a valid username and display name.");
      return;
    }

    setIsCreateUserSubmitting(true);
    try {
      const response = await apiFetch(`/api/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, displayName, role }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "User creation failed.");
      }
      setAdminUsersNotice(`Created user ${username}.`);
      setIsCreateUserDialogOpen(false);
      setNewUserDraft({ username: "", displayName: "", role: "users" });
      await refreshStatus();
    } catch (error) {
      setAdminUsersNotice(error.message || "User creation failed.");
    } finally {
      setIsCreateUserSubmitting(false);
    }
  }

  async function confirmDeleteAdminUser() {
    const target = deleteConfirmUser;
    setDeleteConfirmUser(null);
    const normalizedUsername = String(target?.username || "").trim();
    if (!normalizedUsername) return;

    try {
      const response = await apiFetch(`/api/admin/users/${encodeURIComponent(normalizedUsername)}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Delete failed.");
      }
      setAdminUsersData((previous) => previous.filter((entry) => entry.username !== normalizedUsername));
      setAdminUsersNotice(`Deleted ${normalizedUsername}.`);
    } catch (error) {
      setAdminUsersNotice(error.message || "Delete failed.");
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

    if (volatileChat && chatIdRef.current === volatileChat.id) {
      try {
        if (!volatileChatCreatePromiseRef.current) {
          volatileChatCreatePromiseRef.current = (async () => {
            const response = await apiFetch(`/api/chats`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: sessionIdRef.current,
                chatId: volatileChat.id,
                name: volatileChat.name,
              }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok && response.status !== 409) {
              throw new Error(payload?.error || "Failed to create chat");
            }
          })();
        }
        await volatileChatCreatePromiseRef.current;
        setVolatileChat(null);
        await refreshChats({ preferredChatId: volatileChat.id });
      } catch (error) {
        setMessages((prev) => prev.concat(createMessage("assistant", `Error: ${error.message}`, {
          evidenceSeverity: "error",
          isVolatile: true,
        })));
        return;
      } finally {
        volatileChatCreatePromiseRef.current = null;
      }
    }

    setIsSending(true);
    if (sendingStatusPollRef.current) {
      window.clearInterval(sendingStatusPollRef.current);
    }
    sendingStatusPollRef.current = window.setInterval(() => {
      refreshStatus().catch(() => {});
    }, 250);
    refreshStatus().catch(() => {});
    const pendingMessageId = crypto.randomUUID();
    const initialPendingText = getPendingAssistantMessage(currentAssistantMode, "searching");
    setMessages((prev) => prev.concat(createMessage(
      "assistant",
      initialPendingText,
      {
        id: pendingMessageId,
        isPending: true,
        pendingStatusTrail: [initialPendingText],
      }
    )));
    const fallbackStepTimers = [];
    const normalizedAssistantMode = String(currentAssistantMode || "").trim().toLowerCase();
    if (normalizedAssistantMode === "refine") {
      fallbackStepTimers.push(window.setTimeout(() => {
        appendPendingStatusStep(pendingMessageId, getPendingAssistantMessage("refine", "drafting"));
      }, 550));
      fallbackStepTimers.push(window.setTimeout(() => {
        appendPendingStatusStep(pendingMessageId, getPendingAssistantMessage("refine", "refining"));
      }, 1300));
    } else if (normalizedAssistantMode === "thinking") {
      fallbackStepTimers.push(window.setTimeout(() => {
        appendPendingStatusStep(pendingMessageId, getPendingAssistantMessage("thinking", "analyse_plan"));
      }, 450));
      fallbackStepTimers.push(window.setTimeout(() => {
        appendPendingStatusStep(pendingMessageId, getPendingAssistantMessage("thinking", "drafting"));
      }, 1100));
      fallbackStepTimers.push(window.setTimeout(() => {
        appendPendingStatusStep(pendingMessageId, getPendingAssistantMessage("thinking", "refining"));
      }, 1900));
    } else {
      fallbackStepTimers.push(window.setTimeout(() => {
        appendPendingStatusStep(pendingMessageId, getPendingAssistantMessage("simple", "single_pass"));
      }, 650));
    }

    let shouldReloadFromDb = true;
    try {
      if (isPanelCommand && hasPromptFiles) {
        throw new Error("File attachments are only supported for normal chat prompts, not slash commands.");
      }

      const uploadedFilesPayload = isPanelCommand ? [] : await buildUploadedFilesPayload(selectedPromptFiles);
      const response = await apiFetch(`/api/prompt`, {
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

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 504) {
          throw new Error("Request timed out before the assistant finished. Please retry or ask a shorter prompt.");
        }
        throw new Error(payload?.error || `Request failed (${response.status})`);
      }

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
      shouldReloadFromDb = false;
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
      for (const timerId of fallbackStepTimers) {
        window.clearTimeout(timerId);
      }
      if (sendingStatusPollRef.current) {
        window.clearInterval(sendingStatusPollRef.current);
        sendingStatusPollRef.current = null;
      }
      setIsSending(false);
      if (shouldReloadFromDb) {
        await loadMessagesFromDb().catch(() => {});
      }
      await refreshStatus();
    }
  }

  async function fetchPanelCommand(command) {
    const response = await apiFetch(`/api/prompt`, {
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
    const selectedTab = getDialogTabById(tabId);
    const existingPanel = dialogTabPanels[selectedTab.id];
    setActiveDialogTab(selectedTab.id);
    setDialogTabError("");
    if (selectedTab.id === "settings") {
      setSettingsTabError("");
    }
    if (existingPanel && !forceReload) return;

    if (!isEmbeddingReady) return;
    setIsSending(true);
    setIsDialogTabLoading(true);

    try {
      let nextPanel = null;
      if (selectedTab.id === "general") {
        const [assistantPayload, infoPayload] = await Promise.all([
          fetchPanelCommand("/assistant"),
          fetchPanelCommand("/info"),
        ]);
        nextPanel = {
          id: crypto.randomUUID(),
          command: "/general",
          title: "General",
          content: {
            ui: {
              currentMode: getCurrentUiModeFromInfoText(infoPayload.answer || ""),
              modes: UI_MODE_OPTIONS,
            },
            assistant: buildGeneralAssistantPanelContent(assistantPayload.answer || "", statusData, currentAssistantMode),
          },
          severity: null,
          responseType: null,
          configView: null,
        };
      } else if (selectedTab.id === "personalization") {
        nextPanel = {
          id: crypto.randomUUID(),
          command: "/personalization",
          title: "Personalization",
          content: buildPersonalizationContent(personalizationPreferences),
          severity: null,
          responseType: null,
          configView: null,
        };
      } else if (selectedTab.id === "archive") {
        const response = await apiFetchForPreferences(
          `${API_BASE_URL}/api/chats?sessionId=${encodeURIComponent(sessionIdRef.current)}&includeArchived=true`,
          {},
          "Archive preferences"
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to load archived chats");
        }
        const archivedRows = Array.isArray(payload.chats)
          ? payload.chats
            .filter((chat) => chat.status === "archived")
            .map((chat) => ({
              id: chat.id,
              name: chat.name || buildChatNameFromId(chat.id),
              archivedAt: chat.archivedAt || null,
            }))
          : [];
        nextPanel = {
          id: crypto.randomUUID(),
          command: "/archive",
          title: "Archive",
          content: {
            rows: archivedRows,
          },
          severity: null,
          responseType: null,
          configView: null,
        };
      } else if (selectedTab.id === "filter") {
        nextPanel = {
          id: crypto.randomUUID(),
          command: "/filter",
          title: "Filter",
          content: null,
          severity: null,
          responseType: null,
          configView: null,
        };
      } else if (selectedTab.id === "help") {
        nextPanel = {
          id: crypto.randomUUID(),
          command: "/help",
          title: "Help",
          content: buildWebUiHelpContent(),
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
    setIsAssistantModeMenuOpen(false);
    setPanelData(null);
    setIsUnifiedDialogOpen(true);
    await loadUnifiedDialogTab(tabId);
  }

  async function openPersonalizationPanel() {
    await openUnifiedDialog("personalization");
  }

  async function toggleTagFilter(tag) {
    const normalizedTag = String(tag || "").trim().toLowerCase();
    if (!normalizedTag || isTagFilterSaving) return;
    const currentlyEnabled = tagFilterEnabledByTag[normalizedTag] ?? true;
    try {
      setIsTagFilterSaving(true);
      const response = await apiFetchForPreferences(`/api/files/tag-filters`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          tag: normalizedTag,
          enabled: !currentlyEnabled,
        }),
      }, "Filter preferences");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save tag filter");
      }
      await refreshStatus();
    } catch (error) {
      setMessages((previous) => previous.concat(createMessage("assistant", `Error: ${error.message}`, {
        evidenceSeverity: "error",
        isVolatile: true,
      })));
    } finally {
      setIsTagFilterSaving(false);
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

    if (activeCommand === "/general") {
      const [assistantPayload, infoPayload] = await Promise.all([
        fetchPanelCommand("/assistant"),
        fetchPanelCommand("/info"),
      ]);

      setPanelData({
        id: crypto.randomUUID(),
        command: "/general",
        title: "General",
        content: {
          ui: {
            currentMode: getCurrentUiModeFromInfoText(infoPayload.answer || ""),
            modes: UI_MODE_OPTIONS,
          },
          assistant: buildGeneralAssistantPanelContent(assistantPayload.answer || "", statusData, currentAssistantMode),
        },
        severity: null,
        responseType: null,
        configView: null,
      });
      return;
    }

    if (activeCommand === "/personalization") {
      setPanelData({
        id: crypto.randomUUID(),
        command: "/personalization",
        title: "Personalization",
        content: buildPersonalizationContent(personalizationPreferences),
        severity: null,
        responseType: null,
        configView: null,
      });
    }
  }

  async function applyPersonalizationChange(kind, selectedId) {
    if (isSending || !isEmbeddingReady) return;
    if (kind === "assistant" && isAssistantModeTemporarilyDisabled(selectedId)) return;
    if (kind.startsWith("personalization:")) {
      const settingKey = kind.replace("personalization:", "");
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_PERSONALIZATION_PREFERENCES, settingKey)) return;
      let nextPreferences = null;
      setPersonalizationPreferences((previous) => {
        nextPreferences = {
          ...previous,
          [settingKey]: selectedId,
        };
        return nextPreferences;
      });
      const effectivePreferences = nextPreferences || {
        ...personalizationPreferences,
        [settingKey]: selectedId,
      };
      setDialogTabPanels((previousPanels) => {
        const personalizationPanel = previousPanels.personalization;
        if (!personalizationPanel) return previousPanels;
        return {
          ...previousPanels,
          personalization: {
            ...personalizationPanel,
            content: buildPersonalizationContent(effectivePreferences),
          },
        };
      });
      if (panelData?.command === "/personalization") {
        setPanelData((previousPanel) => {
          if (!previousPanel) return previousPanel;
          return {
            ...previousPanel,
            content: buildPersonalizationContent(effectivePreferences),
          };
        });
      }

      setIsSending(true);
      try {
        const response = await apiFetchForPreferences(`/api/personalization`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            [settingKey]: selectedId,
          }),
        }, "Personalization preferences");
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload?.error || "Failed to save personalization setting");
        }
        await refreshStatus();
      } catch (error) {
        setMessages((prev) => prev.concat(createMessage("assistant", `Error: ${error.message}`, {
          evidenceSeverity: "error",
          isVolatile: true,
        })));
      } finally {
        setIsSending(false);
      }
      return;
    }

    const command = kind === "assistant"
      ? `/assistant ${selectedId}`
      : `/mode ${selectedId}`;

    setIsSending(true);
    try {
      await fetchPanelCommand(command);
      if (kind === "assistant") {
        setCurrentAssistantMode(getAssistantModeMeta(selectedId).id);
        setIsAssistantModeMenuOpen(false);
      }
      if (isUnifiedDialogOpen) {
        setDialogTabPanels((previous) => {
          const nextPanels = { ...previous };
          delete nextPanels.general;
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

  function updateCustomInstructionsDraft(value) {
    const nextDraft = String(value || "");
    setCustomInstructionsDraft(nextDraft);
    setIsCustomInstructionsDirty(nextDraft !== String(personalizationPreferences.customInstructions || ""));
  }

  function updateNicknameDraft(value) {
    const nextDraft = String(value || "");
    setNicknameDraft(nextDraft);
    setIsNicknameDirty(nextDraft !== String(personalizationPreferences.nickname || ""));
  }

  function updateOccupationDraft(value) {
    const nextDraft = String(value || "");
    setOccupationDraft(nextDraft);
    setIsOccupationDirty(nextDraft !== String(personalizationPreferences.occupation || ""));
  }

  function updateMoreAboutUserDraft(value) {
    const nextDraft = String(value || "");
    setMoreAboutUserDraft(nextDraft);
    setIsMoreAboutUserDirty(nextDraft !== String(personalizationPreferences.moreAboutUser || ""));
  }

  async function saveCustomInstructions() {
    if (isSending || !isEmbeddingReady || !isCustomInstructionsDirty) return;
    setIsSending(true);
    try {
      const response = await apiFetchForPreferences(`/api/personalization`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          customInstructions: customInstructionsDraft,
        }),
      }, "Personalization preferences");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save custom instructions");
      }
      const savedCustomInstructions = String(payload?.settings?.customInstructions || "");
      setPersonalizationPreferences((previous) => ({
        ...previous,
        customInstructions: savedCustomInstructions,
      }));
      setCustomInstructionsDraft(savedCustomInstructions);
      setIsCustomInstructionsDirty(false);
      await refreshStatus();
    } catch (error) {
      setMessages((prev) => prev.concat(createMessage("assistant", `Error: ${error.message}`, {
        evidenceSeverity: "error",
        isVolatile: true,
      })));
    } finally {
      setIsSending(false);
    }
  }

  async function saveAboutYouSetting(settingKey, draftValue, setDirtyState) {
    if (isSending || !isEmbeddingReady) return;
    setIsSending(true);
    try {
      const response = await apiFetchForPreferences(`/api/personalization`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          [settingKey]: draftValue,
        }),
      }, "Personalization preferences");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save about-you setting");
      }
      const savedValue = String(payload?.settings?.[settingKey] || "");
      setPersonalizationPreferences((previous) => ({
        ...previous,
        [settingKey]: savedValue,
      }));
      if (settingKey === "nickname") {
        setNicknameDraft(savedValue);
      } else if (settingKey === "occupation") {
        setOccupationDraft(savedValue);
      } else if (settingKey === "moreAboutUser") {
        setMoreAboutUserDraft(savedValue);
      }
      setDirtyState(false);
      await refreshStatus();
    } catch (error) {
      setMessages((prev) => prev.concat(createMessage("assistant", `Error: ${error.message}`, {
        evidenceSeverity: "error",
        isVolatile: true,
      })));
    } finally {
      setIsSending(false);
    }
  }

  async function saveNickname() {
    if (!isNicknameDirty) return;
    await saveAboutYouSetting("nickname", nicknameDraft, setIsNicknameDirty);
  }

  async function saveOccupation() {
    if (!isOccupationDirty) return;
    await saveAboutYouSetting("occupation", occupationDraft, setIsOccupationDirty);
  }

  async function saveMoreAboutUser() {
    if (!isMoreAboutUserDirty) return;
    await saveAboutYouSetting("moreAboutUser", moreAboutUserDraft, setIsMoreAboutUserDirty);
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

  function removeAttachedPromptFile(targetIndex) {
    setAttachedPromptFiles((previous) => previous.filter((_, index) => index !== targetIndex));
    setAttachmentNotice("");
  }

  async function submitConfigChange(configName, rawValue) {
    const normalizedName = String(configName || "").trim().toLowerCase();
    const value = String(rawValue || "").trim();
    if (!value) return;

    const getEditableConfigValue = (key) => {
      const entry = editableConfigRows.find((row) => String(row?.key || "").trim().toLowerCase() === key);
      return entry?.value;
    };
    const parseStrictInteger = (input) => (/^\d+$/.test(input) ? Number.parseInt(input, 10) : null);
    const parseCosineInput = (input) => {
      if (!/^0[.,]\d{2}$/.test(input)) return null;
      const parsed = Number.parseFloat(input.replace(",", "."));
      return Number.isFinite(parsed) ? parsed : null;
    };

    let validationError = "";
    if (normalizedName === "history messages") {
      const parsed = parseStrictInteger(value);
      if (parsed === null || parsed < 1 || parsed > 5) {
        validationError = "History messages must be an integer between 1 and 5.";
      }
    } else if (normalizedName === "min similarities") {
      const parsed = parseStrictInteger(value);
      const currentMax = Number(getEditableConfigValue("max similarities"));
      if (parsed === null || parsed < 2 || parsed > 8) {
        validationError = "Min similarities must be an integer between 2 and 8.";
      } else if (Number.isFinite(currentMax) && parsed > currentMax) {
        validationError = `Min similarities must be less than or equal to max similarities (${currentMax}).`;
      }
    } else if (normalizedName === "max similarities") {
      const parsed = parseStrictInteger(value);
      const currentMin = Number(getEditableConfigValue("min similarities"));
      if (parsed === null || parsed < 2 || parsed > 8) {
        validationError = "Max similarities must be an integer between 2 and 8.";
      } else if (Number.isFinite(currentMin) && parsed < currentMin) {
        validationError = `Max similarities must be greater than or equal to min similarities (${currentMin}).`;
      }
    } else if (normalizedName === "cosine limit") {
      const parsed = parseCosineInput(value);
      if (parsed === null || parsed < 0.45 || parsed > 0.85) {
        validationError = "Cosine limit must be a decimal formatted as 0.xx (comma or point) between 0.45 and 0.85.";
      }
    }

    if (validationError) {
      setSettingsTabError(validationError);
      setSettingsInputResetTokenByKey((previous) => ({
        ...previous,
        [normalizedName]: (previous[normalizedName] || 0) + 1,
      }));
      return;
    }

    setSettingsTabError("");
    setIsSending(true);
    try {
      const payload = await fetchPanelCommand(`/config set '${configName}' ${value}`);
      const nextPanel = buildPanelDataFromCommand("/config", payload);
      if (nextPanel) {
        setDialogTabPanels((previous) => ({ ...previous, settings: nextPanel }));
        if (panelData?.command === "/config") {
          setPanelData(nextPanel);
        }
      }
      await refreshStatus();
    } catch (error) {
      setSettingsTabError(error.message || "Failed to apply setting.");
      setSettingsInputResetTokenByKey((previous) => ({
        ...previous,
        [normalizedName]: (previous[normalizedName] || 0) + 1,
      }));
    } finally {
      setIsSending(false);
    }
  }

  const icon = (path) => React.createElement(
    "svg",
    { viewBox: "0 0 24 24", className: "icon", "aria-hidden": "true" },
    React.createElement("path", { d: path })
  );
  const chatIconPath = "M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-4.5 3V17H6a2 2 0 0 1-2-2zm4 2h8v2H8zm0 4h5v2H8z";
  const adminIconPath = "M12 2 4 5v6c0 5.2 3.4 9.9 8 11 4.6-1.1 8-5.8 8-11V5zm0 8.3A2.7 2.7 0 1 1 12 5a2.7 2.7 0 0 1 0 5.3m0 8.7c-2.3-.7-4.1-2.4-5.1-4.7a6.8 6.8 0 0 1 10.2 0A8.6 8.6 0 0 1 12 19";
  const libraryIconPath = "M4 6a3 3 0 0 1 3-3h13v16H7a2 2 0 0 0-2 2H4zm2 0v11.2A4 4 0 0 1 7 17h11V5H7a1 1 0 0 0-1 1";
  const plusChatIconPath = "M12 4a1 1 0 0 1 1 1v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5a1 1 0 0 1 1-1";
  const settingsIconPath = "M19.14 12.94a7.14 7.14 0 0 0 .05-.94 7.14 7.14 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.14 7.14 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.14 7.14 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.14 7.14 0 0 0-.05.94 7.14 7.14 0 0 0 .05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.59-.23 1.13-.55 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5";
  const fileUploadIconPath = "M11 18h2v-8h3l-4-4-4 4h3zm-6 2h14v-2H5z";
  const trashIconPath = "M9 3h6l1.4 2H20a1 1 0 1 1 0 2h-1v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V7H4a1 1 0 1 1 0-2h3.6zM7 7v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V7zm3 3a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1m4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1";
  const eyeIconPath = "M12 2v3a7 7 0 0 1 6.5 9.5l1.8 1.8A10 10 0 0 0 14 2.4V1zm0 20v-3a7 7 0 0 1-6.5-9.5l-1.8-1.8A10 10 0 0 0 10 21.6V23zm9.2-12.7A10 10 0 0 1 12 19v3l6-6h-3a7 7 0 0 0 6.2-6.7zM2.8 14.7A10 10 0 0 1 12 5V2L6 8h3a7 7 0 0 0-6.2 6.7z";
  const eyeOffIconPath = "M12 2v3a7 7 0 0 1 6.5 9.5l1.8 1.8A10 10 0 0 0 14 2.4V1zm0 20v-3a7 7 0 0 1-6.5-9.5l-1.8-1.8A10 10 0 0 0 10 21.6V23zm9.2-12.7A10 10 0 0 1 12 19v3l6-6h-3a7 7 0 0 0 6.2-6.7zM2.8 14.7A10 10 0 0 1 12 5V2L6 8h3a7 7 0 0 0-6.2 6.7zM3.7 2.3 2.3 3.7l18 18 1.4-1.4z";
  const disableFileIconPath = "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m0 2a8 8 0 0 1 6.2 13L7 5.8A8 8 0 0 1 12 4m-6.2 3L17 18.2A8 8 0 0 1 5.8 7";
  const enableFileIconPath = "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m-1.1 14.6L6.7 12.4l1.4-1.4 2.8 2.8 5.8-5.8 1.4 1.4z";
  const keepIconPath = "M9.6 16.6 5.4 12.4l1.4-1.4 2.8 2.8 7.6-7.6 1.4 1.4z";
  const downloadIconPath = "M12 3a1 1 0 0 1 1 1v8.6l2.3-2.3 1.4 1.4-4.7 4.7-4.7-4.7 1.4-1.4 2.3 2.3V4a1 1 0 0 1 1-1M4 17h16v4H4z";
  const dotsIconPath = "M6 12a1.5 1.5 0 1 0 0 .01V12m6 0a1.5 1.5 0 1 0 0 .01V12m6 0a1.5 1.5 0 1 0 0 .01V12";
  const renameIconPath = "M4 17.2V20h2.8l8.2-8.2-2.8-2.8zm13.7-8.4a1 1 0 0 0 0-1.4l-1.1-1.1a1 1 0 0 0-1.4 0l-1.2 1.2 2.8 2.8z";
  const filterIconPath = "M4 5h16l-6 7v6l-4 2v-8z";
  const archiveIconPath = "M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v2A2.5 2.5 0 0 1 18.5 11H18v7.5A2.5 2.5 0 0 1 15.5 21h-7A2.5 2.5 0 0 1 6 18.5V11h-.5A2.5 2.5 0 0 1 3 8.5zm2.5-.5a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5zM8 11v7.5a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V11zm2 2h4v2h-4z";
  const unarchiveIconPath = "M3 8a2 2 0 0 1 2-2h5.2a2 2 0 0 1 1.4.6l1.1 1.1a2 2 0 0 0 1.4.6H19a2 2 0 0 1 2 2v6.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5zm7.8-4.8a2 2 0 0 1 1.4-.6h6.8v2h-6.8a2 2 0 0 1-1.4-.6L9.9 3h-4V1h4.4a2 2 0 0 1 1.4.6z";
  const infoIconPath = "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m0 4a1.25 1.25 0 1 1-1.25 1.25A1.25 1.25 0 0 1 12 6m1.5 12h-3v-2h1V11h-1V9h3v7h1z";
  const questionIconPath = "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m0 16a1.25 1.25 0 1 1 1.25-1.25A1.25 1.25 0 0 1 12 18m2.2-7.3-.9.7c-.7.5-1 1-1 1.8V14h-2v-.8c0-1.2.5-2.2 1.6-2.9l1-.7c.6-.4 1-.9 1-1.5a2 2 0 1 0-4 0H8a4 4 0 1 1 8 0c0 1.1-.6 2-1.8 2.9";
  const rescueRingIconPath = "M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2m0 2a8 8 0 0 1 5.3 2l-2 2A5.2 5.2 0 0 0 12 6.8zm6.7 3.3A8 8 0 0 1 20 12a8 8 0 0 1-1.3 4.7l-2-2A5.2 5.2 0 0 0 17.2 12c0-1-.3-2-.8-2.7zM12 17.2a5.2 5.2 0 0 0 3.3-1.2l2 2A8 8 0 0 1 12 20a8 8 0 0 1-5.3-2l2-2a5.2 5.2 0 0 0 3.3 1.2M7.3 14.7l-2 2A8 8 0 0 1 4 12c0-1.7.5-3.3 1.3-4.7l2 2a5.2 5.2 0 0 0-.5 2.7c0 1 .2 2 .5 2.7M12 9.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4";
  const keyIconPath = "M14.5 4a5.5 5.5 0 0 0-5.4 6.5L3 16.6V21h4.4l1.8-1.8V17h2.2l1.8-1.8a5.5 5.5 0 1 0 1.3-11.2m0 2a3.5 3.5 0 1 1-3.5 3.5A3.5 3.5 0 0 1 14.5 6";
  const logoutIconPath = "M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-3h-2v3H6V5h9v3h2V5a2 2 0 0 0-2-2m-1.6 12.4L12 14l2.6-2.6H8v-2h6.6L12 6.8l1.4-1.4L18.4 11z";
  const sourceFileIconPath = "M7 3h7l5 5v13H7zm7 1.8V9h4.2zM10 13h6v1.6h-6zm0 3h6v1.6h-6z";
  const userIconPath = "M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12m0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5";
  const chevronDownIconPath = "M7.4 9.8a1 1 0 0 1 1.4 0L12 13l3.2-3.2a1 1 0 1 1 1.4 1.4l-3.9 3.9a1 1 0 0 1-1.4 0l-3.9-3.9a1 1 0 0 1 0-1.4";
  const checkIconPath = "M9.2 16.2 4.8 11.8l1.4-1.4 3 3 8-8 1.4 1.4z";
  const xIconPath = "M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7l-1.4-1.4L9.2 12 2.9 5.7l1.4-1.4 6.3 6.3 6.3-6.3z";
  const getDialogTabIcon = (tabId) => {
    if (tabId === "personalization") return icon(userIconPath);
    if (tabId === "settings") return icon("M4 7h10v2H4zm0 8h10v2H4zm12-9h4v4h-4zm0 8h4v4h-4z");
    if (tabId === "filter") return icon(filterIconPath);
    if (tabId === "info") return icon(infoIconPath);
    if (tabId === "archive") return icon(archiveIconPath);
    if (tabId === "help") return icon(questionIconPath);
    return icon(settingsIconPath);
  };
  const renderAttachmentChip = ({ fileName, index, keyPrefix, removable = false, onRemove = null, className = "" }) => {
    const name = String(fileName || "").trim() || `Attachment ${index + 1}`;
    const extension = getFileExtensionFromName(name);
    const iconColorClass = getAttachmentColorClass(name);
    return React.createElement(
      "div",
      { className: `composer-attachment-chip ${className}`.trim(), key: `${keyPrefix}-${name}-${index}` },
      removable
        ? React.createElement(
          "button",
          {
            type: "button",
            className: "composer-attachment-remove",
            onClick: () => onRemove?.(index),
            "aria-label": `Remove ${name}`,
            title: `Remove ${name}`,
          },
          "×"
        )
        : null,
      React.createElement(
        "div",
        { className: `composer-attachment-icon ${iconColorClass}`, "aria-hidden": "true" },
        React.createElement(
          "svg",
          { viewBox: "0 0 24 24", className: "composer-attachment-icon-svg" },
          React.createElement("path", { d: sourceFileIconPath })
        )
      ),
      React.createElement(
        "div",
        { className: "composer-attachment-meta" },
        React.createElement("p", { className: "composer-attachment-name", title: name }, name),
        React.createElement("p", { className: "composer-attachment-ext" }, extension ? extension.toUpperCase() : "FILE")
      )
    );
  };
  const renderComposerAttachmentChip = (file, index) => renderAttachmentChip({
    fileName: file?.name,
    index,
    keyPrefix: "composer-attachment",
    removable: true,
    onRemove: removeAttachedPromptFile,
  });
  const renderAssistantMarkdown = (text) => {
    const rendered = marked.parse(String(text || ""));
    const sanitized = DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } });
    return React.createElement("div", {
      className: "assistant-markdown",
      dangerouslySetInnerHTML: { __html: sanitized },
    });
  };
  const renderPendingAssistantTrail = (message) => {
    const trail = dedupeStatusTrail(message?.pendingStatusTrail);
    if (trail.length === 0) {
      return renderAssistantMarkdown(message?.text || "Assistant is thinking…");
    }
    return React.createElement(
      "div",
      { className: "assistant-pending-trail", role: "status", "aria-live": "polite" },
      ...trail.map((step, index) => {
        const isLast = index === trail.length - 1;
        return React.createElement(
          "div",
          { key: `${message.id}-pending-step-${index}`, className: `assistant-pending-step ${isLast ? "active" : "done"}` },
          React.createElement("span", { className: "assistant-pending-step-label" }, step),
          isLast
            ? null
            : React.createElement("span", { className: "assistant-pending-step-check", "aria-hidden": "true" }, "✓")
        );
      })
    );
  };

  const activeUnifiedPanel = dialogTabPanels[activeDialogTab] || null;
  const isAuxiliaryDialogTab = activeDialogTab === "info" || activeDialogTab === "help";
  const activeDialogMeta = getDialogTabById(activeDialogTab);
  const activeModalPanel = isUnifiedDialogOpen ? activeUnifiedPanel : panelData;
  const panelTitle = isUnifiedDialogOpen ? "Preferences" : getPanelTitle(panelData?.command);
  const archivedChatRows = Array.isArray(activeUnifiedPanel?.content?.rows) ? activeUnifiedPanel.content.rows : [];

  const parsedAssistantPanel = activeModalPanel?.command === "/assistant"
    ? parseAssistantModeContent(Array.isArray(activeModalPanel.content) ? activeModalPanel.content.join("\n") : String(activeModalPanel.content || ""))
    : null;
  const parsedInfoGroups = activeModalPanel?.command === "/info"
    ? parseSystemInfoContent(Array.isArray(activeModalPanel.content) ? activeModalPanel.content.join("\n") : String(activeModalPanel.content || ""))
    : [];
  const parsedHelpPanel = activeModalPanel?.command === "/help" || activeModalPanel?.command === "?"
    ? (activeModalPanel?.content && typeof activeModalPanel.content === "object" && Array.isArray(activeModalPanel.content.sections)
      ? activeModalPanel.content
      : parseHelpContent(Array.isArray(activeModalPanel.content) ? activeModalPanel.content.join("\n") : String(activeModalPanel.content || "")))
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
  const serviceStatuses = {
    backend: normalizeStatusBadge(statusData?.services?.backend?.role || "active"),
    retriever: retrieverStatus,
    embedder: embedderStatus,
    ocrScanner: normalizeStatusBadge(statusData?.services?.ocrScanner?.status || statusData?.services?.ocrScanner?.role || "disconnected"),
  };
  const libraryFiles = Array.isArray(filesData?.files) ? filesData.files : [];
  const defaultFileTag = String(filesData?.defaultTag || DEFAULT_FILE_TAG_LABEL).trim().toLowerCase() || DEFAULT_FILE_TAG_LABEL;
  const tagFilterRows = useMemo(() => {
    const usageByTag = new Map();
    for (const file of libraryFiles) {
      const fileTags = Array.isArray(file?.tags) ? file.tags : [];
      const normalizedTags = new Set(fileTags
        .map((tag) => String(tag || "").trim().toLowerCase())
        .filter(Boolean));
      if (normalizedTags.size === 0) {
        normalizedTags.add(defaultFileTag);
      }
      for (const tag of normalizedTags) {
        usageByTag.set(tag, (usageByTag.get(tag) || 0) + 1);
      }
    }
    if (!usageByTag.has(defaultFileTag)) {
      usageByTag.set(defaultFileTag, 0);
    }
    return Array.from(usageByTag.entries())
      .map(([tag, fileCount]) => ({ tag, fileCount }))
      .sort((left, right) => left.tag.localeCompare(right.tag));
  }, [libraryFiles, defaultFileTag]);

  useEffect(() => {
    const disabledTagSet = new Set(
      (Array.isArray(filesData?.tagFilters?.disabledTags) ? filesData.tagFilters.disabledTags : [])
        .map((tag) => String(tag || "").trim().toLowerCase())
        .filter(Boolean)
    );
    const next = {};
    for (const row of tagFilterRows) {
      next[row.tag] = !disabledTagSet.has(row.tag);
    }
    setTagFilterEnabledByTag(next);
  }, [tagFilterRows, filesData]);
  const managedLibraryFiles = Array.isArray(libraryManagedData?.files) ? libraryManagedData.files : [];
  const managedByPath = new Map(managedLibraryFiles.map((file) => [file.path, file]));
  const isAdminUser = authenticatedRole === "admin";
  const retrieverRows = libraryFiles.map((file) => {
    const managed = managedByPath.get(file.path);
    return {
      path: file.path,
      uploadStatus: managed?.uploadStatus || (file.embedded ? "ready" : "discovered"),
      enabled: managed?.enabled !== false,
      sizeBytes: file.sizeBytes,
      chunkCount: file.chunkCount,
      extension: file.extension,
      embedded: Boolean(file.embedded),
      hash: file.hash,
      embeddedAt: managed?.embeddedAt || null,
      updatedAt: managed?.updatedAt || file.lastModified || null,
      canDelete: isAdminUser || Boolean(managed?.canDelete),
      canToggle: Boolean(managed?.canToggle),
      lastError: managed?.lastError || null,
      tags: Array.isArray(file.tags) ? file.tags : [],
    };
  });
  const managedOnlyRows = managedLibraryFiles
    .filter((managed) => !libraryFiles.some((file) => file.path === managed.path))
    .map((managed) => ({
      path: managed.path,
      uploadStatus: managed.uploadStatus || "uploaded",
      enabled: managed.enabled !== false,
      sizeBytes: managed.sizeBytes,
      chunkCount: managed.chunkCount,
      extension: managed.extension || getFileExtension(managed.originalName),
      embedded: Boolean(managed.embedded),
      hash: managed.hash,
      embeddedAt: managed.embeddedAt || null,
      updatedAt: managed.updatedAt || managed.uploadedAt || null,
      canDelete: Boolean(managed.canDelete),
      canToggle: Boolean(managed.canToggle),
      lastError: managed.lastError || null,
      tags: Array.isArray(managed.tags) ? managed.tags : [],
    }));
  const parseSortDate = (value) => {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const sortRowsByEmbeddingDateDesc = (left, right) => {
    const leftEmbeddedAt = parseSortDate(left.embeddedAt);
    const rightEmbeddedAt = parseSortDate(right.embeddedAt);
    if (rightEmbeddedAt !== leftEmbeddedAt) {
      return rightEmbeddedAt - leftEmbeddedAt;
    }

    const leftUpdatedAt = parseSortDate(left.updatedAt);
    const rightUpdatedAt = parseSortDate(right.updatedAt);
    if (rightUpdatedAt !== leftUpdatedAt) {
      return rightUpdatedAt - leftUpdatedAt;
    }

    return String(left.path || "").localeCompare(String(right.path || ""));
  };
  const allDbRows = retrieverRows.concat(managedOnlyRows);
  const userLibraryRows = allDbRows
    .filter((row) => String(row.path || "").startsWith("_library/"))
    .sort(sortRowsByEmbeddingDateDesc);
  const rootLibraryRows = allDbRows
    .filter((row) => !String(row.path || "").startsWith("_library/"))
    .sort(sortRowsByEmbeddingDateDesc);
  const dbRows = userLibraryRows.concat(rootLibraryRows);
  const libraryRows = pendingLibraryUploads.concat(dbRows);
  const adminUserRows = Array.isArray(adminUsersData)
    ? [...adminUsersData].sort((left, right) => String(left?.username || "").localeCompare(String(right?.username || "")))
    : [];
  const libraryTotalChunks = libraryFiles.reduce((sum, file) => sum + (Number(file.chunkCount) || 0), 0);
  const selectedAssistantMode = getAssistantModeMeta(currentAssistantMode);
  const isNavigationLocked = isSending;

  function openLibraryPage() {
    setIsMenuOpen(false);
    setIsAssistantModeMenuOpen(false);
    setPanelData(null);
    window.location.hash = LIBRARY_PAGE_HASH;
  }

  function openAdminPage() {
    setIsMenuOpen(false);
    setIsAssistantModeMenuOpen(false);
    setPanelData(null);
    window.location.hash = ADMIN_PAGE_HASH;
  }

  function openChatPage() {
    setIsMenuOpen(false);
    setIsAssistantModeMenuOpen(false);
    window.location.hash = "";
  }

  function createVolatileChat() {
    if (volatileChat?.id) {
      const previousVolatileId = volatileChat.id;
      setChatList((previous) => previous.filter((chat) => chat.id !== previousVolatileId));
    }
    const draftId = `chat-${crypto.randomUUID()}`;
    const draftChat = { id: draftId, name: buildChatNameFromId(draftId), status: "active" };
    setVolatileChat(draftChat);
    setActiveChatId(draftId);
    chatIdRef.current = draftId;
    setMessages([]);
    setPanelData(null);
    setOpenChatMenuId(null);
    try {
      window.localStorage.setItem(CHAT_ID_STORAGE_KEY, draftId);
    } catch {
      // ignore storage write errors
    }
  }

  async function createNewChat() {
    setIsMenuOpen(false);
    setIsAssistantModeMenuOpen(false);
    window.location.hash = "";
    createVolatileChat();
  }

  async function switchChat(chatId) {
    const selectedId = String(chatId || "").trim();
    if (!selectedId) {
      return;
    }
    if (selectedId === activeChatId) {
      setPanelData(null);
      setIsMenuOpen(false);
      setIsAssistantModeMenuOpen(false);
      if (activeView !== "chat") {
        window.location.hash = "";
        await loadMessagesFromDb(selectedId).catch(() => {
          setMessages([]);
        });
      }
      return;
    }
    if (volatileChat && selectedId !== volatileChat.id) {
      const volatileId = volatileChat.id;
      setVolatileChat(null);
      setChatList((previous) => previous.filter((chat) => chat.id !== volatileId));
    }
    const sessionId = sessionIdRef.current;
    setPanelData(null);
    setIsMenuOpen(false);
    window.location.hash = "";
    try {
      const response = await apiFetch(`/api/chats/${encodeURIComponent(selectedId)}`, {
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

  async function downloadChat(chat) {
    if (!chat?.id) return;
    if (volatileChat?.id === chat.id) {
      throw new Error("Send at least one message to save this chat before downloading.");
    }
    let response = await apiFetchForPreferences(
      `${API_BASE_URL}/api/chats/${encodeURIComponent(chat.id)}/download?sessionId=${encodeURIComponent(sessionIdRef.current)}`,
      {},
      "Archive preferences"
    );
    if (!response.ok) {
      const [chatListResponse, messagesResponse] = await Promise.all([
        apiFetchForPreferences(`/api/chats?sessionId=${encodeURIComponent(sessionIdRef.current)}&includeArchived=true`, {}, "Archive preferences"),
        apiFetchForPreferences(`/api/messages?sessionId=${encodeURIComponent(sessionIdRef.current)}&chatId=${encodeURIComponent(chat.id)}&limit=4000`, {}, "Archive preferences"),
      ]);
      const chatListPayload = await chatListResponse.json().catch(() => ({}));
      const messagesPayload = await messagesResponse.json().catch(() => ({}));
      if (!chatListResponse.ok || !messagesResponse.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to download chat.");
      }
      const selectedChat = Array.isArray(chatListPayload.chats)
        ? chatListPayload.chats.find((entry) => entry.id === chat.id)
        : null;
      const fallbackPayload = buildFallbackChatExportPayload({
        sessionId: sessionIdRef.current,
        chat,
        selectedChat,
        messages: messagesPayload.messages,
      });
      response = new Response(JSON.stringify(fallbackPayload, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    const blob = await response.blob();
    triggerJsonDownload(blob, buildChatDownloadFileName(chat));
  }

  function openRenameDialog(chat) {
    setOpenChatMenuId(null);
    setRenameDialogChat(chat);
    setRenameInputValue(String(chat?.name || ""));
  }

  function openChatFilterDialog(chat) {
    if (!chat?.id) return;
    setOpenChatMenuId(null);
    setChatFilterDialogChat(chat);
    setChatTagFilterEnabledByChatId((previous) => ({
      ...previous,
      [chat.id]: buildEnabledTagMapFromDisabledTags(chat?.tagFilters?.disabledTags),
    }));
  }

  async function toggleChatTagFilter(chatId, tag) {
    const normalizedChatId = String(chatId || "").trim();
    const normalizedTag = String(tag || "").trim().toLowerCase();
    if (!normalizedChatId || !normalizedTag) return;
    if (isChatFilterSaving) return;

    const currentByTag = chatTagFilterEnabledByChatId[normalizedChatId] || {};
    const currentlyEnabled = currentByTag?.[normalizedTag] ?? (tagFilterEnabledByTag[normalizedTag] ?? true);
    const nextEnabled = !currentlyEnabled;

    try {
      setIsChatFilterSaving(true);
      const response = await apiFetchForPreferences(`/api/chats/${encodeURIComponent(normalizedChatId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          action: "set_tag_filter",
          tag: normalizedTag,
          enabled: nextEnabled,
        }),
      }, "Archive preferences");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save chat filter");
      }
      const persistedDisabledTags = Array.isArray(payload?.chat?.tagFilters?.disabledTags)
        ? payload.chat.tagFilters.disabledTags
        : [];
      const nextEnabledByTag = buildEnabledTagMapFromDisabledTags(persistedDisabledTags);
      setChatTagFilterEnabledByChatId((previous) => ({
        ...previous,
        [normalizedChatId]: nextEnabledByTag,
      }));
      setChatList((previous) => previous.map((chat) => (
        chat.id === normalizedChatId
          ? { ...chat, tagFilters: { disabledTags: persistedDisabledTags } }
          : chat
      )));
      setChatFilterDialogChat((previous) => (
        previous && previous.id === normalizedChatId
          ? { ...previous, tagFilters: { disabledTags: persistedDisabledTags } }
          : previous
      ));
    } catch (error) {
      setMessages((previous) => previous.concat(createMessage("assistant", `Error: ${error.message}`, {
        evidenceSeverity: "error",
        isVolatile: true,
      })));
    } finally {
      setIsChatFilterSaving(false);
    }
  }

  async function confirmRenameChat() {
    const targetChat = renameDialogChat;
    if (!targetChat || isChatActionPending) return;
    const nextName = String(renameInputValue || "").trim();
    if (!nextName) return;

    setIsChatActionPending(true);
    try {
      const response = await apiFetchForPreferences(`/api/chats/${encodeURIComponent(targetChat.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          action: "rename",
          name: nextName,
        }),
      }, "Archive preferences");
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

  async function refreshArchiveTabIfOpen() {
    if (isUnifiedDialogOpen && activeDialogTab === "archive") {
      await loadUnifiedDialogTab("archive", { forceReload: true });
    }
  }

  async function archiveChat(chatId) {
    if (!chatId || isChatActionPending) return;
    setIsChatActionPending(true);
    setOpenChatMenuId(null);
    try {
      const response = await apiFetchForPreferences(`/api/chats/${encodeURIComponent(chatId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          action: "archive",
        }),
      }, "Archive preferences");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to archive chat");
      }
      await refreshChats({ preferredChatId: payload?.activeChatId || activeChatId });
      if (payload?.activeChatId) {
        await loadMessagesFromDb(payload.activeChatId).catch(() => setMessages([]));
      }
      setDialogTabPanels((previous) => {
        const nextPanels = { ...previous };
        delete nextPanels.archive;
        return nextPanels;
      });
      await refreshArchiveTabIfOpen();
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
      const response = await apiFetchForPreferences(`/api/chats/${encodeURIComponent(targetChat.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionIdRef.current }),
      }, "Archive preferences");
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
      setDialogTabPanels((previous) => {
        const nextPanels = { ...previous };
        delete nextPanels.archive;
        return nextPanels;
      });
      await refreshArchiveTabIfOpen();
    } catch (error) {
      setMessages((prev) => prev.concat(createMessage("assistant", `Error: ${error.message}`, {
        evidenceSeverity: "error",
        isVolatile: true,
      })));
    } finally {
      setIsChatActionPending(false);
    }
  }

  async function unarchiveChat(chatId) {
    if (!chatId || isChatActionPending) return;
    setIsChatActionPending(true);
    try {
      const response = await apiFetchForPreferences(`/api/chats/${encodeURIComponent(chatId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          action: "activate",
        }),
      }, "Archive preferences");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to unarchive chat");
      }
      await refreshChats({ preferredChatId: activeChatId });
      setDialogTabPanels((previous) => {
        const nextPanels = { ...previous };
        delete nextPanels.archive;
        return nextPanels;
      });
      await refreshArchiveTabIfOpen();
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
    await openUnifiedDialog("general");
  }

  if (!isAuthenticated) {
    return React.createElement(
      "div",
      { className: "page page-login" },
      React.createElement(
        "header",
        { className: "topbar" },
        React.createElement(
          "div",
          { className: "brand" },
          React.createElement("h1", null, "RAG"),
          React.createElement("span", { className: "brand-status-light", "aria-hidden": "true" })
        ),
        React.createElement("div", { className: "header-center-spacer", "aria-hidden": "true" }),
        React.createElement("div", { className: "quick-actions", "aria-hidden": "true" })
      ),
      React.createElement(
        "main",
        { className: "login-page-content" },
        React.createElement(
          "form",
          { className: "login-card", onSubmit: submitLogin },
          React.createElement("h2", null, isChangePasswordMode ? "Please change your password" : "Sign In"),
          React.createElement(
            "label",
            { className: "login-field-label", htmlFor: "login-username" },
            "Username"
          ),
          React.createElement("input", {
            id: "login-username",
            className: "login-input",
            type: "text",
            value: loginUsername,
            minLength: 4,
            autoComplete: "username",
            onChange: (event) => {
              setLoginUsername(event.target.value);
              if (loginError) setLoginError("");
            },
          }),
          React.createElement(
            "label",
            { className: "login-field-label", htmlFor: "login-password" },
            isChangePasswordMode ? "Old password" : "Password"
          ),
          React.createElement(
            "div",
            { className: "login-input-wrap" },
            React.createElement("input", {
              id: "login-password",
              className: "login-input",
              type: isLoginPasswordVisible ? "text" : "password",
              value: loginPassword,
              minLength: 8,
              autoComplete: "current-password",
              onChange: (event) => {
                setLoginPassword(event.target.value);
                if (loginError) setLoginError("");
              },
            }),
            React.createElement(
              "button",
              {
                type: "button",
                className: "login-password-visibility",
                "aria-label": isLoginPasswordVisible ? "Hide password" : "Show password",
                onClick: () => setIsLoginPasswordVisible((previous) => !previous),
              },
              icon(isLoginPasswordVisible ? eyeOffIconPath : eyeIconPath)
            )
          ),
          isChangePasswordMode
            ? React.createElement(
              React.Fragment,
              null,
              React.createElement(
                "label",
                { className: "login-field-label", htmlFor: "login-new-password" },
                "New password"
              ),
              React.createElement(
                "div",
                { className: "login-input-wrap" },
                React.createElement("input", {
                  id: "login-new-password",
                  className: "login-input",
                  type: isNewPasswordVisible ? "text" : "password",
                  value: newPassword,
                  minLength: 8,
                  autoComplete: "new-password",
                  onChange: (event) => {
                    setNewPassword(event.target.value);
                    if (loginError) setLoginError("");
                  },
                }),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "login-password-visibility",
                    "aria-label": isNewPasswordVisible ? "Hide new password" : "Show new password",
                    onClick: () => setIsNewPasswordVisible((previous) => !previous),
                  },
                  icon(isNewPasswordVisible ? eyeOffIconPath : eyeIconPath)
                )
              ),
              React.createElement(
                "label",
                { className: "login-field-label", htmlFor: "login-confirm-password" },
                "Confirm new password"
              ),
              React.createElement(
                "div",
                { className: "login-input-wrap" },
                React.createElement("input", {
                  id: "login-confirm-password",
                  className: "login-input",
                  type: isConfirmPasswordVisible ? "text" : "password",
                  value: confirmNewPassword,
                  minLength: 8,
                  autoComplete: "new-password",
                  onChange: (event) => {
                    setConfirmNewPassword(event.target.value);
                    if (loginError) setLoginError("");
                  },
                }),
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "login-password-visibility",
                    "aria-label": isConfirmPasswordVisible ? "Hide confirmed password" : "Show confirmed password",
                    onClick: () => setIsConfirmPasswordVisible((previous) => !previous),
                  },
                  icon(isConfirmPasswordVisible ? eyeOffIconPath : eyeIconPath)
                )
              )
            )
            : null,
          isChangePasswordMode && confirmNewPassword.length > 0 && !doNewPasswordsMatch
            ? React.createElement("p", { className: "login-error", role: "alert" }, "New password and confirmation must match.")
            : null,
          loginError
            ? React.createElement("p", { className: "login-error", role: "alert" }, loginError)
            : null,
          React.createElement(
            "button",
            {
              type: "submit",
              className: "restart-button login-submit-button",
              disabled: !isLoginFormValid || isLoginSubmitting,
            },
            icon("M2 21l20-9L2 3v7l14 2-14 2z"),
            React.createElement(
              "span",
              null,
              isLoginSubmitting
                ? (isChangePasswordMode ? "Changing password…" : "Signing In…")
                : (isChangePasswordMode ? "Change password" : "Sign In")
            )
          )
        )
      )
    );
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
        activeView === "library" || activeView === "admin"
          ? React.createElement(
            React.Fragment,
            null,
            React.createElement("h2", { className: "header-title" }, activeView === "admin" ? "ADMIN" : "LIBRARY")
          )
          : React.createElement(
            "div",
            { className: "assistant-mode-menu", ref: assistantModeMenuRef },
            React.createElement(
              "button",
              {
                type: "button",
                className: "assistant-mode-trigger",
                onClick: () => setIsAssistantModeMenuOpen((previous) => !previous),
                "aria-expanded": isAssistantModeMenuOpen ? "true" : "false",
                "aria-haspopup": "menu",
              },
              React.createElement("span", { className: "header-title" }, selectedAssistantMode.label),
              icon(chevronDownIconPath)
            ),
            isAssistantModeMenuOpen
              ? React.createElement(
                "div",
                { className: "assistant-mode-dropdown", role: "menu", "aria-label": "Assistant modes" },
                ...ASSISTANT_MODE_OPTIONS.map((mode) => React.createElement(
                  "button",
                  {
                    key: `header-mode-${mode.id}`,
                    type: "button",
                    className: `assistant-mode-option${mode.id === selectedAssistantMode.id ? " active" : ""}`,
                    onClick: () => applyPersonalizationChange("assistant", mode.id),
                    disabled: isSending || !isEmbeddingReady || isAssistantModeTemporarilyDisabled(mode.id),
                    role: "menuitemradio",
                    "aria-checked": mode.id === selectedAssistantMode.id ? "true" : "false",
                  },
                  React.createElement(
                    "div",
                    { className: "assistant-mode-option-text" },
                    React.createElement("strong", null, mode.label),
                    React.createElement("small", null, mode.description)
                  ),
                  mode.id === selectedAssistantMode.id
                    ? React.createElement("span", { className: "assistant-mode-option-check" }, icon(checkIconPath))
                    : null
                ))
              )
              : null
          )
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
          { type: "button", className: "side-nav-item", onClick: createNewChat, disabled: isNavigationLocked },
          icon(plusChatIconPath),
          React.createElement("span", null, "New chat")
        ),
        isAdminUser
          ? React.createElement(
            "button",
            {
              type: "button",
              className: `side-nav-item${activeView === "admin" ? " active" : ""}`,
              onClick: openAdminPage,
              disabled: isNavigationLocked,
            },
            icon(adminIconPath),
            React.createElement("span", null, "Admin")
          )
          : null,
        React.createElement(
          "button",
          {
            type: "button",
            className: `side-nav-item${activeView === "library" ? " active" : ""}`,
            onClick: openLibraryPage,
            disabled: isNavigationLocked,
          },
          icon(libraryIconPath),
          React.createElement("span", null, "Library")
        ),
        React.createElement(
          "button",
          {
            type: "button",
            className: `side-nav-item${isUnifiedDialogOpen && activeDialogTab === "personalization" ? " active" : ""}`,
            onClick: openPersonalizationPanel,
            disabled: isNavigationLocked || !isEmbeddingReady,
          },
          icon("M12 2a5 5 0 0 1 5 5c0 2.7-2.1 4.8-4.7 5A7 7 0 0 1 19 19h-2a5 5 0 0 0-10 0H5a7 7 0 0 1 6.7-7c-2.6-.2-4.7-2.3-4.7-5a5 5 0 0 1 5-5"),
          React.createElement("span", null, "Personalization")
        )
      ),
      React.createElement("h3", { className: "side-nav-headline" }, "Your chats"),
      React.createElement(
        "div",
        { className: "side-nav-chat-list", role: "navigation", "aria-label": "Your chats" },
        isLoadingChats
          ? React.createElement("p", { className: "side-nav-loading" }, "Loading chats…")
          : null,
        ...displayedChatList.map((chat) => {
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
                disabled: isLoadingChats || isNavigationLocked,
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
                  disabled: isNavigationLocked,
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
                        disabled: isNavigationLocked,
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
                        disabled: isNavigationLocked,
                        onClick: () => openChatFilterDialog(chat),
                      },
                      icon(filterIconPath),
                      React.createElement("span", null, "Filter")
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
                        disabled: isNavigationLocked,
                        onClick: async () => {
                          setOpenChatMenuId(null);
                          try {
                            await downloadChat(chat);
                          } catch (error) {
                            setMessages((prev) => prev.concat(createMessage("assistant", `Error: ${error.message}`, {
                              evidenceSeverity: "error",
                              isVolatile: true,
                            })));
                          }
                        },
                      },
                      icon(downloadIconPath),
                      React.createElement("span", null, "Download")
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
                        disabled: isNavigationLocked,
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
                        disabled: isNavigationLocked,
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
          { className: `side-nav-user-wrap${isUserMenuOpen ? " menu-open" : ""}`, ref: userMenuRef },
          React.createElement(
            "button",
            {
              type: "button",
              className: "side-nav-user side-nav-user-button",
              "aria-haspopup": "menu",
              "aria-expanded": isUserMenuOpen ? "true" : "false",
              onClick: () => setIsUserMenuOpen((previous) => !previous),
            },
            React.createElement("div", { className: "side-nav-avatar-placeholder", "aria-hidden": "true" }, "U"),
            React.createElement(
              "div",
              { className: "side-nav-user-meta" },
              React.createElement("strong", null, authenticatedDisplayName || "Signed in"),
              React.createElement("small", null, authenticatedUsername || "Username")
            ),
            React.createElement("span", { className: "side-nav-user-menu-icon", "aria-hidden": "true" }, icon(dotsIconPath))
          ),
          isUserMenuOpen
            ? React.createElement(
              "ul",
              { className: "side-nav-user-menu", role: "menu" },
              React.createElement(
                "li",
                { role: "none" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "chat-item-actions-option",
                    role: "menuitem",
                    onClick: openInfoFromUserMenu,
                  },
                  icon(infoIconPath),
                  React.createElement("span", null, "Info")
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
                    onClick: openHelpFromUserMenu,
                  },
                  icon(rescueRingIconPath),
                  React.createElement("span", null, "Help")
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
                    onClick: openPreferencesFromUserMenu,
                  },
                  icon(settingsIconPath),
                  React.createElement("span", null, "Preferences")
                )
              ),
              React.createElement("li", { className: "side-nav-user-menu-divider", role: "separator", "aria-hidden": "true" }),
              React.createElement(
                "li",
                { role: "none" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "chat-item-actions-option",
                    role: "menuitem",
                    onClick: openChangePasswordFlow,
                  },
                  icon(keyIconPath),
                  React.createElement("span", null, "Change Password")
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
                    onClick: handleLogout,
                  },
                  icon(logoutIconPath),
                  React.createElement("span", null, "Logout")
                )
              )
            )
            : null
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
            React.createElement("h4", null, "Knowledge Base"),
            React.createElement(
              "div",
              { className: "library-summary-table", role: "table", "aria-label": "Library summary" },
              React.createElement(
                "div",
                { className: "library-summary-head", role: "row" },
                React.createElement("span", { role: "columnheader" }, "files"),
                React.createElement("span", { role: "columnheader" }, "embedded files"),
                React.createElement("span", { role: "columnheader" }, "chunks")
              ),
              React.createElement(
                "div",
                { className: "library-summary-row", role: "row" },
                React.createElement("strong", { role: "cell" }, String(filesData?.totalFiles ?? 0)),
                React.createElement("strong", { role: "cell" }, String(filesData?.embeddedFiles ?? 0)),
                React.createElement("strong", { role: "cell" }, String(libraryTotalChunks))
              )
            )
          ),
          React.createElement(
            "section",
            { className: "info-group-card library-table-card" },
            React.createElement(
              "div",
              { className: "library-table-header" },
              React.createElement("h4", null, "Files")
            ),
            React.createElement(
              "div",
              { className: "library-table", role: "table", "aria-label": "Library files" },
              React.createElement(
                "div",
                { className: "library-table-head", role: "row" },
                React.createElement("span", null, "File"),
                React.createElement("span", null, "Status"),
                React.createElement("span", null, "Tags"),
                React.createElement("span", null, "Size"),
                React.createElement("span", null, "Chunks"),
                React.createElement("span", null, "Extension"),
                React.createElement("span", null, "Embedded"),
                React.createElement("span", null, "Updated"),
                React.createElement("span", null, "Action")
              ),
              React.createElement(
                "div",
                { className: "library-table-body", role: "rowgroup" },
                ...libraryRows.map((file) => React.createElement(
                  "div",
                  {
                    key: `${file.path}-${file.uploadStatus}-${file.updatedAt || "n/a"}-${file.isVolatile ? "volatile" : "db"}`,
                    className: "library-table-row",
                    role: "row",
                  },
                  React.createElement("strong", { className: "library-path" }, normalizeLibraryPathDisplay(file.path)),
                  React.createElement(
                    "span",
                    { className: "library-status-cell" },
                    (() => {
                      const normalizedStatus = String(file.uploadStatus || "").toLowerCase();
                      const isDisabled = file.enabled === false;
                      const isLoadingStatus = !isDisabled && ["uploading", "uploaded", "embedding", "discovered", "removing", "deleted"].includes(normalizedStatus);
                      const isErrorStatus = normalizedStatus === "error";
                      const statusClassName = isDisabled
                        ? "pending"
                        : isErrorStatus
                          ? "error"
                          : isLoadingStatus
                            ? "pending"
                            : "active";
                      return React.createElement(
                        "span",
                        {
                          className: `status-badge status-badge-icon ${statusClassName}${isLoadingStatus ? " with-spinner" : ""}`,
                          "aria-label": isDisabled ? "disabled" : (normalizedStatus || "ready"),
                        },
                        isLoadingStatus
                          ? React.createElement("span", { className: "spinner spinner-inline", "aria-hidden": "true" })
                          : icon(isDisabled ? disableFileIconPath : (isErrorStatus ? xIconPath : enableFileIconPath))
                      );
                    })(),
                    file.lastError ? React.createElement("small", { className: "library-row-error" }, file.lastError) : null
                  ),
                  React.createElement(
                    "span",
                    { className: "library-tags-cell" },
                    Array.isArray(file.tags) && file.tags.length > 0
                      ? file.tags.map((tag) => React.createElement(
                        "span",
                        { key: `${file.path}-tag-${tag}`, className: "library-tag-line" },
                        tag
                      ))
                      : React.createElement("span", { className: "library-tag-line muted" }, "—")
                  ),
                  React.createElement("span", null, formatBytes(file.sizeBytes)),
                  React.createElement("span", null, String(file.chunkCount ?? "0")),
                  React.createElement(
                    "span",
                    { className: `library-extension-chip ${getAttachmentColorClass(file.path || file.extension || "")}` },
                    (file.extension || "n/a").toUpperCase()
                  ),
                  (() => {
                    const normalizedStatus = String(file.uploadStatus || "").toLowerCase();
                    const embeddingInProgress = file.enabled !== false
                      && !file.embedded
                      && ["uploading", "uploaded", "embedding", "discovered"].includes(normalizedStatus);
                    const removingInProgress = file.enabled !== false
                      && !file.embedded
                      && file.uploadStatus === "removing";
                    const showProgress = embeddingInProgress || removingInProgress;
                    const embeddedClassName = file.embedded
                      ? "active"
                      : file.uploadStatus === "error"
                        ? "error"
                        : "pending";
                    return React.createElement(
                      "span",
                      {
                        className: `status-badge status-badge-icon ${embeddedClassName} ${showProgress ? "with-spinner" : ""}`,
                        "aria-label": showProgress ? "embedding" : (file.embedded ? "embedded" : "not embedded"),
                      },
                      showProgress
                        ? React.createElement("span", { className: "spinner spinner-inline", "aria-hidden": "true" })
                        : icon(file.uploadStatus === "error" && !file.embedded ? xIconPath : (file.embedded ? enableFileIconPath : disableFileIconPath))
                    );
                  })(),
                  (() => {
                    const updated = formatLibraryUpdatedAt(file.updatedAt);
                    return React.createElement(
                      "span",
                      { className: "library-updated-cell" },
                      React.createElement("span", null, updated.date),
                      updated.time ? React.createElement("span", null, updated.time) : null
                    );
                  })(),
                  React.createElement(
                    "div",
                    { className: "library-row-actions" },
                    React.createElement(
                      "button",
                      {
                        type: "button",
                        className: "library-toggle-button",
                        "aria-label": file.enabled === false ? `Activate ${file.path}` : `Disable ${file.path}`,
                        onClick: () => toggleLibraryFile(file, file.enabled === false ? "activate" : "disable"),
                        disabled: !file.canToggle,
                      },
                      icon(file.enabled === false ? enableFileIconPath : disableFileIconPath)
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
            ),
            libraryNotice ? React.createElement("p", { className: "library-notice library-notice-below-table" }, libraryNotice) : null,
            React.createElement(
              "div",
              { className: "library-table-footer" },
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "restart-button library-upload-button",
                  onClick: openLibraryUploadDialog,
                },
                icon(fileUploadIconPath),
                "Upload"
              ),
              React.createElement("input", {
                ref: libraryUploadDialogInputRef,
                type: "file",
                className: "composer-file-input",
                multiple: true,
                accept: LIBRARY_UPLOAD_RULES.allowedExtensions.join(","),
                onChange: handleLibraryUploadDraftSelection,
                "aria-hidden": "true",
                tabIndex: -1,
              })
            )
          )
        )
        : activeView === "admin"
          ? React.createElement(
            "section",
            { className: "chat-column library-column" },
            React.createElement(
              "section",
              { className: "info-group-card library-table-card admin-users-card" },
              React.createElement(
                "div",
                { className: "library-table-header" },
                React.createElement("h4", null, "Users")
              ),
              adminUsersNotice ? React.createElement("p", { className: "library-notice" }, adminUsersNotice) : null,
              React.createElement(
                "div",
                { className: "library-table admin-users-table", role: "table", "aria-label": "Users" },
                React.createElement(
                  "div",
                  { className: "library-table-head", role: "row" },
                  React.createElement("span", null, "Username"),
                  React.createElement("span", null, "ACTIVE"),
                  React.createElement("span", null, "CHANGE-PW"),
                  React.createElement("span", null, "Action")
                ),
                ...(adminUserRows.length === 0
                  ? [React.createElement("p", { key: "admin-empty", className: "archive-empty" }, "No users found.")]
                  : adminUserRows.map((user) => {
                    const isProtectedUser = user.username === authenticatedUsername || ADMIN_PROTECTED_USERNAMES.has(user.username);
                    return React.createElement(
                      "div",
                      { key: user.username, className: "library-table-row", role: "row" },
                      React.createElement("strong", { className: "library-path" }, user.username),
                      React.createElement(
                        "label",
                        { className: "filter-switch", title: user.isActive ? "Deactivate user" : "Activate user" },
                        React.createElement("input", {
                          type: "checkbox",
                          checked: Boolean(user.isActive),
                          disabled: isProtectedUser,
                          onChange: () => updateAdminUser(user.username, { isActive: !user.isActive }),
                        }),
                        React.createElement("span", { className: "filter-switch-slider", "aria-hidden": "true" })
                      ),
                      React.createElement(
                        "label",
                        { className: "filter-switch", title: user.requireChangePw ? "Disable required password change" : "Require password change" },
                        React.createElement("input", {
                          type: "checkbox",
                          checked: Boolean(user.requireChangePw),
                          disabled: isProtectedUser,
                          onChange: () => updateAdminUser(user.username, { requireChangePw: !user.requireChangePw }),
                        }),
                        React.createElement("span", { className: "filter-switch-slider", "aria-hidden": "true" })
                      ),
                      React.createElement(
                        "div",
                        { className: "library-row-actions" },
                        React.createElement(
                          "button",
                          {
                            type: "button",
                            className: "library-delete-button",
                            "aria-label": `Delete ${user.username}`,
                            onClick: () => setDeleteConfirmUser(user),
                            disabled: isProtectedUser,
                          },
                          icon(trashIconPath)
                        )
                        )
                      );
                  }))
              ),
              React.createElement(
                "div",
                { className: "admin-user-actions" },
                React.createElement(
                  "button",
                  {
                    type: "button",
                    className: "admin-new-user-button",
                    onClick: openCreateUserDialog,
                  },
                  icon(userIconPath),
                  "New User"
                )
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
                      message.isPending
                        ? renderPendingAssistantTrail(message)
                        : renderAssistantMarkdown(message.text)
                    ),
                    message.isPending
                      ? null
                      : React.createElement(
                        "div",
                        { className: "assistant-evidence-wrap" },
                        React.createElement(
                          "button",
                          {
                            type: "button",
                            className: `assistant-evidence-trigger${openEvidenceMenuMessageId === message.id ? " active" : ""}`,
                            "aria-expanded": openEvidenceMenuMessageId === message.id,
                            "aria-haspopup": "menu",
                            onClick: (event) => toggleEvidenceMenu(message.id, event),
                          },
                          React.createElement("span", { className: "assistant-evidence-trigger-icon", "aria-hidden": "true" }, icon(sourceFileIconPath)),
                          React.createElement("small", null, "Sources")
                        ),
                        openEvidenceMenuMessageId === message.id
                          ? React.createElement(
                            "section",
                            {
                              className: `assistant-evidence-menu ${openEvidenceMenuPlacement}`,
                              role: "menu",
                              "aria-label": "Evidence details",
                              style: { maxHeight: `${openEvidenceMenuMaxHeight}px` },
                            },
                            React.createElement("h4", { className: "assistant-evidence-heading" }, "Sources"),
                            React.createElement(
                              "p",
                              { className: "assistant-evidence-summary" },
                              `Quality: ${formatSeverityLabel(message.evidenceSeverity || "unknown")} • Matches: ${message.retrieval?.matches?.length || 0} • Cosine limit: ${message.retrieval?.cosineLimit ?? "n/a"}`
                            ),
                            Array.isArray(message.retrieval?.matches) && message.retrieval.matches.length > 0
                              ? React.createElement(
                                "ul",
                                { className: "assistant-evidence-list" },
                                ...message.retrieval.matches.slice(0, 4).map((match) => React.createElement(
                                  "li",
                                  { key: `${message.id}-${match.rank}-${match.source}` },
                                  React.createElement(
                                    "div",
                                    { className: "assistant-evidence-meta" },
                                    React.createElement("span", { className: "assistant-evidence-file-icon", "aria-hidden": "true" }, icon(sourceFileIconPath)),
                                    React.createElement(
                                      "span",
                                      { className: "assistant-evidence-file-name" },
                                      String(match.source || "unknown source").replace(/^_library\//, "")
                                    ),
                                  ),
                                  React.createElement(
                                    "p",
                                    { className: `assistant-evidence-score ${getScoreSeverity(match.score)}` },
                                    `Score ${formatScorePercent(match.score)}`
                                  ),
                                  match.title ? React.createElement("p", { className: "assistant-evidence-title" }, match.title) : null,
                                  Array.isArray(match.tags) && match.tags.length > 0
                                    ? React.createElement(
                                      "p",
                                      { className: "assistant-evidence-tags" },
                                      `Tags ${match.tags.map((tag) => String(tag || "").trim()).filter(Boolean).join(", ")}`
                                    )
                                    : null,
                                  Array.isArray(match.tags) && match.tags.length > 0
                                    ? null
                                    : React.createElement("p", { className: "assistant-evidence-tags assistant-evidence-tags-empty" }, "Tags none")
                                ))
                              )
                              : React.createElement("p", { className: "assistant-evidence-empty" }, "No retrieval matches were returned.")
                          )
                          : null
                      )
                  )
                  : message.role === "assistant"
                    ? (
                      message.isPending
                        ? renderPendingAssistantTrail(message)
                        : renderAssistantMarkdown(message.text)
                    )
                    : React.createElement(
                      React.Fragment,
                      null,
                      Array.isArray(message.attachedFiles) && message.attachedFiles.length > 0
                        ? React.createElement(
                          "div",
                          { className: "composer-attachment-chip-list user-message-attachment-chip-list" },
                          ...message.attachedFiles.map((fileName, fileIndex) => renderAttachmentChip({
                            fileName,
                            index: fileIndex,
                            keyPrefix: `message-attachment-${message.id}`,
                            className: "user-message-attachment-chip",
                          }))
                        )
                        : null,
                      React.createElement(
                        "div",
                        { className: "user-message-content" },
                        React.createElement("p", null, message.text),
                      )
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
            attachedPromptFiles.length > 0
              ? React.createElement(
                "div",
                { className: "composer-attachment-chip-list" },
                ...attachedPromptFiles.map((file, index) => renderComposerAttachmentChip(file, index))
              )
              : null,
            React.createElement(
              "div",
              { className: "composer-entry-row" },
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
                icon("M12 5a1 1 0 0 1 1 1v5h5a1 1 0 1 1 0 2h-5v5a1 1 0 1 1-2 0v-5H6a1 1 0 1 1 0-2h5V6a1 1 0 0 1 1-1")
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
            )
          ),
          React.createElement(
            "button",
            { className: "send", type: "submit", disabled: isSending || !isEmbeddingReady || !inputValue.trim() },
            icon("M12 5l6.2 6.2-1.4 1.4-3.8-3.8V19h-2V8.8l-3.8 3.8-1.4-1.4z")
          ),
          attachmentNotice
            ? React.createElement(
              "p",
              { className: "composer-attachment-notice invalid" },
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
          disabled: isNavigationLocked,
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
            { type: "button", onClick: () => openUnifiedDialog("info"), disabled: isNavigationLocked || !isEmbeddingReady },
            icon("M11 17h2v-6h-2zm1-8a1.25 1.25 0 1 0 0 2.5A1.25 1.25 0 0 0 12 9m0 13A10 10 0 1 1 12 2a10 10 0 0 1 0 20"),
            "Info"
          ),
          activeView === "library"
            ? React.createElement(
              "button",
              { type: "button", onClick: openChatPage, disabled: isNavigationLocked },
              icon(chatIconPath),
              "Chat"
            )
            : React.createElement(
              React.Fragment,
              null,
              isAdminUser
                ? React.createElement(
                  "button",
                  { type: "button", onClick: openAdminPage, disabled: isNavigationLocked },
                  icon(adminIconPath),
                  "Admin"
                )
                : null,
              React.createElement(
                "button",
                { type: "button", onClick: openLibraryPage, disabled: isNavigationLocked },
                icon(libraryIconPath),
                "Library"
              )
            ),
          React.createElement(
            "button",
            { type: "button", onClick: openPersonalizationPanel, disabled: isNavigationLocked || !isEmbeddingReady },
            icon("M12 2a5 5 0 0 1 5 5c0 2.7-2.1 4.8-4.7 5A7 7 0 0 1 19 19h-2a5 5 0 0 0-10 0H5a7 7 0 0 1 6.7-7c-2.6-.2-4.7-2.3-4.7-5a5 5 0 0 1 5-5"),
            "Personalization"
          ),
          React.createElement(
            "button",
            { type: "button", onClick: openSettingsDialog, disabled: isNavigationLocked || !isEmbeddingReady },
            icon("M19.14 12.94a7.14 7.14 0 0 0 .05-.94 7.14 7.14 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.14 7.14 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.14 7.14 0 0 0-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.14 7.14 0 0 0-.05.94 7.14 7.14 0 0 0 .05.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.39 1.04.71 1.63.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54c.59-.23 1.13-.55 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5"),
            "Settings"
          ),
          React.createElement(
            "button",
            { type: "button", onClick: () => openUnifiedDialog("help"), disabled: isNavigationLocked || !isEmbeddingReady },
            icon("M12 2 2 12l10 10 10-10Zm0 4.5a3 3 0 0 1 3 3c0 2.2-3 2.4-3 5h-2c0-3.4 3-3.8 3-5a1 1 0 0 0-2 0H9a3 3 0 0 1 3-3Zm-1 10h2v2h-2z"),
            "Help"
          )
        )
        : null,
      null
    ),
    activeView !== "library" && activeView !== "admin" && !isEmbeddingReady && !isLoadingStatus
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
    isUploadDialogOpen
      ? React.createElement(
        "div",
        {
          className: "panel-modal-backdrop",
          onClick: closeLibraryUploadDialog,
        },
        React.createElement(
          "section",
          {
            className: "library-upload-modal",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": "Upload files",
            onClick: (event) => event.stopPropagation(),
          },
          React.createElement("h4", null, "Upload files"),
          libraryUploadDrafts.length === 0
            ? React.createElement(
              "div",
              { className: "library-upload-empty" },
              React.createElement(
                "button",
                {
                  type: "button",
                  className: "library-upload-add",
                  onClick: () => libraryUploadDialogInputRef.current?.click(),
                },
                icon(fileUploadIconPath),
                "Add files"
              )
            )
            : React.createElement(
              "div",
              { className: "library-upload-list" },
              ...libraryUploadDrafts.map((draft) => React.createElement(
                "div",
                { key: draft.id, className: "library-upload-row" },
                React.createElement("span", { className: "library-upload-name" }, draft.file.name),
                React.createElement("input", {
                  type: "text",
                  className: "library-upload-tags-input",
                  placeholder: "tags, separated, by, commas",
                  value: draft.tagsInput,
                  onChange: (event) => setLibraryDraftTags(draft.id, event.target.value),
                })
              ))
            ),
          React.createElement(
            "div",
            { className: "library-upload-actions" },
            React.createElement(
              "button",
              {
                type: "button",
                className: "library-upload-cancel",
                onClick: closeLibraryUploadDialog,
              },
              "Cancel"
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "library-upload-confirm",
                onClick: confirmLibraryUploadDialog,
                disabled: libraryUploadDrafts.length === 0,
              },
              icon(fileUploadIconPath),
              "Upload"
            )
          )
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
            "Are you sure you want to delete this file?"
          ),
          renderAttachmentChip({
            fileName: deleteConfirmFile.path,
            index: 0,
            keyPrefix: "delete-file",
            className: "dialog-delete-chip",
          }),
          React.createElement(
            "div",
            { className: "library-delete-actions" },
            React.createElement(
              "button",
              {
                type: "button",
                className: "library-delete-cancel",
                onClick: () => setDeleteConfirmFile(null),
              },
              icon(keepIconPath),
              "Keep"
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "library-delete-confirm",
                onClick: confirmDeleteLibraryFile,
              },
              icon(trashIconPath),
              "Delete"
            )
          )
        )
      )
      : null,
    isCreateUserDialogOpen
      ? React.createElement(
        "div",
        {
          className: "panel-modal-backdrop",
          onClick: closeCreateUserDialog,
        },
        React.createElement(
          "section",
          {
            className: "library-upload-modal",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": "Create user",
            onClick: (event) => event.stopPropagation(),
          },
          React.createElement("h4", null, "New User"),
          React.createElement(
            "label",
            { className: "create-user-field-wrap" },
            React.createElement("span", { className: "create-user-field-label" }, "Username"),
            React.createElement("input", {
              type: "text",
              className: "library-upload-tags-input",
              placeholder: "username",
              value: newUserDraft.username,
              onChange: (event) => setNewUserDraft((previous) => ({ ...previous, username: event.target.value })),
              disabled: isCreateUserSubmitting,
            })
          ),
          React.createElement(
            "label",
            { className: "create-user-field-wrap" },
            React.createElement("span", { className: "create-user-field-label" }, "Display Name"),
            React.createElement("input", {
              type: "text",
              className: "library-upload-tags-input",
              placeholder: "display name",
              value: newUserDraft.displayName,
              onChange: (event) => setNewUserDraft((previous) => ({ ...previous, displayName: event.target.value })),
              disabled: isCreateUserSubmitting,
            })
          ),
          React.createElement(
            "label",
            { className: "create-user-field-wrap" },
            React.createElement("span", { className: "create-user-field-label" }, "Role"),
            React.createElement(
              "details",
              {
                className: "general-dropdown create-user-role-dropdown",
                open: isCreateUserRoleDropdownOpen,
                ref: createUserRoleDropdownRef,
              },
              React.createElement(
                "summary",
                {
                  className: "general-dropdown-trigger",
                  onClick: (event) => {
                    event.preventDefault();
                    if (isCreateUserSubmitting) return;
                    setIsCreateUserRoleDropdownOpen((previous) => !previous);
                  },
                },
                React.createElement("span", { className: "general-dropdown-value" }, newUserDraft.role === "admin" ? "admin" : "user"),
                React.createElement("span", { className: "general-dropdown-chevron", "aria-hidden": "true" }, icon(chevronDownIconPath))
              ),
              React.createElement(
                "div",
                { className: "general-dropdown-menu", role: "menu", "aria-label": "Select role" },
                ...[
                  { value: "users", label: "user" },
                  { value: "admin", label: "admin" },
                ].map((roleOption) => {
                  const active = newUserDraft.role === roleOption.value;
                  return React.createElement(
                    "button",
                    {
                      key: roleOption.value,
                      type: "button",
                      className: `general-dropdown-option${active ? " active" : ""}`,
                      role: "menuitemradio",
                      "aria-checked": active ? "true" : "false",
                      disabled: isCreateUserSubmitting,
                      onClick: (event) => {
                        event.preventDefault();
                        setNewUserDraft((previous) => ({ ...previous, role: roleOption.value }));
                        setIsCreateUserRoleDropdownOpen(false);
                      },
                    },
                    React.createElement(
                      "span",
                      { className: "general-dropdown-option-copy" },
                      React.createElement("strong", null, roleOption.label)
                    ),
                    active ? React.createElement("span", { className: "general-dropdown-check", "aria-hidden": "true" }, icon(checkIconPath)) : null
                  );
                })
              )
            )
          ),
          React.createElement(
            "div",
            { className: "library-upload-actions" },
            React.createElement(
              "button",
              {
                type: "button",
                className: "library-upload-cancel",
                onClick: closeCreateUserDialog,
                disabled: isCreateUserSubmitting,
              },
              "Cancel"
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "library-upload-confirm",
                onClick: confirmCreateUser,
                disabled: isCreateUserSubmitting || !String(newUserDraft.username || "").trim() || !String(newUserDraft.displayName || "").trim(),
              },
              icon(plusChatIconPath),
              isCreateUserSubmitting ? "Adding..." : "Add User"
            )
          )
        )
      )
      : null,
    deleteConfirmUser
      ? React.createElement(
        "div",
        {
          className: "panel-modal-backdrop",
          onClick: () => setDeleteConfirmUser(null),
        },
        React.createElement(
          "section",
          {
            className: "library-delete-modal",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": "Confirm user deletion",
            onClick: (event) => event.stopPropagation(),
          },
          React.createElement("h4", null, "Delete user?"),
          React.createElement(
            "p",
            null,
            "Are you sure you really want to delete this user?"
          ),
          React.createElement(
            "div",
            { className: "side-nav-user delete-user-preview" },
            React.createElement(
              "span",
              { className: "side-nav-avatar-placeholder", "aria-hidden": "true" },
              String(deleteConfirmUser?.username || "?").slice(0, 1).toUpperCase()
            ),
            React.createElement(
              "span",
              { className: "side-nav-user-meta" },
              React.createElement("strong", null, deleteConfirmUser?.displayName || deleteConfirmUser?.username || "Unknown user"),
              React.createElement("small", null, deleteConfirmUser?.username || "unknown")
            )
          ),
          React.createElement(
            "div",
            { className: "library-delete-actions" },
            React.createElement(
              "button",
              {
                type: "button",
                className: "library-delete-cancel",
                onClick: () => setDeleteConfirmUser(null),
              },
              icon(keepIconPath),
              "Keep"
            ),
            React.createElement(
              "button",
              {
                type: "button",
                className: "library-delete-confirm",
                onClick: confirmDeleteAdminUser,
              },
              icon(trashIconPath),
              "Delete"
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
          className: "panel-modal-backdrop panel-modal-backdrop-elevated",
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
            "Are you sure you want to delete this chat?"
          ),
          React.createElement(
            "div",
            { className: "composer-attachment-chip dialog-delete-chip dialog-delete-chat-chip" },
            React.createElement(
              "span",
              { className: "composer-attachment-icon is-black", "aria-hidden": "true" },
              React.createElement(
                "svg",
                { viewBox: "0 0 24 24", className: "composer-attachment-icon-svg" },
                React.createElement("path", { d: chatIconPath })
              )
            ),
            React.createElement(
              "span",
              { className: "composer-attachment-meta" },
              React.createElement("p", { className: "composer-attachment-name" }, deleteConfirmChat.name),
              React.createElement("p", { className: "composer-attachment-ext" }, "chat")
            )
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
    chatFilterDialogChat
      ? React.createElement(
        "div",
        {
          className: "panel-modal-backdrop panel-modal-backdrop-elevated",
          onClick: () => setChatFilterDialogChat(null),
        },
        React.createElement(
          "section",
          {
            className: "panel-modal chat-filter-modal",
            role: "dialog",
            "aria-modal": "true",
            "aria-label": `${chatFilterDialogChat.name} Filter`,
            onClick: (event) => event.stopPropagation(),
          },
          React.createElement(
            "div",
            { className: "panel-modal-head" },
            React.createElement("strong", null, `${chatFilterDialogChat.name} Filter`),
            React.createElement(
              "div",
              { className: "panel-modal-head-actions" },
              React.createElement(
                "button",
                {
                  className: "panel-close",
                  type: "button",
                  onClick: () => setChatFilterDialogChat(null),
                  "aria-label": `Close ${chatFilterDialogChat.name} filter`,
                },
                "×"
              )
            )
          ),
          React.createElement(
            "div",
            { className: "panel-modal-content" },
            renderPanelContent({
              panelData: { command: "/filter" },
              parsedInfoGroups: [],
              parsedAssistantPanel: null,
              parsedHelpPanel: null,
              editableConfigRows: [],
              restartConfigRows: [],
              retrieverStatus,
              embedderStatus,
              serviceStatuses,
              isSending,
              isEmbeddingReady,
              disabledAssistantModes: disabledAssistantModesList,
              submitConfigChange,
              applyPersonalizationChange,
              customInstructionsDraft,
              isCustomInstructionsDirty,
              updateCustomInstructionsDraft,
              saveCustomInstructions,
              nicknameDraft,
              occupationDraft,
              moreAboutUserDraft,
              isNicknameDirty,
              isOccupationDirty,
              isMoreAboutUserDirty,
              updateNicknameDraft,
              updateOccupationDraft,
              updateMoreAboutUserDraft,
              saveNickname,
              saveOccupation,
              saveMoreAboutUser,
              tagFilterRows,
              tagFilterEnabledByTag: chatTagFilterEnabledByChatId[chatFilterDialogChat.id] || tagFilterEnabledByTag,
              globalTagFilterEnabledByTag: tagFilterEnabledByTag,
              filterScope: "chat",
              toggleTagFilter: (tag) => toggleChatTagFilter(chatFilterDialogChat.id, tag),
              isTagFilterSaving: isChatFilterSaving,
              icon,
            })
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
            className: `panel-modal${isAuxiliaryDialogTab ? "" : " panel-modal-with-tabs"}`,
            role: "dialog",
            "aria-modal": "true",
            "aria-label": isAuxiliaryDialogTab ? `${activeDialogMeta.label} dialog` : "Preferences dialog",
            onClick: (event) => event.stopPropagation(),
          },
          isAuxiliaryDialogTab
            ? React.createElement(
              React.Fragment,
              null,
              React.createElement(
                "div",
                { className: "panel-modal-head" },
                React.createElement("strong", null, activeDialogMeta.label),
                React.createElement(
                  "div",
                  { className: "panel-modal-head-actions" },
                  React.createElement(
                    "button",
                    {
                      className: "panel-close",
                      type: "button",
                      onClick: () => setIsUnifiedDialogOpen(false),
                      "aria-label": `Close ${activeDialogMeta.label} dialog`,
                    },
                    "×"
                  )
                )
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
                        parsedHelpPanel,
                        editableConfigRows,
                        restartConfigRows,
                        retrieverStatus,
                        embedderStatus,
                        serviceStatuses,
                        isSending,
                        isEmbeddingReady,
                        disabledAssistantModes: disabledAssistantModesList,
                        submitConfigChange,
                        applyPersonalizationChange,
                        customInstructionsDraft,
                        isCustomInstructionsDirty,
                        updateCustomInstructionsDraft,
                        saveCustomInstructions,
                        nicknameDraft,
                        occupationDraft,
                        moreAboutUserDraft,
                        isNicknameDirty,
                        isOccupationDirty,
                        isMoreAboutUserDirty,
                        updateNicknameDraft,
                        updateOccupationDraft,
                        updateMoreAboutUserDraft,
                        saveNickname,
                        saveOccupation,
                        saveMoreAboutUser,
                        tagFilterRows,
                        tagFilterEnabledByTag,
                        globalTagFilterEnabledByTag: tagFilterEnabledByTag,
                        filterScope: "global",
                        toggleTagFilter,
                        isTagFilterSaving,
                        icon,
                        settingsTabError,
                        clearSettingsTabError: () => setSettingsTabError(""),
                        settingsInputResetTokenByKey,
                      })
                      : React.createElement("p", null, "No content available.")
              )
            )
            : React.createElement(
              "div",
              { className: "panel-modal-tab-layout" },
              React.createElement(
                "nav",
                { className: "panel-tab-nav", "aria-label": "Preferences sections" },
                React.createElement(
                  "div",
                  { className: "panel-tab-nav-top" },
                  React.createElement(
                    "button",
                    {
                      className: "panel-close panel-close-sidebar",
                      type: "button",
                      onClick: () => setIsUnifiedDialogOpen(false),
                      "aria-label": "Close preferences dialog",
                    },
                    "×"
                  )
                ),
                ...PREFERENCES_DIALOG_TABS.map((tab) => React.createElement(
                  "button",
                  {
                    key: tab.id,
                    type: "button",
                    className: `panel-tab-button${tab.id === activeDialogTab ? " active" : ""}`,
                    onClick: () => loadUnifiedDialogTab(tab.id),
                    disabled: isDialogTabLoading && tab.id === activeDialogTab,
                    "aria-current": tab.id === activeDialogTab ? "page" : undefined,
                  },
                  React.createElement("span", { className: "panel-tab-button-icon", "aria-hidden": "true" }, getDialogTabIcon(tab.id)),
                  React.createElement("span", null, tab.label)
                ))
              ),
              React.createElement(
                "div",
                { className: "panel-modal-content" },
                dialogTabError
                  ? React.createElement("p", { className: "panel-modal-error" }, `Error: ${dialogTabError}`)
                  : isDialogTabLoading && !activeModalPanel
                    ? React.createElement("p", { className: "panel-modal-loading" }, "Loading section…")
                    : activeDialogTab === "archive"
                      ? React.createElement(
                        "section",
                        { className: "archive-table-wrapper" },
                        React.createElement(
                          "div",
                          { className: "library-table archive-table", role: "table", "aria-label": "Archived chats" },
                          React.createElement(
                            "div",
                            { className: "library-table-head archive-table-head", role: "row" },
                            React.createElement("strong", { role: "columnheader" }, "Chat name"),
                            React.createElement("strong", { role: "columnheader" }, "Archived at"),
                            React.createElement("strong", { role: "columnheader" }, "Actions")
                          ),
                          React.createElement(
                            "div",
                            { className: "library-table-body", role: "rowgroup" },
                            archivedChatRows.length === 0
                              ? React.createElement("p", { className: "archive-empty" }, "No archived chats yet.")
                              : archivedChatRows.map((chat) => React.createElement(
                                "div",
                                { key: chat.id, className: "library-table-row archive-table-row", role: "row" },
                                React.createElement("strong", { className: "library-path archive-chat-name" }, chat.name),
                                React.createElement("span", { className: "archive-chat-date" }, chat.archivedAt ? new Date(chat.archivedAt).toLocaleString() : "n/a"),
                                React.createElement(
                                  "div",
                                  { className: "library-row-actions archive-row-actions" },
                                  React.createElement(
                                    "button",
                                    {
                                      type: "button",
                                      className: "library-toggle-button",
                                      title: "Download chat",
                                      "aria-label": `Download ${chat.name}`,
                                      onClick: async () => {
                                        try {
                                          await downloadChat(chat);
                                        } catch (error) {
                                          setMessages((prev) => prev.concat(createMessage("assistant", `Error: ${error.message}`, {
                                            evidenceSeverity: "error",
                                            isVolatile: true,
                                          })));
                                        }
                                      },
                                    },
                                    icon(downloadIconPath)
                                  ),
                                  React.createElement(
                                    "button",
                                    {
                                      type: "button",
                                      className: "library-toggle-button",
                                      title: "Unarchive chat",
                                      "aria-label": `Unarchive ${chat.name}`,
                                      onClick: () => unarchiveChat(chat.id),
                                      disabled: isChatActionPending,
                                    },
                                    icon(unarchiveIconPath)
                                  ),
                                  React.createElement(
                                    "button",
                                    {
                                      type: "button",
                                      className: "library-delete-button",
                                      title: "Delete chat",
                                      "aria-label": `Delete ${chat.name}`,
                                      onClick: () => setDeleteConfirmChat(chat),
                                      disabled: isChatActionPending,
                                    },
                                    icon(trashIconPath)
                                  )
                                )
                              ))
                          )
                        )
                      )
                      : activeModalPanel
                      ? renderPanelContent({
                        panelData: activeModalPanel,
                        parsedInfoGroups,
                        parsedAssistantPanel,
                        parsedHelpPanel,
                        editableConfigRows,
                        restartConfigRows,
                        retrieverStatus,
                        embedderStatus,
                        serviceStatuses,
                        isSending,
                        isEmbeddingReady,
                        disabledAssistantModes: disabledAssistantModesList,
                        submitConfigChange,
                        applyPersonalizationChange,
                        customInstructionsDraft,
                        isCustomInstructionsDirty,
                        updateCustomInstructionsDraft,
                        saveCustomInstructions,
                        nicknameDraft,
                        occupationDraft,
                        moreAboutUserDraft,
                        isNicknameDirty,
                        isOccupationDirty,
                        isMoreAboutUserDirty,
                        updateNicknameDraft,
                        updateOccupationDraft,
                        updateMoreAboutUserDraft,
                        saveNickname,
                        saveOccupation,
                        saveMoreAboutUser,
                        tagFilterRows,
                        tagFilterEnabledByTag,
                        globalTagFilterEnabledByTag: tagFilterEnabledByTag,
                        filterScope: "global",
                        toggleTagFilter,
                        isTagFilterSaving,
                        icon,
                        settingsTabError,
                        clearSettingsTabError: () => setSettingsTabError(""),
                        settingsInputResetTokenByKey,
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
              parsedHelpPanel,
              editableConfigRows,
              restartConfigRows,
              retrieverStatus,
              embedderStatus,
              serviceStatuses,
              isSending,
              isEmbeddingReady,
              disabledAssistantModes: disabledAssistantModesList,
              submitConfigChange,
              applyPersonalizationChange,
              customInstructionsDraft,
              isCustomInstructionsDirty,
              updateCustomInstructionsDraft,
              saveCustomInstructions,
              nicknameDraft,
              occupationDraft,
              moreAboutUserDraft,
              isNicknameDirty,
              isOccupationDirty,
              isMoreAboutUserDirty,
              updateNicknameDraft,
              updateOccupationDraft,
              updateMoreAboutUserDraft,
              saveNickname,
              saveOccupation,
              saveMoreAboutUser,
              tagFilterRows,
              tagFilterEnabledByTag,
              globalTagFilterEnabledByTag: tagFilterEnabledByTag,
              filterScope: "global",
              toggleTagFilter,
              isTagFilterSaving,
              icon,
              settingsTabError,
              clearSettingsTabError: () => setSettingsTabError(""),
              settingsInputResetTokenByKey,
            })
          )
        )
      )
      : null
  );
}

createRoot(document.getElementById("root")).render(React.createElement(App));
