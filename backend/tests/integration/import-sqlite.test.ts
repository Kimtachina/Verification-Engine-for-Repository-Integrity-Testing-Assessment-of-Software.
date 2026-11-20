import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Finding, type Scan, SEVERITIES, type SeverityCounts } from "@veritas/shared";
import { type OpenedDatabase, openDatabase } from "../../src/db/client";
import { importFromSqlite } from "../../src/db/import-sqlite";
import { ScanRepository } from "../../src/db/scan-repository";

const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as SeverityCounts;
const scan = (id: string, startedAt: string): Scan => ({
  id,
  status: "completed",
  root: "/x/my-app",
  startedAt,
  finishedAt: startedAt,
  error: null,
  stats: null,
  analyzers: [],
  dimensions: [],
  score: 90,
  grade: "A",
  gate: null,
  counts,
});
const finding = (scanId: string, n: number, startLine?: number): Finding => {
  const fingerprint = n.toString(16).padStart(32, "0");
  return {
    id: `${scanId}-${fingerprint}`,
    fingerprint,
    dimension: "lint",
    severity: "medium",
    ruleId: "rule.x",
    message: `Problem ${n}`,
    file: "src/a.ts",
    language: "typescript",
    source: "biome",
    ...(startLine !== undefined && { startLine }),
  };
};

/** The tables as the SQLite version of VERITAS created them (only what the import reads). */
function oldDatabase(path: string, rows: Array<{ scan: Scan; findings: Finding[] }>) {
  const db = new Database(path, { create: true });
  db.exec(`CREATE TABLE scans (id text PRIMARY KEY, started_at text NOT NULL, data text NOT NULL);
    CREATE TABLE findings (id text PRIMARY KEY, scan_id text NOT NULL, data text NOT NULL);
    CREATE TABLE settings (key text PRIMARY KEY, value text NOT NULL, updated_at text NOT NULL);`);
  for (const { scan, findings } of rows) {
    db.run("INSERT INTO scans VALUES (?, ?, ?)", [scan.id, scan.startedAt, JSON.stringify(scan)]);
    for (const f of findings) {
      db.run("INSERT INTO findings VALUES (?, ?, ?)", [f.id, scan.id, JSON.stringify(f)]);
    }
  }
  db.run("INSERT INTO settings VALUES ('overrides', ?, '2026-11-12T00:00:00.000Z')", [
    JSON.stringify({ ignore: ["dist/**"] }),
  ]);
  db.close();
}

let dir: string;
let target: OpenedDatabase;
let repo: ScanRepository;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "veritas-import-"));
  target = await openDatabase({ memory: true });
  repo = new ScanRepository(target.db);
});
afterAll(async () => {
  await target.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("importFromSqlite", () => {
  test("copies scans with their findings and settings, and a second run changes nothing", async () => {
    const path = join(dir, "veritas.db");
    const many = Array.from({ length: 1203 }, (_, i) => finding("b", i, i + 1));
    oldDatabase(path, [
      { scan: scan("a", "2026-11-12T01:00:00.000Z"), findings: [finding("a", 1)] },
      { scan: scan("b", "2026-11-12T02:00:00.000Z"), findings: many },
    ]);

    const seen: string[] = [];
    const first = await importFromSqlite(path, { db: target.db, repo }, (_d, _t, s) =>
      seen.push(s.id),
    );
    expect(first).toEqual({
      imported: 2,
      skipped: 0,
      invalid: [],
      findings: 1204,
      settingsImported: true,
    });
    expect(seen).toEqual(["a", "b"]);
    expect((await repo.listScans(10, 0)).map((s) => s.id)).toEqual(["b", "a"]);
    expect(await repo.getScan("b")).toEqual(scan("b", "2026-11-12T02:00:00.000Z"));
    const page = await repo.queryFindings("b", {
      sort: "severity",
      limit: 500,
      offset: 0,
    });
    expect(page.total).toBe(1203);
    expect(await repo.getFinding(many[7]?.id ?? "")).toEqual(many[7] ?? null);

    const second = await importFromSqlite(path, { db: target.db, repo });
    expect(second).toMatchObject({ imported: 0, skipped: 2, findings: 0, settingsImported: false });
    expect((await repo.queryFindings("b", { sort: "severity", limit: 1, offset: 0 })).total).toBe(
      1203,
    );
  });

  test("a scan that no longer validates is reported and left out", async () => {
    const path = join(dir, "bad.db");
    oldDatabase(path, [
      { scan: { ...scan("c", "2026-11-13T00:00:00.000Z"), score: 500 }, findings: [] },
    ]);
    const summary = await importFromSqlite(path, { db: target.db, repo });
    expect(summary.imported).toBe(0);
    expect(summary.invalid.map((b) => b.id)).toEqual(["c"]);
    expect(await repo.getScan("c")).toBeNull();
  });
});
