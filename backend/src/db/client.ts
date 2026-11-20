import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

const MIGRATIONS = join(import.meta.dir, "migrations");

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface OpenedDatabase {
  db: Db;
  /** Where the data lives, for the startup log. Never includes a password. */
  location: string;
  close: () => Promise<void>;
}

/**
 * Connects to Postgres (Supabase in production) and applies pending migrations.
 *
 * - `{ url }`: a Postgres connection string, e.g. Supabase's session pooler URL.
 * - `{ dir }`: an embedded Postgres (PGlite) stored in that folder, for running without
 *   a server. Same SQL and migrations as Supabase.
 * - `{ memory: true }`: an embedded, throwaway database for tests.
 */
export async function openDatabase(
  target: { url: string } | { dir: string } | { memory: true },
): Promise<OpenedDatabase> {
  if ("url" in target) {
    // prepare: false keeps it working behind Supabase's transaction pooler too.
    const client = postgres(target.url, { prepare: false, max: 5, onnotice: () => {} });
    const db = drizzlePostgres(client, { schema });
    await migratePostgres(db, { migrationsFolder: MIGRATIONS });
    return { db, location: redact(target.url), close: () => client.end() };
  }
  if ("dir" in target) mkdirSync(target.dir, { recursive: true });
  const client = new PGlite("dir" in target ? target.dir : undefined);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return {
    db,
    location: "dir" in target ? `${target.dir} (embedded Postgres)` : "in memory",
    close: () => client.close(),
  };
}

/** "postgres://user:secret@host:5432/db" -> "postgres://user:***@host:5432/db". */
export function redact(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "(invalid DATABASE_URL)";
  }
}
