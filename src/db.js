import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationDirectoryCandidates = [
  path.resolve(__dirname, "../migrations"),
  path.resolve(process.cwd(), "migrations"),
];

let pool;
let initPromise;

async function resolveMigrationsDir() {
  for (const candidate of migrationDirectoryCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next path.
    }
  }

  throw new Error(
    `Migrations directory not found. Checked: ${migrationDirectoryCandidates.join(", ")}`
  );
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || "postgres",
      port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
      user: process.env.POSTGRES_USER || "rag",
      password: process.env.POSTGRES_PASSWORD || "rag",
      database: process.env.POSTGRES_DB || "rag",
    });
  }
  return pool;
}

async function runMigrations() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = await resolveMigrationsDir();
  const migrationFiles = (await fs.readdir(migrationsDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  await db.query("SELECT pg_advisory_lock($1)", [937112]);
  try {
    for (const fileName of migrationFiles) {
      const version = fileName.replace(/\.sql$/, "");
      const alreadyApplied = await db.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
      if (alreadyApplied.rowCount > 0) {
        continue;
      }

      const sql = await fs.readFile(path.join(migrationsDir, fileName), "utf8");
      await db.query("BEGIN");
      try {
        await db.query(sql);
        await db.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await db.query("SELECT pg_advisory_unlock($1)", [937112]);
  }
}

function shouldRetryConnection(error) {
  return ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "57P03"].includes(error?.code);
}

async function wait(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runMigrationsWithRetry() {
  const retries = parseInt(process.env.POSTGRES_CONNECT_RETRIES || "30", 10);
  const delayMs = parseInt(process.env.POSTGRES_CONNECT_DELAY_MS || "1000", 10);

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      await runMigrations();
      return;
    } catch (error) {
      if (attempt >= retries || !shouldRetryConnection(error)) {
        throw error;
      }

      console.warn(
        `[db] connection attempt ${attempt}/${retries} failed (${error.code || "unknown"}). Retrying in ${delayMs}ms...`
      );
      await wait(delayMs);
    }
  }
}

export async function ensureDatabaseReady() {
  if (!initPromise) {
    initPromise = runMigrationsWithRetry();
  }
  return initPromise;
}

export async function dbQuery(text, params = []) {
  const db = getPool();
  return db.query(text, params);
}

export async function pingDatabase() {
  await dbQuery("SELECT 1");
  return true;
}
