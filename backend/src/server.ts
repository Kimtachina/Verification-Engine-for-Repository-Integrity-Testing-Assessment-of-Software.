#!/usr/bin/env bun
import { join, resolve } from "node:path";
import { createApp } from "./app";
import { ConfigError, loadConfig } from "./config/load-config";
import { type OpenedDatabase, openDatabase, redact } from "./db/client";
import { ScanRepository } from "./db/scan-repository";
import { PasswordAuth } from "./gateway/auth";
import { createGateway } from "./gateway/gateway";
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
 *   VERITAS_PASSWORD    when set, every page and API call needs this password (login page
 *                       at /login). Required when HOST is not a loopback address.
 *   VERITAS_WEB_UPSTREAM  dashboard to serve on the same port, e.g. http://127.0.0.1:3000;
 *                       /api/* stays with the API. Used by the Docker image.
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
const password = process.env.VERITAS_PASSWORD ?? "";
const webUpstream = process.env.VERITAS_WEB_UPSTREAM?.trim() || undefined;

// Reachable from other machines without a password would let anyone upload code and read
// every scan, so refuse rather than start open.
const loopback = ["127.0.0.1", "localhost", "::1"].includes(hostname);
if (!loopback && password.length < 12) {
  console.error(
    `HOST=${hostname} is reachable from other machines: set VERITAS_PASSWORD (12+ characters).`,
  );
  process.exit(2);
}

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
const app = createApp({ repo, runner, settings, uploads, root, corsOrigins });
const gateway = createGateway({
  api: (request) => app.handle(request),
  ...(webUpstream && { webUpstream }),
  ...(password && { auth: new PasswordAuth(password) }),
});
const server = Bun.serve({
  hostname,
  port,
  fetch: (request, srv) => gateway(request, srv.requestIP(request)?.address),
  // Above the 200 MB upload limit, so oversized uploads get a clear 413 from VERITAS.
  maxRequestBodySize: 256 * 1024 * 1024,
  // Longer than the 15 s SSE heartbeat, so idle progress streams stay open.
  idleTimeout: 60,
});

console.log(`VERITAS API ${VERITAS_VERSION} on http://${hostname}:${port}`);
if (webUpstream) console.log(`  dashboard proxied from ${webUpstream}`);
console.log(`  password ${password ? "required" : "off (local use only)"}`);
console.log(`  scanning ${root}`);
console.log(`  database ${location}`);

const shutdown = async () => {
  await server.stop();
  await close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
