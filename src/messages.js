import chalk from "chalk";

export function getEvidenceQuality(results, minSimilarities) {
  if (!results || results.length === 0 || results.length < minSimilarities) {
    return "weak";
  }

  const scores = results.map((result) => result.score ?? 0);
  const maxScore = Math.max(...scores);
  const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;

  if (maxScore >= 0.82 && avgScore >= 0.72) {
    return "strong";
  }
  if (maxScore >= 0.62 && avgScore >= 0.55) {
    return "moderate";
  }

  return "weak";
}

function formatEvidenceEntry(result, index) {
  const payload = result.payload || {};

  return [
    `EVIDENCE #${index + 1}`,
    `score: ${result.score?.toFixed(4) ?? "n/a"}`,
    `source: ${payload.source || "unknown"}`,
    `title: ${payload.title || "Untitled"}`,
    "content:",
    `${payload.text || ""}`,
  ].join("\n");
}

export function createSimilarityDetails(results, runtimeConfig) {
  return {
    requestedLimit: runtimeConfig.maxSimilarities,
    cosineLimit: runtimeConfig.cosineLimit,
    matches: results.map((result, index) => {
      const payload = result.payload || {};
      const preview = String(payload.text || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);

      return {
        rank: index + 1,
        score: result.score,
        source: payload.source || "unknown",
        title: payload.title || "",
        preview,
      };
    }),
  };
}

export function buildRagContextPackage({ results, userMessage, evidenceQuality }) {
  const evidenceBlock = results.map((result, index) => formatEvidenceEntry(result, index)).join("\n\n---\n\n");

  return `RETRIEVAL RESULT
Evidence quality: ${evidenceQuality}
Evidence quality meaning: strong|moderate|weak

${evidenceBlock || "No evidence retrieved."}

INSTRUCTIONS FOR THIS TASK
- Answer the user's question using the retrieved knowledge as the primary source.
- If the evidence is partial, answer only what is supported and clearly indicate what is missing.
- If the evidence is insufficient, say that the knowledge base does not contain enough information.
- If you provide additional general knowledge, clearly label it as general knowledge and not as knowledge-base content.

USER QUESTION
${userMessage}`;
}

export function buildSystemInfoMessage({ appName, appVersion, uiMode, chatModelName, embeddingModelName, qdrantUrl, collectionName, contentPath, embeddableExtensions, chatHistoryDir }) {
  return [
    "System info:",
    `- app: ${appName} ${appVersion}`,
    `- ui mode: ${uiMode}`,
    `- chat model: ${chatModelName || "unknown"}`,
    `- embedding model: ${embeddingModelName || "unknown"}`,
    `- vector db: qdrant (${qdrantUrl})`,
    `- collection: ${collectionName}`,
    `- content path: ${contentPath}`,
    `- embeddable extensions: ${embeddableExtensions.join(", ")}`,
    `- chat history dir: ${chatHistoryDir}`,
  ].join("\n");
}

export function buildActiveConfigMessage(runtimeConfig, staticConfig) {
  const runtimeChangeableLabel = chalk.green("runtime-changeable");
  const restartOnlyLabel = chalk.yellow("requires restart");

  return [
    "Active configuration:",
    "",
    chalk.bold("Retrieval"),
    `  - history messages: ${runtimeConfig.historyMessages} (${runtimeChangeableLabel})`,
    `  - max similarities: ${runtimeConfig.maxSimilarities} (${runtimeChangeableLabel})`,
    `  - min similarities: ${runtimeConfig.minSimilarities} (${runtimeChangeableLabel})`,
    `  - cosine limit: ${runtimeConfig.cosineLimit} (${runtimeChangeableLabel})`,
    "",
    chalk.bold("Chunking / Indexing"),
    `  - chunk size: ${staticConfig.chunkSize} (${restartOnlyLabel})`,
    `  - chunk overlap: ${staticConfig.chunkOverlap} (${restartOnlyLabel})`,
    `  - max embedding chars: ${staticConfig.maxEmbeddingChars} (${restartOnlyLabel})`,
    `  - pdf min extracted chars: ${staticConfig.pdfMinExtractedChars} (${restartOnlyLabel})`,
    `  - index schema version: ${staticConfig.indexSchemaVersion} (${restartOnlyLabel})`,
    `  - index state file: ${staticConfig.indexStateFile} (${restartOnlyLabel})`,
    `  - chat history dir: ${staticConfig.chatHistoryDir} (${restartOnlyLabel})`,
    "",
    chalk.bold("Generation"),
    `  - temperature: ${staticConfig.temperature} (${restartOnlyLabel})`,
    `  - top_p: ${staticConfig.topP} (${restartOnlyLabel})`,
    `  - presence penalty: ${staticConfig.presencePenalty} (${restartOnlyLabel})`,
    "",
    "Tip: use /config set <name> <value>, e.g. /config set 'min similarities' 3",
  ].join("\n");
}

export function buildHelpMessage() {
  return [
    "Quick help",
    "",
    "Ask any question about your indexed documents in natural language.",
    "The assistant retrieves matching context from the knowledge base before answering.",
    "",
    "Commands:",
    "- /help or ?       Show this help overview",
    "- /info            Show system details (models, DB, paths)",
    "- /lib             Show indexed library files and chunk counts",
    "- /config          Show active retrieval/runtime configuration",
    "- /config set ...  Update a runtime setting",
    "                  Example: /config set 'min similarities' 3",
    "- /mode clean      Switch to clean chat-focused UI",
    "- /mode rag        Switch to debug RAG UI with similarity details",
    "- /embed           Re-index only new/changed/removed files in ./data",
    "- /yes             Show pending weak-evidence answer",
    "- /no | /skip      Hide pending weak-evidence answer",
    "- /bye | /exit | /quit  Exit the application",
    "",
    "Tips:",
    "- Ask precise questions for better retrieval.",
    "- Use /mode rag to inspect evidence quality and matching chunks.",
  ].join("\n");
}

export function formatBytes(sizeInBytes) {
  if (!Number.isFinite(sizeInBytes) || sizeInBytes < 0) {
    return "n/a";
  }

  if (sizeInBytes < 1024) {
    return `${sizeInBytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = sizeInBytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

export function buildEmbedSummaryMessage(summary) {
  if (!summary) {
    return "Embedding finished, but no summary is available.";
  }

  if (summary.filesFound === 0) {
    return "No embeddable files found in ./data. Nothing to index.";
  }

  if (summary.skipped) {
    return "No new, changed, or removed files detected in ./data. Index is already up to date.";
  }

  return [
    "Embedding finished.",
    `- Files scanned: ${summary.filesFound}`,
    `- New/changed files detected: ${summary.changedFiles.length}`,
    `- Removed files detected: ${summary.removedFiles.length}`,
    `- Files embedded: ${summary.indexedCount}`,
    `- Files removed from index: ${summary.removedCount}`,
  ].join("\n");
}
