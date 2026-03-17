import React, { useMemo, useState } from "https://esm.sh/react@18";
import { createRoot } from "https://esm.sh/react-dom@18/client";

const API_BASE_URL = window.__API_BASE_URL__ || "http://localhost:3000";

function statusColor(ready) {
  if (ready === true) return "ok";
  if (ready === false) return "warn";
  return "unknown";
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
  const [messages, setMessages] = useState([
    {
      id: crypto.randomUUID(),
      role: "assistant",
      text: "Hi! Ask me something about your indexed documents.",
      evidenceSeverity: null,
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [statusData, setStatusData] = useState(null);
  const [filesData, setFilesData] = useState(null);

  const statusBadges = useMemo(() => formatSystemStatus(statusData, filesData), [statusData, filesData]);

  async function refreshStatus() {
    try {
      const [statusRes, filesRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/status`),
        fetch(`${API_BASE_URL}/api/files`),
      ]);

      if (statusRes.ok) setStatusData(await statusRes.json());
      if (filesRes.ok) setFilesData(await filesRes.json());
    } catch {
      setStatusData(null);
      setFilesData(null);
    }
  }

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
      await refreshStatus();
    } catch (error) {
      setMessages((prev) => prev.concat({
        id: crypto.randomUUID(),
        role: "assistant",
        text: `Error: ${error.message}`,
        evidenceSeverity: "error",
      }));
    } finally {
      setIsSending(false);
    }
  }

  return React.createElement(
    "div",
    { className: "page" },
    React.createElement(
      "header",
      { className: "topbar" },
      React.createElement("h1", null, "local RAG"),
      React.createElement("button", { type: "button", onClick: refreshStatus }, "Refresh status")
    ),
    React.createElement(
      "section",
      { className: "badges" },
      ...statusBadges.map((badge) => React.createElement(
        "div",
        { key: badge.label, className: `badge ${badge.color}`, title: badge.title || "" },
        React.createElement("span", null, badge.label),
        React.createElement("strong", null, badge.value)
      ))
    ),
    React.createElement(
      "section",
      { className: "chat" },
      ...messages.map((message) => React.createElement(
        "article",
        { key: message.id, className: `msg ${message.role}` },
        React.createElement(
          "div",
          { className: "msg-header" },
          React.createElement("span", null, message.role === "user" ? "You" : "Assistant"),
          message.evidenceSeverity
            ? React.createElement("small", null, `evidence: ${message.evidenceSeverity}`)
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
        placeholder: "Ask a question...",
        disabled: isSending,
      }),
      React.createElement(
        "button",
        { type: "submit", disabled: isSending || !inputValue.trim() },
        isSending ? "Sending..." : "Send"
      )
    )
  );
}

createRoot(document.getElementById("root")).render(React.createElement(App));
