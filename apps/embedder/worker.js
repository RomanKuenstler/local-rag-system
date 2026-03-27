import { buildEmbedSummaryMessage } from "../../shared/src/messages.js";
import { indexChangedDocuments } from "../../shared/src/embedding-service.js";
import { validateRetrievalConfig } from "../../shared/config/index.js";
import { startEmbedderHealthServer } from "./health-server.js";

const EMBED_INTERVAL_SECONDS = parseInt(process.env.EMBED_INTERVAL_SECONDS || "15", 10);
const EMBEDDER_HEALTH_PORT = parseInt(process.env.EMBEDDER_HEALTH_PORT || "3200", 10);
const EMBEDDER_HEALTH_HOST = process.env.EMBEDDER_HEALTH_HOST || "0.0.0.0";

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

startEmbedderHealthServer({
  port: EMBEDDER_HEALTH_PORT,
  host: EMBEDDER_HEALTH_HOST,
  intervalSeconds: EMBED_INTERVAL_SECONDS,
});
await runLoop();
