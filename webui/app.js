import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";
import {
  API_BASE_URL,
  PANEL_COMMANDS,
  createMessage,
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

function App() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [panelData, setPanelData] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [statusData, setStatusData] = useState(null);
  const [filesData, setFilesData] = useState(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [hasShownReadyGreeting, setHasShownReadyGreeting] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const previousEmbeddingReadyRef = useRef(null);
  const pollTimeoutRef = useRef(null);
  const lastMessageRef = useRef(null);
  const composerInputRef = useRef(null);
  const menuRef = useRef(null);

  const isEmbeddingReady = statusData?.embedding?.readiness?.ready === true;
  const healthState = useMemo(() => getOverallHealth(statusData, filesData), [statusData, filesData]);

  async function refreshStatus() {
    try {
      const [statusRes, filesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/status`),
        fetch(`${API_BASE_URL}/api/files`),
      ]);

      if (statusRes.ok) {
        const newStatus = await statusRes.json();
        setStatusData((previous) => {
          const previousReady = previous?.embedding?.readiness?.ready === true;
          const nextReady = newStatus?.embedding?.readiness?.ready === true;

          if (!previousReady && nextReady && !hasShownReadyGreeting) {
            setMessages((prev) => prev.concat(createMessage("assistant", "How can I help you today?")));
            setHasShownReadyGreeting(true);
          }

          previousEmbeddingReadyRef.current = nextReady;
          return newStatus;
        });
      }

      if (filesRes.ok) {
        setFilesData(await filesRes.json());
      }
    } catch {
      setStatusData(null);
      setFilesData(null);
    } finally {
      setIsLoadingStatus(false);
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

  async function sendRawPrompt(rawPrompt) {
    const prompt = String(rawPrompt || "").trim();
    const isPanelCommand = PANEL_COMMANDS.has(prompt.toLowerCase());
    if (!prompt || isSending) return;

    if (!isPanelCommand) {
      setMessages((prev) => prev.concat(createMessage("user", prompt)));
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
        { evidenceSeverity: "warn" }
      )));
      return;
    }

    setIsSending(true);
    const pendingMessageId = crypto.randomUUID();
    setMessages((prev) => prev.concat(createMessage("assistant", "Assistant is thinking…", { id: pendingMessageId, isPending: true })));

    try {
      const response = await fetch(`${API_BASE_URL}/api/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, sessionId: "webui-default-session" }),
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
          isPending: false,
        };
      }));
    } finally {
      setIsSending(false);
      await refreshStatus();
    }
  }

  async function fetchPanelCommand(command) {
    const response = await fetch(`${API_BASE_URL}/api/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: command, sessionId: "webui-default-session" }),
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
      const [assistantPayload, profilePayload] = await Promise.all([
        fetchPanelCommand("/assistant"),
        fetchPanelCommand("/profile"),
      ]);

      setPanelData({
        id: crypto.randomUUID(),
        command: "/personalization",
        title: "Personalization",
        content: {
          assistant: parseAssistantModeContent(assistantPayload.answer || ""),
          profile: parseProfileContent(profilePayload.answer || ""),
        },
        severity: null,
        responseType: null,
        configView: null,
      });
    } catch (error) {
      setMessages((prev) => prev.concat(createMessage("assistant", `Error: ${error.message}`, { evidenceSeverity: "error" })));
    } finally {
      setIsSending(false);
      await refreshStatus();
    }
  }

  async function sendPrompt(event) {
    event.preventDefault();
    await sendRawPrompt(inputValue);
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
  const retrieverStatus = normalizeStatusBadge(statusData?.app?.role);
  const embedderStatus = normalizeStatusBadge(statusData?.embedding?.readiness?.status);

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
      React.createElement("div", { className: "quick-actions", "aria-hidden": "true" })
    ),
    React.createElement(
      "div",
      { className: "workspace" },
      React.createElement(
        "section",
        { className: "chat-column" },
        React.createElement(
          "section",
          { className: "chat" },
          !isEmbeddingReady && !isLoadingStatus
            ? null
            : messages.map((message, index) => React.createElement(
              "article",
              {
                key: message.id,
                className: `msg ${message.role}${message.isPending ? " pending" : ""}`,
                ref: index === messages.length - 1 ? lastMessageRef : null,
              },
              React.createElement(
                "div",
                { className: "msg-header" },
                React.createElement("span", null, message.role === "user" ? "You" : "Assistant"),
                message.evidenceSeverity
                  ? React.createElement(
                    "small",
                    { className: `evidence-pill ${message.evidenceSeverity}` },
                    `evidence: ${formatSeverityLabel(message.evidenceSeverity)}`
                  )
                  : null
              ),
              message.responseType
                ? React.createElement(
                  "div",
                  { className: `msg-command ${message.responseType}` },
                  React.createElement("pre", null, message.text)
                )
                : React.createElement("p", null, message.text)
            ))
        ),
        React.createElement(
          "form",
          { className: "composer", onSubmit: sendPrompt },
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
                  void sendRawPrompt(inputValue);
                }
              }
            },
            rows: 1,
            placeholder: "Ask anything about your knowledge base...",
            disabled: isSending || !isEmbeddingReady,
          }),
          React.createElement(
            "button",
            { className: "send", type: "submit", disabled: isSending || !isEmbeddingReady || !inputValue.trim() },
            icon("M2 21l20-9L2 3v7l14 2-14 2z"),
            React.createElement("span", null, isSending ? "Sending..." : "Send")
          )
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
    !isEmbeddingReady && !isLoadingStatus
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
              icon,
            })
          )
        )
      )
      : null
  );
}

createRoot(document.getElementById("root")).render(React.createElement(App));
