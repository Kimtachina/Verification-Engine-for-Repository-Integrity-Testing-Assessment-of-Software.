import { Database } from "bun:sqlite";
import { type Finding, findingSchema, type Scan, scanSchema } from "@veritas/shared";
import { eq } from "drizzle-orm";
import type { Db } from "./client";
import type { ScanRepository } from "./scan-repository";
import { settings } from "./schema";

export interface ImportSummary {
  imported: number;
  /** Already in the target database (an earlier import, or the same id). */
  skipped: number;
  /** Rows that no longer pass the current schema: reported, never written. */
  invalid: Array<{ id: string; reason: string }>;
  findings: number;
  settingsImported: boolean;
}

/**
 * Copies scans, findings and dashboard settings from the SQLite database VERITAS used
 * before Postgres (.veritas/veritas.db) into the current database. Read-only on the
 * SQLite file. Each scan goes in with its findings in one transaction, and scans that
 * already exist are skipped, so it is safe to run again after an interruption.
 */
export async function importFromSqlite(
  sqlitePath: string,
  target: { db: Db; repo: ScanRepository },
  onScan: (done: number, total: number, scan: Scan) => void = () => {},
): Promise<ImportSummary> {
  const sqlite = new Database(sqlitePath, { readonly: true, strict: true });
  try {
    const summary: ImportSummary = {
      imported: 0,
      skipped: 0,
      invalid: [],
      findings: 0,
      settingsImported: false,
    };
    // Oldest first, so the history keeps its order however far the import gets.
    const rows = sqlite
      .query<{ id: string; data: string }, []>("SELECT id, data FROM scans ORDER BY started_at, id")
      .all();
    const findingsOf = sqlite.query<{ data: string }, [string]>(
      "SELECT data FROM findings WHERE scan_id = ?",
    );

    for (const [i, row] of rows.entries()) {
      const scan = scanSchema.safeParse(JSON.parse(row.data));
      if (!scan.success) {
        summary.invalid.push({ id: row.id, reason: scan.error.issues[0]?.message ?? "invalid" });
        continue;
      }
      const parsed = findingsOf.all(row.id).map((f) => findingSchema.safeParse(JSON.parse(f.data)));
      const bad = parsed.find((p) => !p.success);
      if (bad && !bad.success) {
        summary.invalid.push({ id: row.id, reason: `finding: ${bad.error.issues[0]?.message}` });
        continue;
      }
      const scanFindings = parsed.flatMap((p): Finding[] => (p.success ? [p.data] : []));
      if (await target.repo.importScan(scan.data, scanFindings)) {
        summary.imported++;
        summary.findings += scanFindings.length;
      } else {
        summary.skipped++;
      }
      onScan(i + 1, rows.length, scan.data);
    }

    // Saved dashboard settings, unless the target already has its own.
    const old = sqlite
      .query<{ key: string; value: string; updated_at: string }, []>(
        "SELECT key, value, updated_at FROM settings",
      )
      .all();
    for (const row of old) {
      const existing = await target.db.select().from(settings).where(eq(settings.key, row.key));
      if (existing.length > 0) continue;
      await target.db
        .insert(settings)
        .values({ key: row.key, value: JSON.parse(row.value), updatedAt: row.updated_at });
      summary.settingsImported = true;
    }
    return summary;
  } finally {
    sqlite.close();
  }
}
