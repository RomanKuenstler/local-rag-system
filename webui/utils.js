export const API_BASE_URL = window.__API_BASE_URL__ || "";

export const PANEL_COMMANDS = new Set(["/info", "/config", "/lib", "/assistant", "/help", "?"]);

const PANEL_TITLE_BY_COMMAND = {
  "/info": "Info / Status",
  "/config": "Settings",
  "/lib": "Library Overview",
  "/assistant": "Assistant Modes",
  "/personalization": "Personalization",
  "/help": "Help",
  "?": "Help",
};

export function getPanelTitle(command) {
  return PANEL_TITLE_BY_COMMAND[command] || "Details";
}

export function formatSeverityLabel(severity) {
  if (!severity) return "";
  return String(severity).replace(/[_-]+/g, " ");
}

export function getOverallHealth(statusData, filesData) {
  const readiness = statusData?.embedding?.readiness;
  const readinessText = String(readiness?.status || "").toLowerCase();
  if (!statusData) return "error";
  if (readinessText.includes("error") || readinessText.includes("fail")) return "error";
  if (readiness?.ready === true && filesData) return "ok";
  return "warn";
}

export function normalizeStatusBadge(rawValue) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) return "disconnected";
  if (["ready", "ok", "active", "running", "connected"].includes(value)) return "active";
  if (["pending", "loading", "starting", "indexing", "building"].some((token) => value.includes(token))) return "pending";
  if (["error", "failed", "fail", "unhealthy"].some((token) => value.includes(token))) return "error";
  if (["disconnected", "offline", "unknown", "n/a"].includes(value)) return "disconnected";
  return "active";
}

function parseListWithCurrent(text, currentPrefix) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const items = [];
  let current = null;

  for (const line of lines) {
    if (line.startsWith("- ")) {
      const body = line.slice(2);
      const colonIndex = body.indexOf(":");
      if (colonIndex > -1) {
        items.push({
          id: body.slice(0, colonIndex).trim(),
          description: body.slice(colonIndex + 1).trim(),
        });
      }
      continue;
    }

    if (line.toLowerCase().startsWith(currentPrefix)) {
      current = line.slice(currentPrefix.length).trim();
    }
  }

  return { items, current };
}

export function parseAssistantModeContent(text) {
  const { items, current } = parseListWithCurrent(text, "current mode:");
  return { modes: items, currentMode: current };
}

export function parseSystemInfoContent(text) {
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
      keys: ["app", "ui mode", "assistant mode"],
    },
    {
      title: "Models",
      keys: ["chat model", "embedding model"],
    },
    {
      title: "Storage",
      keys: ["vector db", "collection", "postgres", "content path", "embeddable extensions"],
    },
    {
      title: "State",
      keys: ["index state file", "embedding status file", "chat history dir"],
    },
  ];

  return groups
    .map((group) => ({
      ...group,
      items: entries.filter((entry) => group.keys.includes(entry.key.toLowerCase())),
    }))
    .filter((group) => group.items.length > 0);
}

export function parseHelpContent(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim());

  const intro = [];
  const commands = [];
  const tips = [];
  let currentSection = "intro";

  for (const line of lines) {
    if (!line) continue;
    const lower = line.toLowerCase();
    if (lower === "commands:") {
      currentSection = "commands";
      continue;
    }
    if (lower === "tips:") {
      currentSection = "tips";
      continue;
    }

    if (line.startsWith("- ")) {
      const body = line.slice(2).trim();
      if (currentSection === "commands") {
        if (/^example:/i.test(body)) continue;
        const splitIndex = body.search(/\s{2,}/);
        if (splitIndex > -1) {
          commands.push({
            command: body.slice(0, splitIndex).trim(),
            description: body.slice(splitIndex).trim(),
          });
        } else {
          const colonIndex = body.indexOf(":");
          commands.push({
            command: colonIndex > -1 ? body.slice(0, colonIndex).trim() : body,
            description: colonIndex > -1 ? body.slice(colonIndex + 1).trim() : "",
          });
        }
      } else if (currentSection === "tips") {
        tips.push(body);
      } else {
        intro.push(body);
      }
      continue;
    }

    if (currentSection === "commands" && /^example:/i.test(line)) {
      if (commands.length > 0) {
        const current = commands[commands.length - 1];
        commands[commands.length - 1] = {
          ...current,
          description: `${current.description} (${line})`.trim(),
        };
      }
      continue;
    }

    if (currentSection === "tips") {
      tips.push(line);
    } else {
      intro.push(line);
    }
  }

  return { intro, commands, tips };
}

export function parsePanelText(text) {
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

export function resizeComposerInput(element) {
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

export function createMessage(role, text, extra = {}) {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    evidenceSeverity: null,
    responseType: null,
    ...extra,
  };
}

export function formatBytes(sizeInBytes) {
  if (!Number.isFinite(sizeInBytes) || sizeInBytes < 0) return "n/a";
  if (sizeInBytes < 1024) return `${sizeInBytes} B`;

  const units = ["KB", "MB", "GB", "TB"];
  let value = sizeInBytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}
