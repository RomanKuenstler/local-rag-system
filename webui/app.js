import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";

const API_BASE_URL = window.__API_BASE_URL__ || "http://localhost:3000";

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
    {
      label: "Mode",
      value: statusData?.assistant?.mode || "unknown",
      color: statusData?.assistant?.mode ? "ok" : "unknown",
    },
    {
      label: "Profile",
      value: statusData?.assistant?.profile || "unknown",
      color: statusData?.assistant?.profile ? "ok" : "unknown",
    },
    { label: "Files", value: fileSummary, color: filesData ? "ok" : "unknown" },
  ];
}

function App() {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [statusData, setStatusData] = useState(null);
  const [filesData, setFilesData] = useState(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [hasShownReadyGreeting, setHasShownReadyGreeting] = useState(false);

  const previousEmbeddingReadyRef = useRef(null);
  const pollTimeoutRef = useRef(null);

  const isEmbeddingReady = statusData?.embedding?.readiness?.ready === true;
  const statusBadges = useMemo(() => formatSystemStatus(statusData, filesData), [statusData, filesData]);

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

  async function sendPrompt(event) {
    event.preventDefault();
    const prompt = inputValue.trim();
    if (!prompt || isSending) return;

    setMessages((prev) => prev.concat({
      id: crypto.randomUUID(),
      role: "user",
      text: prompt,
      evidenceSeverity: null,
    }));
    setInputValue("");

    if (!isEmbeddingReady) {
      setMessages((prev) => prev.concat({
        id: crypto.randomUUID(),
        role: "assistant",
        text: "Embedding is still running. Please wait until indexing is finished before sending prompts.",
        evidenceSeverity: "warn",
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

      setMessages((prev) => prev.concat({
        id: crypto.randomUUID(),
        role: "assistant",
        text: payload.answer || "",
        evidenceSeverity: payload.evidenceSeverity || "unknown",
      }));
    } catch (error) {
      setMessages((prev) => prev.concat({
        id: crypto.randomUUID(),
        role: "assistant",
        text: `Error: ${error.message}`,
        evidenceSeverity: "error",
      }));
    } finally {
      setIsSending(false);
      await refreshStatus();
    }
  }

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
      ))
    ),
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
      ...messages.map((message) => React.createElement(
        "article",
        { key: message.id, className: `msg ${message.role}` },
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
        React.createElement("p", null, message.text)
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
        isSending ? "Sending..." : "Send"
      )
    )
  );
}

createRoot(document.getElementById("root")).render(React.createElement(App));
