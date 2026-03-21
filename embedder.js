import http from "http";
import { buildEmbedSummaryMessage } from "./src/messages.js";
import { indexChangedDocuments, readEmbeddingStatus } from "./src/embedding-service.js";
import { validateRetrievalConfig } from "./src/config.js";

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

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function startHealthServer() {
  const server = http.createServer((req, res) => {
    if (!req.url) {
      json(res, 400, { error: "Missing request URL" });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/healthz") {
      json(res, 200, { ok: true, service: "embedder" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/internal/embedder/status") {
      readEmbeddingStatus().then((embeddingStatus) => {
        json(res, 200, {
          ok: true,
          service: "embedder",
          intervalSeconds: EMBED_INTERVAL_SECONDS,
          embeddingStatus,
        });
      }).catch((error) => {
        json(res, 500, { ok: false, error: error.message });
      });
      return;
    }

    json(res, 404, { error: "Not found" });
  });

  server.listen(EMBEDDER_HEALTH_PORT, EMBEDDER_HEALTH_HOST, () => {
    console.log(`[embedder] health API listening on http://${EMBEDDER_HEALTH_HOST}:${EMBEDDER_HEALTH_PORT}`);
  });
}

startHealthServer();
await runLoop();
