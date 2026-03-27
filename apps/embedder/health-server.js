import http from "http";
import { readEmbeddingStatus } from "../../shared/src/embedding-service.js";

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function handleRequest(req, res, intervalSeconds) {
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
    const embeddingStatus = await readEmbeddingStatus();
    json(res, 200, {
      ok: true,
      service: "embedder",
      intervalSeconds,
      embeddingStatus,
    });
    return;
  }

  json(res, 404, { error: "Not found" });
}

export function startEmbedderHealthServer({ port, host, intervalSeconds }) {
  const server = http.createServer((req, res) => {
    handleRequest(req, res, intervalSeconds).catch((error) => {
      json(res, 500, { ok: false, error: error.message });
    });
  });

  server.listen(port, host, () => {
    console.log(`[embedder] health API listening on http://${host}:${port}`);
  });

  return server;
}
