import { buildEmbedSummaryMessage } from "./src/messages.js";
import { indexChangedDocuments } from "./src/embedding-service.js";
import { validateRetrievalConfig } from "./src/config.js";

const EMBED_INTERVAL_SECONDS = parseInt(process.env.EMBED_INTERVAL_SECONDS || "15", 10);

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function runLoop() {
  validateRetrievalConfig();
  console.log(`[embedder] started (interval=${EMBED_INTERVAL_SECONDS}s)`);

  while (true) {
    try {
      const summary = await indexChangedDocuments({ logger: (...args) => console.log("[embedder]", ...args) });
      console.log("[embedder]", buildEmbedSummaryMessage(summary));
    } catch (error) {
      console.error(`[embedder] indexing loop failed: ${error.message}`);
    }

    await wait(EMBED_INTERVAL_SECONDS * 1000);
  }
}

await runLoop();
