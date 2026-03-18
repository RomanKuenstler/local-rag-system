import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";

const API_BASE_URL = window.__API_BASE_URL__ || "http://localhost:3000";
const PANEL_COMMANDS = new Set(["/info", "/config", "/lib", "/assistant", "/help", "?"]);

function formatSeverityLabel(severity) {
  if (!severity) return "";
  return String(severity).replace(/[_-]+/g, " ");
}

function getOverallHealth(statusData, filesData) {
  const readiness = statusData?.embedding?.readiness;
  const readinessText = String(readiness?.status || "").toLowerCase();
  if (!statusData) return "error";
  if (readinessText.includes("error") || readinessText.includes("fail")) return "error";
  if (readiness?.ready === true && filesData) return "ok";
  return "warn";
}

function parseAssistantModeContent(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const modes = [];
  let currentMode = null;

  for (const line of lines) {
    if (line.startsWith("- ")) {
      const body = line.slice(2);
      const colonIndex = body.indexOf(":");
      if (colonIndex > -1) {
        modes.push({
          id: body.slice(0, colonIndex).trim(),
          description: body.slice(colonIndex + 1).trim(),
        });
      }
      continue;
    }

    if (line.toLowerCase().startsWith("current mode:")) {
      currentMode = line.slice("current mode:".length).trim();
    }
  }

  return { modes, currentMode };
}

