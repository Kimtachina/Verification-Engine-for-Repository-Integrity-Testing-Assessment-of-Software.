import {
  type Finding,
  type FindingPage,
  type FindingQuery,
  findingSchema,
  type Scan,
  SEVERITIES,
  scanSchema,
} from "@veritas/shared";
import { and, asc, count, desc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import type { Db } from "./client";
import { findings, scans } from "./schema";

/** SQLite allows 32,766 bound variables per statement; 11 columns × 500 rows stays well under. */
const INSERT_BATCH = 500;

export const INTERRUPTED_ERROR = "The server stopped before this scan finished.";

/** All reads and writes of scans and findings. Rows are validated on the way out. */
export class ScanRepository {
  constructor(private readonly db: Db) {}

  insertScan(scan: Scan): void {
    this.db.insert(scans).values(scanRow(scan)).run();
  }

  /** Stores the final scan and all its findings atomically: readers never see half a scan. */
  completeScan(scan: Scan, scanFindings: readonly Finding[]): void {
    this.db.transaction((tx) => {
      tx.update(scans).set(scanRow(scan)).where(eq(scans.id, scan.id)).run();
      tx.delete(findings).where(eq(findings.scanId, scan.id)).run();
      for (let i = 0; i < scanFindings.length; i += INSERT_BATCH) {
        const batch = scanFindings.slice(i, i + INSERT_BATCH).map((f) => findingRow(scan.id, f));
        tx.insert(findings).values(batch).run();
      }
    });
  }

  /** Marks scans left running by a previous server process as failed. Returns how many. */
  failInterruptedScans(now: string): number {
    const stale = this.db
      .select({ data: scans.data })
      .from(scans)
      .where(inArray(scans.status, ["queued", "running"]))
      .all();
    for (const row of stale) {
      const scan = scanSchema.parse(row.data);
      this.updateScan({ ...scan, status: "failed", finishedAt: now, error: INTERRUPTED_ERROR });
    }
    return stale.length;
  }

  updateScan(scan: Scan): void {
    this.db.update(scans).set(scanRow(scan)).where(eq(scans.id, scan.id)).run();
  }

  getScan(id: string): Scan | null {
    const row = this.db.select({ data: scans.data }).from(scans).where(eq(scans.id, id)).get();
    return row ? scanSchema.parse(row.data) : null;
  }

  /** Newest first. */
  listScans(limit: number, offset: number): Scan[] {
    return this.db
      .select({ data: scans.data })
      .from(scans)
      .orderBy(desc(scans.startedAt), desc(scans.id))
      .limit(limit)
      .offset(offset)
      .all()
      .map((r) => scanSchema.parse(r.data));
  }

  getFinding(id: string): Finding | null {
    const row = this.db
      .select({ data: findings.data })
      .from(findings)
      .where(eq(findings.id, id))
      .get();
    return row ? findingSchema.parse(row.data) : null;
  }

  /** Every finding of a scan, worst first. For reports and scan comparison. */
  allFindings(scanId: string): Finding[] {
    return this.db
      .select({ data: findings.data })
      .from(findings)
      .where(eq(findings.scanId, scanId))
      .orderBy(
        asc(findings.severityRank),
        asc(findings.file),
        asc(findings.startLine),
        asc(findings.ruleId),
      )
      .all()
      .map((r) => findingSchema.parse(r.data));
  }

  queryFindings(scanId: string, query: FindingQuery): FindingPage {
    const where = and(eq(findings.scanId, scanId), ...filters(query));
    const total = this.db.select({ n: count() }).from(findings).where(where).get()?.n ?? 0;
    const items = this.db
      .select({ data: findings.data })
      .from(findings)
      .where(where)
      .orderBy(...ORDER[query.sort])
      .limit(query.limit)
      .offset(query.offset)
      .all()
      .map((r) => findingSchema.parse(r.data));
    return { items, total, limit: query.limit, offset: query.offset };
  }
}

const ORDER = {
  severity: [
    asc(findings.severityRank),
    asc(findings.file),
    asc(findings.startLine),
    asc(findings.id),
  ],
  file: [asc(findings.file), asc(findings.startLine), asc(findings.severityRank), asc(findings.id)],
  dimension: [
    asc(findings.dimension),
    asc(findings.severityRank),
    asc(findings.file),
    asc(findings.startLine),
    asc(findings.id),
  ],
} satisfies Record<FindingQuery["sort"], SQL[]>;

function filters(query: FindingQuery): SQL[] {
  const out: SQL[] = [];
  if (query.severity) out.push(inArray(findings.severity, query.severity));
  if (query.dimension) out.push(inArray(findings.dimension, query.dimension));
  if (query.file) {
    out.push(
      query.file.endsWith("/")
        ? sql`${findings.file} LIKE ${`${escapeLike(query.file)}%`} ESCAPE '\\'`
        : eq(findings.file, query.file),
    );
  }
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    const match = or(
      sql`${findings.message} LIKE ${pattern} ESCAPE '\\'`,
      sql`${findings.ruleId} LIKE ${pattern} ESCAPE '\\'`,
      sql`${findings.file} LIKE ${pattern} ESCAPE '\\'`,
    );
    if (match) out.push(match);
  }
  return out;
}

/** User text is matched literally: %, _ and \ lose their LIKE meaning. */
function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function scanRow(scan: Scan) {
  return {
    id: scan.id,
    status: scan.status,
    root: scan.root,
    startedAt: scan.startedAt,
    finishedAt: scan.finishedAt,
    score: scan.score,
    grade: scan.grade,
    gatePassed: scan.gate?.passed ?? null,
    error: scan.error,
    data: scan,
  };
}

function findingRow(scanId: string, f: Finding) {
  return {
    id: f.id,
    scanId,
    fingerprint: f.fingerprint,
    dimension: f.dimension,
    severity: f.severity,
    severityRank: SEVERITIES.indexOf(f.severity),
    ruleId: f.ruleId,
    file: f.file,
    startLine: f.startLine ?? null,
    message: f.message,
    data: f,
  };
}
