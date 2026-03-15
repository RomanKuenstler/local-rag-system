import chalk from "chalk";

export function createUi({ appName, appVersion, chatModel, contentPath }) {
  let mode = (process.env.TUI_MODE || "clean").toLowerCase();
  let cleanUiMessages = [];
  let ragUiMessages = [];
  let pendingStatus = null;
  let pendingSimilarityDetails = null;

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

  function getTuiMode() {
    return mode;
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
    const normalized = String(text || "").replace(/\r\n/g, "\n");
    const paragraphs = normalized.split("\n");
    const lines = [];

    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) {
        lines.push("");
        continue;
      }

      const words = paragraph.split(/\s+/).filter(Boolean);
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
    }

    return lines.length > 0 ? lines : [""];
  }

  function renderFooter() {
    const { columns } = getTerminalSize();
    const lineWidth = Math.max(40, columns - 2);
    const left = "? for help";
    const right = `mode: ${mode}`;
    const spacing = Math.max(1, lineWidth - left.length - right.length);
    const separator = dim("─".repeat(lineWidth));

    console.log(separator);
    console.log(`${dim(left)}${" ".repeat(spacing)}${dim(right)}`);
    console.log(separator);
  }

  function formatEvidenceBadge(evidenceQuality) {
    const label = String(evidenceQuality || "unknown").toLowerCase();

    if (label === "strong") return chalk.bgGreen.black(" STRONG ");
    if (label === "moderate") return chalk.bgYellow.black(" MODERATE ");
    if (label === "weak") return chalk.bgRed.white(" WEAK ");
    return chalk.bgWhite.black(` ${label.toUpperCase()} `);
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
      `${dim("small local Retrieval Augmented Generation (RAG) AI system")}`,
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

    const { columns } = getTerminalSize();
    const contentWidth = Math.max(48, Math.min(110, columns - 8));

    for (const msg of cleanUiMessages) {
      const wrapped = wrapText(msg.text, contentWidth);
      if (wrapped.length > 0) {
        const prefix = msg.role === "assistant" ? "•" : ">";
        conversationLines.push(`${prefix} ${wrapped[0]}`);
        for (let i = 1; i < wrapped.length; i++) {
          conversationLines.push(`  ${wrapped[i]}`);
        }

        if (msg.role === "assistant" && msg.evidenceQuality) {
          conversationLines.push(`  ${dim("Evidence:")} ${formatEvidenceBadge(msg.evidenceQuality)}`);
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
    const reservedBottomLines = 6;
    const blankLines = Math.max(1, rows - usedLines - reservedBottomLines);
    repeatBlankLines(blankLines);
    renderFooter();
  }

  function formatScore(score) {
    if (typeof score !== "number" || Number.isNaN(score)) {
      return "n/a";
    }

    return score.toFixed(3);
  }

  function getScoreMeter(score) {
    if (typeof score !== "number" || Number.isNaN(score)) {
      return dim("░░░░░░");
    }

    const clamped = Math.max(0, Math.min(1, score));
    const blocks = 6;
    const filled = Math.round(clamped * blocks);
    const bar = `${"█".repeat(filled)}${"░".repeat(blocks - filled)}`;

    if (score >= 0.82) {
      return chalk.green(bar);
    }
    if (score >= 0.62) {
      return chalk.yellow(bar);
    }
    return chalk.red(bar);
  }

  function renderSimilarityDetails(details, contentWidth) {
    const rows = [];
    if (!details || !Array.isArray(details.matches) || details.matches.length === 0) {
      rows.push(`  ${dim("Similarity matches:")} ${chalk.red("none above threshold")}`);
      return rows;
    }

    const thresholdLabel =
      typeof details.cosineLimit === "number" ? details.cosineLimit.toFixed(2) : "n/a";
    rows.push(
      `  ${dim("Similarity matches:")} ${details.matches.length}/${details.requestedLimit} ` +
        dim(`(threshold ≥ ${thresholdLabel})`)
    );

    for (const match of details.matches) {
      const heading = `  #${match.rank} ${getScoreMeter(match.score)} ${dim(`score ${formatScore(match.score)}`)}`;
      rows.push(heading);

      const sourceLine = `     ${match.source || "unknown source"}`;
      rows.push(sourceLine);

      if (match.title) {
        rows.push(`     ${dim(`title: ${match.title}`)}`);
      }

      if (match.preview) {
        const wrappedPreview = wrapText(match.preview, Math.max(36, contentWidth - 8));
        rows.push(`     ${dim(`preview: ${wrappedPreview[0]}`)}`);
        for (let i = 1; i < Math.min(3, wrappedPreview.length); i++) {
          rows.push(`              ${dim(wrappedPreview[i])}`);
        }
      }
    }

    return rows;
  }

  function renderRagScreen() {
    const { rows, columns } = getTerminalSize();
    const contentWidth = Math.max(48, Math.min(110, columns - 8));

    console.clear();
    renderCleanHeader();

    const conversationLines = [];

    for (const msg of ragUiMessages) {
      if (msg.role === "assistant" && msg.similarityDetails) {
        conversationLines.push(...renderSimilarityDetails(msg.similarityDetails, contentWidth));
        conversationLines.push("");
      }

      const wrapped = wrapText(msg.text, contentWidth);
      const prefix = msg.role === "assistant" ? "•" : ">";
      conversationLines.push(`${prefix} ${wrapped[0]}`);
      for (let i = 1; i < wrapped.length; i++) {
        conversationLines.push(`  ${wrapped[i]}`);
      }

      if (msg.role === "assistant" && msg.evidenceQuality) {
        conversationLines.push(`  ${dim("Evidence:")} ${formatEvidenceBadge(msg.evidenceQuality)}`);
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
    const reservedBottomLines = 6;
    const blankLines = Math.max(1, rows - usedLines - reservedBottomLines);
    repeatBlankLines(blankLines);
    renderFooter();
  }

  function setPendingStatus(statusText) {
    pendingStatus = statusText ? String(statusText) : null;
    if (isCleanMode()) {
      renderCleanScreen();
      return;
    }

    if (isRagMode()) {
      renderRagScreen();
    }
  }

  function renderStartupScreen() {
    if (isCleanMode()) {
      cleanUiMessages = [];
      renderCleanScreen();
      return;
    }

    ragUiMessages = [];
    renderRagScreen();
  }

  function renderLoadingScreen(message = "Loading knowledge base...") {
    if (!isCleanMode()) {
      return;
    }

    cleanUiMessages = [
      {
        role: "assistant",
        text: `${message}\nPlease wait while documents are indexed...`,
      },
    ];
    renderCleanScreen();
  }

  function renderModeChanged(nextMode) {
    if (isCleanMode()) {
      renderCleanScreen();
      return;
    }

    if (isRagMode()) {
      renderRagScreen();
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

    if (isRagMode()) {
      ragUiMessages.push({ role: "user", text: message });
      renderRagScreen();
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

    if (isRagMode()) {
      ragUiMessages.push({ role: "assistant", text, similarityDetails: pendingSimilarityDetails });
      pendingSimilarityDetails = null;
      renderRagScreen();
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
      for (let i = cleanUiMessages.length - 1; i >= 0; i--) {
        if (cleanUiMessages[i].role === "assistant") {
          cleanUiMessages[i].evidenceQuality = label;
          break;
        }
      }
      renderCleanScreen();
      return;
    }

    if (isRagMode()) {
      for (let i = ragUiMessages.length - 1; i >= 0; i--) {
        if (ragUiMessages[i].role === "assistant") {
          ragUiMessages[i].evidenceQuality = label;
          break;
        }
      }
      renderRagScreen();
      return;
    }

    console.log(chalk.dim("Evidence strength:"), qualityColor(label));
  }

  function uiLog(...args) {
    if (isRagMode()) {
      console.log(...args);
    }
  }

  function setPendingSimilarityDetails(details) {
    pendingSimilarityDetails = details || null;
  }

  return {
    isCleanMode,
    isRagMode,
    getTuiMode,
    setTuiMode,
    renderStartupScreen,
    renderLoadingScreen,
    renderModeChanged,
    printUserMessage,
    printAssistantMessage,
    printEvidenceQuality,
    setPendingSimilarityDetails,
    setPendingStatus,
    uiLog,
    promptColor,
    renderFooter,
  };
}
