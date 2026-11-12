import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema";

const MIGRATIONS = join(import.meta.dir, "migrations");

/**
 * Opens (creating if needed) the SQLite database and applies pending migrations.
 * Pass ":memory:" for a throwaway database in tests.
 */
export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { create: true, strict: true });
  // WAL lets the dashboard read while a scan is being written; foreign keys are off by default.
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec("PRAGMA busy_timeout = 5000;");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => sqlite.close() };
}

export type Db = ReturnType<typeof openDatabase>["db"];
