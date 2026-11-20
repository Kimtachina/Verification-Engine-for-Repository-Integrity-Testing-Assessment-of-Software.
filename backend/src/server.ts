#!/usr/bin/env bun
import { join, resolve } from "node:path";
import { createApp } from "./app";
import { ConfigError, loadConfig } from "./config/load-config";
import { type OpenedDatabase, openDatabase, redact } from "./db/client";
import { ScanRepository } from "./db/scan-repository";
import { ScanRunner } from "./services/scan-runner";
import { SettingsService } from "./services/settings-service";
import { UploadStore } from "./services/upload-store";
import { VERITAS_VERSION } from "./version";

/**
 * Environment:
 *   VERITAS_CONFIG_DIR  folder with veritas.config.ts (default: current directory)
 *   DATABASE_URL        Postgres connection string, e.g. Supabase's session pooler URL.
 *                       Without it, data goes to an embedded Postgres in VERITAS_DB_DIR.
 *   VERITAS_DB_DIR      embedded database folder (default: <config dir>/.veritas/pgdata)
 *   HOST / PORT         listen address (default: 127.0.0.1:4000, local machine only)
 *   VERITAS_CORS_ORIGINS  comma-separated dashboard origins (default: localhost:3000 and 127.0.0.1:3000)
 */
const configDir = resolve(process.env.VERITAS_CONFIG_DIR ?? ".");
const hostname = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4000);
const corsOrigins = (
  process.env.VERITAS_CORS_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

let root: string;
try {
  // Fail at startup, not on the first scan, when the config or scan root is wrong.
  root = (await loadConfig(configDir)).rootDir;
} catch (error) {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(2);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
let database: OpenedDatabase;
try {
  database = await openDatabase(
    databaseUrl
      ? { url: databaseUrl }
      : { dir: resolve(process.env.VERITAS_DB_DIR ?? join(configDir, ".veritas", "pgdata")) },
  );
} catch (error) {
  // Drizzle wraps the driver's error; the cause says what went wrong (refused, bad
  // password, unknown host). Neither message contains the password.
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const where = databaseUrl ? redact(databaseUrl) : "the embedded database";
  console.error(`Could not open ${where}:`, cause instanceof Error ? cause.message : cause);
  process.exit(2);
}
const { db, close, location } = database;
const repo = new ScanRepository(db);
const interrupted = await repo.failInterruptedScans(new Date().toISOString());
if (interrupted > 0) console.warn(`Marked ${interrupted} interrupted scan(s) as failed.`);

const settings = new SettingsService(db, configDir);
const uploads = new UploadStore(join(configDir, ".veritas", "uploads"));
const runner = new ScanRunner({
  repo,
  loadConfig: settings.loadConfig,
  uploadRoot: (id) => uploads.rootOf(id),
});
const app = createApp({ repo, runner, settings, uploads, root, corsOrigins }).listen({
  hostname,
  port,
  // Above the 200 MB upload limit, so oversized uploads get a clear 413 from VERITAS.
  maxRequestBodySize: 256 * 1024 * 1024,
});

console.log(`VERITAS API ${VERITAS_VERSION} on http://${hostname}:${port}`);
console.log(`  scanning ${root}`);
console.log(`  database ${location}`);

const shutdown = async () => {
  await app.stop();
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
