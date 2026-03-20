import { ensureDatabaseReady, pingDatabase } from "./src/db.js";
import http from "http";

const PORT = parseInt(process.env.BACKEND_API_PORT || "3100", 10);
const HOST = process.env.BACKEND_API_HOST || "0.0.0.0";
const RETRIEVER_BASE_URL = process.env.RETRIEVER_BASE_URL || "http://retriever:3000";
const EMBEDDER_BASE_URL = process.env.EMBEDDER_BASE_URL || "http://embedder:3200";

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

async function proxyRetriever({ req, res, targetPath }) {
  const method = req.method || "GET";
  const body = method === "POST" ? await readBody(req) : undefined;

  const upstreamResponse = await fetch(`${RETRIEVER_BASE_URL}${targetPath}`, {
    method,
    headers: {
      "content-type": req.headers["content-type"] || "application/json",
    },
    body,
  });

  const text = await upstreamResponse.text();
  const contentType = upstreamResponse.headers.get("content-type") || "application/json";

  res.writeHead(upstreamResponse.status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(text);
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function handleStatus(req, res) {
  const retrieverStatusPromise = fetchJson(`${RETRIEVER_BASE_URL}/internal/retriever/status`);
  const embedderStatusPromise = fetchJson(`${EMBEDDER_BASE_URL}/internal/embedder/status`).catch(() => null);

  const [retrieverStatus, embedderStatus] = await Promise.all([retrieverStatusPromise, embedderStatusPromise]);
  const responsePayload = {
    ...(retrieverStatus || {}),
    orchestration: {
      entrypoint: "backend-api",
      version: "v1",
    },
    services: {
      backend: {
        role: "backend-api",
        baseUrl: `http://${HOST}:${PORT}`,
      },
      retriever: {
        role: retrieverStatus?.app?.role || "retriever-api",
        baseUrl: RETRIEVER_BASE_URL,
      },
      embedder: {
        role: embedderStatus?.service || "embedder",
        baseUrl: EMBEDDER_BASE_URL,
        status: embedderStatus,
      },
    },
  };

  if (embedderStatus?.embeddingStatus) {
    responsePayload.embedding = {
      ...(responsePayload.embedding || {}),
      workerStatus: embedderStatus.embeddingStatus,
    };
  }

  json(res, 200, responsePayload);
}

async function getDbHealth() {
  try {
    await pingDatabase();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url) {
      json(res, 400, { error: "Missing request URL" });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      await handleStatus(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/files") {
      await proxyRetriever({ req, res, targetPath: "/internal/retriever/files" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/messages") {
      await proxyRetriever({ req, res, targetPath: `${url.pathname}${url.search}`.replace("/api/messages", "/internal/retriever/messages") });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/prompt") {
      await proxyRetriever({ req, res, targetPath: "/internal/retriever/prompt" });
      return;
    }

    if (req.method === "GET" && url.pathname === "/healthz") {
      const db = await getDbHealth();
      json(res, db.ok ? 200 : 503, {
        ok: db.ok,
        service: "backend-api",
        retrieverBaseUrl: RETRIEVER_BASE_URL,
        embedderBaseUrl: EMBEDDER_BASE_URL,
        postgres: db,
      });
      return;
    }

    json(res, 404, { error: "Not found" });
  } catch (error) {
    json(res, 502, {
      error: "Upstream request failed",
      details: error.message,
    });
  }
});

await ensureDatabaseReady();

server.listen(PORT, HOST, () => {
  console.log(`Backend API listening on http://${HOST}:${PORT}`);
  console.log("Endpoints: GET /api/status, GET /api/files, POST /api/prompt");
});
