import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const MIGRATIONS = join(import.meta.dir, "../../src/db/migrations");

test("moving the tables to public keeps every row and keeps RLS on", async () => {
  // A database as the first release left it: only migration 0000 applied, with data.
  const firstOnly = mkdtempSync(join(tmpdir(), "veritas-migrations-"));
  cpSync(MIGRATIONS, firstOnly, { recursive: true });
  const journal = await Bun.file(join(firstOnly, "meta/_journal.json")).json();
  journal.entries = journal.entries.slice(0, 1);
  writeFileSync(join(firstOnly, "meta/_journal.json"), JSON.stringify(journal));

  const client = new PGlite();
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder: firstOnly });
    await client.exec(`
      INSERT INTO veritas.scans (id, status, root, started_at, data)
        VALUES ('s1', 'completed', '/x', now(), '{"id":"s1"}');
      INSERT INTO veritas.findings (id, scan_id, fingerprint, dimension, severity, severity_rank, rule_id, file, message, data)
        VALUES ('f1', 's1', 'ab', 'lint', 'low', 3, 'r', 'a.ts', 'm', '{}');
      INSERT INTO veritas.settings (key, value, updated_at) VALUES ('overrides', '{}', now());`);

    await migrate(db, { migrationsFolder: MIGRATIONS });

    const counts = await client.query<{ scans: number; findings: number; settings: number }>(
      `SELECT (SELECT count(*)::int FROM public.scans) AS scans,
              (SELECT count(*)::int FROM public.findings) AS findings,
              (SELECT count(*)::int FROM public.settings) AS settings`,
    );
    expect(counts.rows[0]).toEqual({ scans: 1, findings: 1, settings: 1 });
    const rls = await client.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT relname, relrowsecurity FROM pg_class
       WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' ORDER BY relname`,
    );
    expect(rls.rows).toEqual([
      { relname: "findings", relrowsecurity: true },
      { relname: "scans", relrowsecurity: true },
      { relname: "settings", relrowsecurity: true },
    ]);
    const schema = await client.query(`SELECT 1 FROM pg_namespace WHERE nspname = 'veritas'`);
    expect(schema.rows).toHaveLength(0);
  } finally {
    await client.close();
    rmSync(firstOnly, { recursive: true, force: true });
  }
});
