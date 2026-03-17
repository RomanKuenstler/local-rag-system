import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";

const API_BASE_URL = window.__API_BASE_URL__ || "http://localhost:3000";
const PANEL_COMMANDS = new Set(["/info", "/config", "/lib", "/assistant", "/help", "?"]);

function statusColor(ready) {
  if (ready === true) return "ok";
  if (ready === false) return "warn";
  return "unknown";
}

function formatSeverityLabel(severity) {
  if (!severity) return "";
  return String(severity).replace(/[_-]+/g, " ");
}

function formatSystemStatus(statusData, filesData) {
  const readiness = statusData?.embedding?.readiness;
  const fileSummary = filesData ? `${filesData.embeddedFiles}/${filesData.totalFiles} embedded` : "n/a";

  return [
    { label: "Retriever", value: statusData?.app?.role || "unknown", color: "ok" },
    {
      label: "Embedding",
      value: readiness?.status || "unknown",
      color: statusColor(readiness?.ready),
      title: readiness?.message,
    },
    { label: "Files", value: fileSummary, color: filesData ? "ok" : "unknown" },
  ];
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
  const [openDropdown, setOpenDropdown] = useState(null);

  const previousEmbeddingReadyRef = useRef(null);
  const pollTimeoutRef = useRef(null);
  const lastMessageRef = useRef(null);
  const composerInputRef = useRef(null);
  const dropdownRef = useRef(null);

  const isEmbeddingReady = statusData?.embedding?.readiness?.ready === true;
  const statusBadges = useMemo(() => formatSystemStatus(statusData, filesData), [statusData, filesData]);
  const availableModes = statusData?.assistant?.availableModes || [];
  const availableProfiles = statusData?.assistant?.availableProfiles || [];

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
    function closeDropdownOnOutside(event) {
      if (!dropdownRef.current?.contains(event.target)) {
        setOpenDropdown(null);
      }
    }

    document.addEventListener("pointerdown", closeDropdownOnOutside);
    return () => document.removeEventListener("pointerdown", closeDropdownOnOutside);
  }, []);

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

    try {
      const response = await fetch(`${API_BASE_URL}/api/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, sessionId: "webui-default-session" }),
      });

      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Request failed");

      if (isPanelCommand) {
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
        setMessages((prev) => prev.concat({
          id: crypto.randomUUID(),
          role: "assistant",
          text: payload.answer || "No answer generated.",
          evidenceSeverity: payload.evidenceSeverity || null,
          responseType: payload.responseType || null,
        }));
      }
    } catch (error) {
      setMessages((prev) => prev.concat({
        id: crypto.randomUUID(),
        role: "assistant",
        text: `Error: ${error.message}`,
        evidenceSeverity: "error",
        responseType: null,
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

  async function setAssistantMode(modeId) {
    if (!modeId) return;
    setOpenDropdown(null);
    await sendRawPrompt(`/assistant ${modeId}`);
  }

  async function setProfile(profileId) {
    if (!profileId) return;
    setOpenDropdown(null);
    await sendRawPrompt(`/profile ${profileId}`);
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

  const renderStatusDropdown = (id, label, value, options, onPick) => React.createElement(
    "div",
    { className: "status-chip ok status-chip-dropdown", ref: openDropdown === id ? dropdownRef : null },
    React.createElement("span", { className: "status-dot", "aria-hidden": "true" }),
    React.createElement(
      "button",
      {
        type: "button",
        className: "status-chip-trigger",
        disabled: isSending || !isEmbeddingReady,
        onClick: () => setOpenDropdown((current) => (current === id ? null : id)),
      },
      React.createElement("span", { className: "status-label" }, label),
      React.createElement(
        "span",
        { className: "status-value" },
        options.find((item) => item.id === value)?.label || value || "unknown"
      ),
      React.createElement("span", { className: "status-chevron", "aria-hidden": "true" }, "▾")
    ),
    openDropdown === id
      ? React.createElement(
        "div",
        { className: "status-dropdown" },
        ...options.map((item) => React.createElement(
          "button",
          {
            key: item.id,
            type: "button",
            className: `status-dropdown-item ${item.id === value ? "active" : ""}`,
            onClick: () => onPick(item.id),
          },
          React.createElement("strong", null, item.label || item.id),
          item.description ? React.createElement("small", null, item.description) : null
        ))
      )
      : null
  );

  return React.createElement(
    "div",
    { className: "page" },
    React.createElement(
      "header",
      { className: "topbar" },
      React.createElement(
        "div",
        { className: "brand" },
        React.createElement("h1", null, "local RAG"),
        React.createElement("small", null, "Private document assistant")
      ),
      React.createElement("div", { className: "header-center-spacer", "aria-hidden": "true" }),
      React.createElement(
        "div",
        { className: "quick-actions" },
        React.createElement(
          "button",
          { type: "button", onClick: () => sendRawPrompt("/info"), disabled: isSending || !isEmbeddingReady },
          icon("M11 10h2v7h-2zm0-3h2v2h-2zm1-5C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"),
          React.createElement("span", null, "Info")
        ),
        React.createElement(
          "button",
          { type: "button", onClick: () => sendRawPrompt("/config"), disabled: isSending || !isEmbeddingReady },
          icon("M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.48 7.48 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.89 2h-3.78a.5.5 0 0 0-.49.42l-.36 2.54c-.58.22-1.13.53-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.61.22l2.39-.96c.5.41 1.05.72 1.63.94l.36 2.54c.04.24.24.42.49.42h3.78c.25 0 .45-.18.49-.42l.36-2.54c.58-.22 1.13-.53 1.63-.94l2.39.96c.23.09.48 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z"),
          React.createElement("span", null, "Config")
        ),
        React.createElement(
          "button",
          { type: "button", onClick: () => sendRawPrompt("/assistant"), disabled: isSending || !isEmbeddingReady },
          icon("M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v3h20v-3c0-3.33-6.67-5-10-5z"),
          React.createElement("span", null, "Assistant")
        ),
        React.createElement(
          "button",
          { type: "button", onClick: () => sendRawPrompt("/lib"), disabled: isSending || !isEmbeddingReady },
          icon("M4 6.5C4 5.12 5.12 4 6.5 4H20v15H6.5A2.5 2.5 0 0 1 4 16.5zm2.5-.5a.5.5 0 0 0 0 1H18V6zM18 18v-8H6.5a1.5 1.5 0 0 0 0 3H18"),
          React.createElement("span", null, "Library")
        )
      )
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
          panelData
            ? React.createElement(
              "aside",
              { className: "info-panel", key: panelData.id },
              React.createElement(
                "div",
                { className: "info-panel-head" },
                React.createElement("strong", null, panelTitle),
                panelData.severity
                  ? React.createElement(
                    "small",
                    { className: `evidence-pill ${panelData.severity}` },
                    formatSeverityLabel(panelData.severity)
                  )
                  : null
              ),
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
            : null,
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
              className: `msg ${message.role}`,
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
      ),
      React.createElement(
        "aside",
        { className: "status-rail" },
        ...statusBadges.map((badge) => React.createElement(
          "div",
          { key: badge.label, className: `status-chip ${badge.color}`, title: badge.title || "" },
          React.createElement("span", { className: "status-dot", "aria-hidden": "true" }),
          React.createElement(
            "div",
            { className: "status-meta" },
            React.createElement("span", { className: "status-label" }, badge.label),
            React.createElement("strong", { className: "status-value" }, badge.value)
          )
        )),
        React.createElement(
          "div",
          { className: "status-chip ok" },
          React.createElement("span", { className: "status-dot", "aria-hidden": "true" }),
          React.createElement(
            "div",
            { className: "status-meta" },
            React.createElement("span", { className: "status-label" }, "Mode"),
            React.createElement("strong", { className: "status-value" }, statusData?.app?.uiMode || "webui")
          )
        ),
        renderStatusDropdown("assistant", "Assistant mode", statusData?.assistant?.mode || "", availableModes, setAssistantMode),
        renderStatusDropdown("profile", "Profile", statusData?.assistant?.profile || "", availableProfiles, setProfile)
      )
    )
  );
}

createRoot(document.getElementById("root")).render(React.createElement(App));
