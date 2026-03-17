import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";

const API_BASE_URL = window.__API_BASE_URL__ || "http://localhost:3000";
const PANEL_COMMANDS = new Set(["/info", "/config", "/lib"]);

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
  const fileSummary = filesData
    ? `${filesData.embeddedFiles}/${filesData.totalFiles} embedded`
    : "n/a";

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

function App() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [panelData, setPanelData] = useState(null);
  const [isSending, setIsSending] = useState(false);
  const [statusData, setStatusData] = useState(null);
  const [filesData, setFilesData] = useState(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [hasShownReadyGreeting, setHasShownReadyGreeting] = useState(false);

  const previousEmbeddingReadyRef = useRef(null);
  const pollTimeoutRef = useRef(null);
  const lastMessageRef = useRef(null);

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
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
      }
    };
  }, [hasShownReadyGreeting]);

  useEffect(() => {
    if (lastMessageRef.current) {
      lastMessageRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [messages]);

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
        });
      } else {
        setMessages((prev) => prev.concat({
          id: crypto.randomUUID(),
          role: "assistant",
          text: payload.answer || "",
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
    await sendRawPrompt(`/assistant ${modeId}`);
  }

  async function setProfile(profileId) {
    await sendRawPrompt(`/profile ${profileId}`);
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
        : "Details";

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
          { type: "button", onClick: () => sendRawPrompt("/lib"), disabled: isSending || !isEmbeddingReady },
          icon("M4 6.5C4 5.12 5.12 4 6.5 4H20v15H6.5A2.5 2.5 0 0 1 4 16.5zm2.5-.5a.5.5 0 0 0 0 1H18V6zM18 18v-8H6.5a1.5 1.5 0 0 0 0 3H18"),
          React.createElement("span", null, "Library")
        )
      )
    ),
    React.createElement(
      "section",
      { className: "status-strip" },
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
        { className: "status-chip ok selectable" },
        React.createElement("span", { className: "status-dot", "aria-hidden": "true" }),
        React.createElement(
          "div",
          { className: "status-meta" },
          React.createElement("span", { className: "status-label" }, "Mode"),
          React.createElement(
            "select",
            {
              className: "status-select",
              value: statusData?.assistant?.mode || "",
              onChange: (event) => setAssistantMode(event.target.value),
              disabled: isSending || !isEmbeddingReady,
            },
            ...availableModes.map((mode) => React.createElement("option", { key: mode.id, value: mode.id }, mode.label || mode.id))
          )
        )
      ),
      React.createElement(
        "div",
        { className: "status-chip ok selectable" },
        React.createElement("span", { className: "status-dot", "aria-hidden": "true" }),
        React.createElement(
          "div",
          { className: "status-meta" },
          React.createElement("span", { className: "status-label" }, "Profile"),
          React.createElement(
            "select",
            {
              className: "status-select",
              value: statusData?.assistant?.profile || "",
              onChange: (event) => setProfile(event.target.value),
              disabled: isSending || !isEmbeddingReady,
            },
            ...availableProfiles.map((profile) => React.createElement("option", { key: profile.id, value: profile.id }, profile.label || profile.id))
          )
        )
      )
    ),
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
          Array.isArray(panelData.content)
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
      React.createElement("input", {
        value: inputValue,
        onChange: (event) => setInputValue(event.target.value),
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
      React.createElement("span", null, "Quick command:"),
      React.createElement(
        "button",
        { type: "button", onClick: () => sendRawPrompt("/help"), disabled: isSending || !isEmbeddingReady },
        "/help"
      ),
      React.createElement(
        "button",
        { type: "button", onClick: () => sendRawPrompt("?"), disabled: isSending || !isEmbeddingReady },
        "?"
      )
    )
  );
}

createRoot(document.getElementById("root")).render(React.createElement(App));
