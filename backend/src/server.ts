#!/usr/bin/env bun
import { join, resolve } from "node:path";
import { createApp } from "./app";
import { ConfigError, loadConfig } from "./config/load-config";
import { openDatabase } from "./db/client";
import { ScanRepository } from "./db/scan-repository";
import { ScanRunner } from "./services/scan-runner";
import { SettingsService } from "./services/settings-service";
import { VERITAS_VERSION } from "./version";

/**
 * Environment:
 *   VERITAS_CONFIG_DIR  folder with veritas.config.ts (default: current directory)
 *   VERITAS_DB          SQLite file (default: <config dir>/.veritas/veritas.db)
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

const dbPath = resolve(process.env.VERITAS_DB ?? join(configDir, ".veritas", "veritas.db"));
const { db, close } = openDatabase(dbPath);
const repo = new ScanRepository(db);
const interrupted = repo.failInterruptedScans(new Date().toISOString());
if (interrupted > 0) console.warn(`Marked ${interrupted} interrupted scan(s) as failed.`);

const settings = new SettingsService(db, configDir);
const runner = new ScanRunner({ repo, loadConfig: settings.loadConfig });
const app = createApp({ repo, runner, settings, root, corsOrigins }).listen({ hostname, port });

console.log(`VERITAS API ${VERITAS_VERSION} on http://${hostname}:${port}`);
console.log(`  scanning ${root}`);
console.log(`  database ${dbPath}`);

const shutdown = async () => {
  await app.stop();
  close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
