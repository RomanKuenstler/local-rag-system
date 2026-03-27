import chalk from "chalk";

export function getShortModelName(model) {
  if (!model) {
    return "unknown-model";
  }
  return String(model).replace(/^hf\.co\//i, "").replace(/:.*$/, "").trim();
}

export function getKnowledgeBasePathLabel(contentPath) {
  if (!contentPath || contentPath === "/app/data") {
    return "./data";
  }
  return contentPath;
}

export function getTerminalSize() {
  return {
    rows: process.stdout.rows || 24,
    columns: process.stdout.columns || 80,
  };
}

export function repeatBlankLines(count) {
  for (let i = 0; i < count; i++) {
    console.log("");
  }
}

export function wrapText(text, width = 72) {
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

export function formatEvidenceBadge(evidenceQuality) {
  const label = String(evidenceQuality || "unknown").toLowerCase();

  if (label === "strong") return chalk.bgGreen.black(" STRONG ");
  if (label === "moderate") return chalk.bgYellow.black(" MODERATE ");
  if (label === "weak") return chalk.bgRed.white(" WEAK ");
  return chalk.bgWhite.black(` ${label.toUpperCase()} `);
}
