export function buildChatDownloadFileName(chat) {
  return `${String(chat?.name || chat?.id || "chat")
    .replace(/[^a-z0-9-_]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "chat"}.json`;
}

export function buildFallbackChatExportPayload({ sessionId, chat, selectedChat, messages }) {
  return {
    exportedAt: new Date().toISOString(),
    sessionId,
    chat: selectedChat || {
      id: chat?.id,
      name: chat?.name,
      status: "active",
    },
    messages: Array.isArray(messages) ? messages : [],
  };
}

export function triggerJsonDownload(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
