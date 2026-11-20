#!/usr/bin/env bun
/**
 * Moves scan history from the old SQLite database into Postgres (Supabase).
 *
 *   bun run db:import-sqlite [path/to/veritas.db]
 *
 * Target: DATABASE_URL (from .env), or the embedded database in VERITAS_DB_DIR when it is
 * not set. The SQLite file is only read; delete it yourself once you are happy.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase, redact } from "../src/db/client";
import { importFromSqlite } from "../src/db/import-sqlite";
import { ScanRepository } from "../src/db/scan-repository";

const source = resolve(process.argv[2] ?? ".veritas/veritas.db");
if (!existsSync(source)) {
  console.error(`No SQLite database at ${source}`);
  process.exit(2);
}
const url = process.env.DATABASE_URL?.trim();
const dir = process.env.VERITAS_DB_DIR;
if (!url && !dir) {
  console.error("Set DATABASE_URL in .env (or VERITAS_DB_DIR for the embedded database).");
  process.exit(2);
}

const target = await openDatabase(url ? { url } : { dir: resolve(dir as string) });
console.log(`From ${source}\nTo   ${url ? redact(url) : target.location}\n`);
try {
  const summary = await importFromSqlite(
    source,
    { db: target.db, repo: new ScanRepository(target.db) },
    (done, total, scan) =>
      console.log(`  ${done}/${total}  ${scan.startedAt}  ${scan.root.split("/").at(-1)}`),
  );
  console.log(
    `\nImported ${summary.imported} scan(s) with ${summary.findings} finding(s); ` +
      `${summary.skipped} already there.` +
      (summary.settingsImported ? " Dashboard settings copied." : ""),
  );
  for (const bad of summary.invalid) console.warn(`  not imported ${bad.id}: ${bad.reason}`);
  if (summary.invalid.length > 0) process.exitCode = 1;
} finally {
  await target.close();
}
