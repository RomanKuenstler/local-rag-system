import chalk from "chalk";

export function createUi({ appName, appVersion, chatModel, contentPath }) {
  let mode = (process.env.TUI_MODE || "clean").toLowerCase();
  let cleanUiMessages = [];
  let pendingStatus = null;

  function isCleanMode() {
    return mode === "clean";
  }

  function isRagMode() {
    return mode === "rag";
  }

  function setTuiMode(nextMode) {
    const normalized = String(nextMode || "").trim().toLowerCase();
    if (normalized !== "clean" && normalized !== "rag") {
      return false;
    }
    mode = normalized;
    return true;
  }

  function dim(text) {
    return chalk.dim(text);
  }

  function logoColor(text) {
    return chalk.hex("#F56F27")(text);
  }

  function titleColor(text) {
    return chalk.whiteBright.bold(text);
  }

  function promptColor(text) {
    return chalk.whiteBright(text);
  }

  function getShortModelName(model) {
    if (!model) {
      return "unknown-model";
    }

    return String(model).replace(/^hf\.co\//i, "").replace(/:.*$/, "").trim();
  }

  function getKnowledgeBasePathLabel(nextContentPath) {
    if (!nextContentPath || nextContentPath === "/app/data") {
      return "./data";
    }
    return nextContentPath;
  }

  function getTerminalSize() {
    return {
      rows: process.stdout.rows || 24,
      columns: process.stdout.columns || 80,
    };
  }

  function repeatBlankLines(count) {
    for (let i = 0; i < count; i++) {
      console.log("");
    }
  }

  function wrapText(text, width = 72) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= width) {
        current = candidate;
      } else {
        if (current) {
          lines.push(current);
        }
        current = word;
      }
    }

    if (current) {
      lines.push(current);
    }

    return lines;
  }

  function renderFooter() {
    const { columns } = getTerminalSize();
    const lineWidth = Math.max(40, columns - 2);
    const left = "? for help";
    const right = `mode: ${mode}`;
    const spacing = Math.max(1, lineWidth - left.length - right.length);
    console.log(`${dim(left)}${" ".repeat(spacing)}${dim(right)}`);
  }

  function renderCleanHeader() {
    const shortModel = getShortModelName(chatModel.model);
    const knowledgeBasePath = getKnowledgeBasePathLabel(contentPath);

    const logoLines = [
      "  ██████  █████  ██████",
      "  ██   ██ ██   ██ ██",
      "  ██████  ███████ ██   ███",
      "  ██   ██ ██   ██ ██    ██",
      "  ██   ██ ██   ██  ██████",
    ];

    const metaLines = [
      `${titleColor(`${appName}`)} ${dim(`${appVersion}`)}`,
      `${dim("self-hosted RAG system")}`,
      `${dim(`chat model: ${shortModel}`)}`,
      `${dim(`knowledge base: ${knowledgeBasePath}`)}`,
      "",
      "",
      "",
    ];

    const leftWidth = 29;

    for (let i = 0; i < Math.max(logoLines.length, metaLines.length); i++) {
      const left = logoLines[i] || "";
      const right = metaLines[i] || "";
      console.log(`${logoColor(left.padEnd(leftWidth, " "))}  ${right}`);
    }
  }

  function renderCleanScreen() {
    const { rows } = getTerminalSize();
    console.clear();
    renderCleanHeader();

    const conversationLines = [];

    for (const msg of cleanUiMessages) {
      const wrapped = wrapText(msg.text, 72);
      if (wrapped.length > 0) {
        const prefix = msg.role === "assistant" ? "•" : ">";
        conversationLines.push(`${prefix} ${wrapped[0]}`);
        for (let i = 1; i < wrapped.length; i++) {
          conversationLines.push(`  ${wrapped[i]}`);
        }
      }
      conversationLines.push("");
    }

    if (conversationLines.length === 0) {
      conversationLines.push("• How can I help you today?");
      conversationLines.push("");
    }

    if (pendingStatus) {
      conversationLines.push(chalk.cyan(`⏳ ${pendingStatus}`));
      conversationLines.push("");
    }

    for (const line of conversationLines) {
      console.log(line);
    }

    const usedLines = 5 + 1 + conversationLines.length;
    const reservedBottomLines = 4;
    const blankLines = Math.max(1, rows - usedLines - reservedBottomLines);
    repeatBlankLines(blankLines);
    renderFooter();
  }

  function setPendingStatus(statusText) {
    pendingStatus = statusText ? String(statusText) : null;
    if (isCleanMode()) {
      renderCleanScreen();
    }
  }

  function renderStartupScreen() {
    if (!isCleanMode()) {
      return;
    }

    cleanUiMessages = [];
    renderCleanScreen();
  }

  function renderLoadingScreen(message = "Loading knowledge base...") {
    if (!isCleanMode()) {
      return;
    }

    const { rows } = getTerminalSize();
    console.clear();
    renderCleanHeader();
    console.log("");
    console.log(chalk.white("•") + ` ${message}`);
    console.log(dim("  Please wait while documents are indexed."));

    const usedLines = 5 + 4;
    const reservedBottomLines = 4;
    const blankLines = Math.max(1, rows - usedLines - reservedBottomLines);
    repeatBlankLines(blankLines);
    renderFooter();
  }

  function renderModeChanged(nextMode) {
    if (isCleanMode()) {
      renderCleanScreen();
      return;
    }

    console.log(chalk.dim("─".repeat(48)));
    console.log(`mode switched to: ${nextMode}`);
    console.log(chalk.dim("─".repeat(48)));
  }

  function printUserMessage(message) {
    if (isCleanMode()) {
      cleanUiMessages.push({ role: "user", text: message });
      renderCleanScreen();
      return;
    }

    console.log(`${promptColor(">")} ${message}`);
  }

  function printAssistantMessage(message) {
    const text = String(message || "").trim();
    if (!text) {
      return;
    }

    if (isCleanMode()) {
      cleanUiMessages.push({ role: "assistant", text });
      renderCleanScreen();
      return;
    }

    const lines = text.split("\n");
    console.log(`${chalk.white("•")} ${lines[0]}`);
    for (let i = 1; i < lines.length; i++) {
      console.log(`  ${lines[i]}`);
    }
    console.log("");
  }

  function printEvidenceQuality(evidenceQuality) {
    const label = String(evidenceQuality || "unknown").toLowerCase();
    const qualityColor =
      label === "strong" ? chalk.green : label === "moderate" ? chalk.yellow : label === "weak" ? chalk.red : chalk.white;

    if (isCleanMode()) {
      cleanUiMessages.push({ role: "assistant", text: `Evidence strength: ${label}` });
      renderCleanScreen();
      return;
    }

    console.log(chalk.dim("Evidence strength:"), qualityColor(label));
  }

  function uiLog(...args) {
    if (isRagMode()) {
      console.log(...args);
    }
  }

  return {
    isCleanMode,
    isRagMode,
    setTuiMode,
    renderStartupScreen,
    renderLoadingScreen,
    renderModeChanged,
    printUserMessage,
    printAssistantMessage,
    printEvidenceQuality,
    setPendingStatus,
    uiLog,
    promptColor,
    renderFooter,
  };
}