function parseSystemInfoContent(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith("- "));

  const entries = lines.map((line) => {
    const body = line.slice(2);
    const idx = body.indexOf(":");
    if (idx === -1) return { key: body, value: "" };
    return {
      key: body.slice(0, idx).trim(),
      value: body.slice(idx + 1).trim(),
    };
  });

  const groups = [
    {
      title: "App",
      keys: ["app", "ui mode", "assistant mode", "profile"],
    },
    {
      title: "Models",
      keys: ["chat model", "embedding model"],
    },
    {
      title: "Storage",
      keys: ["vector db", "collection", "content path", "embeddable extensions", "chat history dir"],
    },
  ];

  return groups
    .map((group) => ({
      ...group,
      items: entries.filter((entry) => group.keys.includes(entry.key.toLowerCase())),
    }))
    .filter((group) => group.items.length > 0);
}

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
            setMessages((prev) => prev.concat({
              id: crypto.randomUUID(),
              role: "assistant",
              text: "How can I help you today?",
              evidenceSeverity: null,
              responseType: null,
            }));
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

  function parsePanelText(text) {
    if (!text) return null;

    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // keep plain text rendering
    }

    return text
      .split(/\n{2,}/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
  }

  function resizeComposerInput(element) {
    if (!element) return;
    const computed = window.getComputedStyle(element);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 22;
    const padTop = Number.parseFloat(computed.paddingTop) || 0;
    const padBottom = Number.parseFloat(computed.paddingBottom) || 0;
    const minHeight = Math.ceil(lineHeight + padTop + padBottom);

    element.style.height = "auto";
    const nextHeight = Math.min(Math.max(element.scrollHeight, minHeight), 192);
    element.style.height = `${nextHeight}px`;
  }

  async function sendRawPrompt(rawPrompt) {
    const prompt = String(rawPrompt || "").trim();
    const isPanelCommand = PANEL_COMMANDS.has(prompt.toLowerCase());
    if (!prompt || isSending) return;

    if (!isPanelCommand) {
      setMessages((prev) => prev.concat({
        id: crypto.randomUUID(),
        role: "user",
        text: prompt,
        evidenceSeverity: null,
        responseType: null,
      }));
    }

    setInputValue("");
    if (composerInputRef.current) {
      composerInputRef.current.style.height = "";
      resizeComposerInput(composerInputRef.current);
    }

    if (!isEmbeddingReady) {
      setMessages((prev) => prev.concat({
        id: crypto.randomUUID(),
        role: "assistant",
        text: "Embedding is still running. Please wait until indexing is finished before sending prompts.",
        evidenceSeverity: "warn",
        responseType: null,
      }));
      return;
    }

    setIsSending(true);
    const pendingMessageId = crypto.randomUUID();
    setMessages((prev) => prev.concat({
      id: pendingMessageId,
      role: "assistant",
      text: "Assistant is thinking…",
      evidenceSeverity: null,
      responseType: null,
      isPending: true,
    }));

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
          configView: payload.webConfigView || null,
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

  const panelTitle = panelData?.command === "/info"
    ? "System Information"
    : panelData?.command === "/config"
      ? "Current Configuration"
      : panelData?.command === "/lib"
        ? "Library Overview"
        : panelData?.command === "/assistant"
          ? "Assistant Modes"
          : panelData?.command === "/help" || panelData?.command === "?"
            ? "Quick Help"
            : "Details";

  const parsedAssistantPanel = panelData?.command === "/assistant"
    ? parseAssistantModeContent(Array.isArray(panelData.content) ? panelData.content.join("\n") : String(panelData.content || ""))
    : null;
  const parsedInfoGroups = panelData?.command === "/info"
    ? parseSystemInfoContent(Array.isArray(panelData.content) ? panelData.content.join("\n") : String(panelData.content || ""))
    : [];

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
            ? React.createElement(
              "div",
              { className: "embedding-loading" },
              React.createElement("span", { className: "spinner", "aria-hidden": "true" }),
              React.createElement("strong", null, "Embedding in progress"),
              React.createElement("p", null, "Your documents are being indexed. You can type a prompt, and I’ll remind you to wait until indexing completes.")
            )
            : null,
          ...messages.map((message, index) => React.createElement(
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
                if (inputValue.trim() && !isSending) {
                  void sendRawPrompt(inputValue);
                }
              }
            },
            rows: 1,
            placeholder: "Ask anything about your knowledge base...",
            disabled: isSending,
          }),
          React.createElement(
            "button",
            { className: "send", type: "submit", disabled: isSending || !inputValue.trim() },
            icon("M12 4l7 7h-4v9h-6v-9H5z"),
            React.createElement("span", null, isSending ? "Sending..." : "Send")
          )
        ),
        React.createElement(
          "div",
          { className: "composer-meta" },
          React.createElement(
            "button",
            {
              type: "button",
              className: "quick-help-link",
              onClick: () => sendRawPrompt("/help"),
              disabled: isSending || !isEmbeddingReady,
            },
            "Quick help"
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
            "Info"
          ),
          React.createElement(
            "button",
            { type: "button", onClick: async () => { setIsMenuOpen(false); await sendRawPrompt("/config"); }, disabled: isSending || !isEmbeddingReady },
            "Config"
          ),
          React.createElement(
            "button",
            {
              type: "button",
              onClick: () => {
                setIsMenuOpen(false);
                setPanelData({
                  id: crypto.randomUUID(),
                  command: "/status",
                  title: "Status",
                  content: {
                    retriever: statusData?.app?.role || "unknown",
                    embedding: statusData?.embedding?.readiness?.status || "unknown",
                    files: filesData ? `${filesData.embeddedFiles}/${filesData.totalFiles} embedded` : "n/a",
                    assistantMode: statusData?.assistant?.mode || "n/a",
                    profile: statusData?.assistant?.profile || "n/a",
                  },
                  severity: healthState === "error" ? "error" : healthState === "warn" ? "warn" : "ok",
                  responseType: null,
                  configView: null,
                });
              },
            },
            "Status"
          )
        )
        : null,
      React.createElement(
        "button",
        { className: "floating-menu-toggle", type: "button", onClick: () => setIsMenuOpen((current) => !current) },
        isMenuOpen ? "Close" : "Menu"
      )
    ),
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
            panelData.command === "/config" && panelData.configView
              ? React.createElement(
                "div",
                { className: "config-sections" },
                ...panelData.configView.sections.map((section) => React.createElement(
                  "div",
                  { key: section.id, className: "config-section" },
                  React.createElement("h4", null, section.label),
                  ...section.entries.map((entry) => React.createElement(
                    "div",
                    { key: `${section.id}-${entry.key}`, className: "info-row" },
                    React.createElement("span", null, entry.key),
                    entry.editable
                      ? React.createElement(
                        "form",
                        {
                          className: "config-edit-form",
                          onSubmit: async (event) => {
                            event.preventDefault();
                            const formData = new FormData(event.currentTarget);
                            await submitConfigChange(entry.key, formData.get("value"));
                          },
                        },
                        React.createElement("input", {
                          name: "value",
                          defaultValue: String(entry.value),
                          className: "config-input",
                          disabled: isSending || !isEmbeddingReady,
                        }),
                        React.createElement("button", { type: "submit", disabled: isSending || !isEmbeddingReady }, "Apply")
                      )
                      : React.createElement("strong", null, String(entry.value))
                  ))
                )),
                React.createElement("p", { className: "config-help" }, panelData.configView.help)
              )
              : panelData.command === "/info"
                ? React.createElement(
                  "div",
                  { className: "info-groups" },
                  ...parsedInfoGroups.map((group) => React.createElement(
                    "section",
                    { key: group.title, className: "info-group-card" },
                    React.createElement("h4", null, group.title),
                    ...group.items.map((item) => React.createElement(
                      "div",
                      { key: `${group.title}-${item.key}`, className: "info-row" },
                      React.createElement("span", null, item.key),
                      React.createElement("strong", null, item.value)
                    ))
                  ))
                )
                : panelData.command === "/assistant" && parsedAssistantPanel
                  ? React.createElement(
                    "div",
                    { className: "assistant-mode-grid" },
                    parsedAssistantPanel.currentMode
                      ? React.createElement("div", { className: "assistant-current" }, `Current mode: ${parsedAssistantPanel.currentMode}`)
                      : null,
                    ...parsedAssistantPanel.modes.map((mode) => React.createElement(
                      "article",
                      { key: mode.id, className: `assistant-mode-card ${mode.id === parsedAssistantPanel.currentMode ? "active" : ""}` },
                      React.createElement("strong", null, mode.id),
                      React.createElement("p", null, mode.description)
                    ))
                  )
                  : Array.isArray(panelData.content)
                    ? panelData.content.map((item, idx) => React.createElement("p", { key: `${panelData.id}-${idx}` }, item))
                    : typeof panelData.content === "object" && panelData.content !== null
                      ? Object.entries(panelData.content).map(([key, value]) => React.createElement(
                        "div",
                        { key, className: "info-row" },
                        React.createElement("span", null, key),
                        React.createElement("strong", null, typeof value === "object" ? JSON.stringify(value) : String(value))
                      ))
                      : React.createElement("p", null, String(panelData.content || "No data available."))
          )
        )
      )
      : null
  );
}

createRoot(document.getElementById("root")).render(React.createElement(App));
