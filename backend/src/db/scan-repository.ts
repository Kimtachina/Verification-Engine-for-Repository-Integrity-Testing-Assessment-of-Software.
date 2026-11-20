import {
  type FileSummary,
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

/** Postgres allows 65,535 bound parameters per statement; 11 columns × 500 rows stays well under. */
const INSERT_BATCH = 500;

export const INTERRUPTED_ERROR = "The server stopped before this scan finished.";

/** All reads and writes of scans and findings. Rows are validated on the way out. */
export class ScanRepository {
  constructor(private readonly db: Db) {}

  async insertScan(scan: Scan): Promise<void> {
    await this.db.insert(scans).values(scanRow(scan));
  }

  /** Stores the final scan and all its findings atomically: readers never see half a scan. */
  async completeScan(scan: Scan, scanFindings: readonly Finding[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.update(scans).set(scanRow(scan)).where(eq(scans.id, scan.id));
      await tx.delete(findings).where(eq(findings.scanId, scan.id));
      await insertFindings(tx, scan.id, scanFindings);
    });
  }

  /**
   * Adds a finished scan from elsewhere (an older database) with its findings, in one
   * transaction. Returns false, changing nothing, when a scan with that id already exists,
   * so an interrupted import can simply be run again.
   */
  async importScan(scan: Scan, scanFindings: readonly Finding[]): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(scans)
        .values(scanRow(scan))
        .onConflictDoNothing({ target: scans.id })
        .returning({ id: scans.id });
      if (inserted.length === 0) return false;
      await insertFindings(tx, scan.id, scanFindings);
      return true;
    });
  }

  /** Marks scans left running by a previous server process as failed. Returns how many. */
  async failInterruptedScans(now: string): Promise<number> {
    const stale = await this.db
      .select({ data: scans.data })
      .from(scans)
      .where(inArray(scans.status, ["queued", "running"]));
    for (const row of stale) {
      const scan = scanSchema.parse(row.data);
      await this.updateScan({
        ...scan,
        status: "failed",
        finishedAt: now,
        error: INTERRUPTED_ERROR,
      });
    }
    return stale.length;
  }

  async updateScan(scan: Scan): Promise<void> {
    await this.db.update(scans).set(scanRow(scan)).where(eq(scans.id, scan.id));
  }

  async getScan(id: string): Promise<Scan | null> {
    const [row] = await this.db
      .select({ data: scans.data })
      .from(scans)
      .where(eq(scans.id, id))
      .limit(1);
    return row ? scanSchema.parse(row.data) : null;
  }

  /** Newest first. */
  async listScans(limit: number, offset: number): Promise<Scan[]> {
    const rows = await this.db
      .select({ data: scans.data })
      .from(scans)
      .orderBy(desc(scans.startedAt), desc(scans.id))
      .limit(limit)
      .offset(offset);
    return rows.map((r) => scanSchema.parse(r.data));
  }

  async getFinding(id: string): Promise<Finding | null> {
    const [row] = await this.db
      .select({ data: findings.data })
      .from(findings)
      .where(eq(findings.id, id))
      .limit(1);
    return row ? findingSchema.parse(row.data) : null;
  }

  /** Every finding of a scan, worst first. For reports and scan comparison. */
  async allFindings(scanId: string): Promise<Finding[]> {
    const rows = await this.db
      .select({ data: findings.data })
      .from(findings)
      .where(eq(findings.scanId, scanId))
      .orderBy(asc(findings.severityRank), asc(findings.file), START_LINE, asc(findings.ruleId));
    return rows.map((r) => findingSchema.parse(r.data));
  }

  /**
   * Findings per file, the file most worth fixing first: ordered by the same severity
   * weights the scores use, then by name.
   */
  fileSummaries(scanId: string): Promise<FileSummary[]> {
    // Postgres counts are bigint, which the driver returns as strings: cast and map.
    const bySeverity = (s: string) =>
      sql<number>`cast(count(*) filter (where ${findings.severity} = ${s}) as int)`.mapWith(Number);
    const weighted = sql`sum(case ${findings.severity}
      when 'critical' then 10 when 'high' then 5 when 'medium' then 2 when 'low' then 0.5 else 0 end)`;
    return this.db
      .select({
        file: findings.file,
        total: count(),
        critical: bySeverity("critical"),
        high: bySeverity("high"),
        medium: bySeverity("medium"),
        low: bySeverity("low"),
        info: bySeverity("info"),
      })
      .from(findings)
      .where(eq(findings.scanId, scanId))
      .groupBy(findings.file)
      .orderBy(desc(weighted), asc(findings.file));
  }

  async queryFindings(scanId: string, query: FindingQuery): Promise<FindingPage> {
    const where = and(eq(findings.scanId, scanId), ...filters(query));
    const [counted] = await this.db.select({ n: count() }).from(findings).where(where);
    const rows = await this.db
      .select({ data: findings.data })
      .from(findings)
      .where(where)
      .orderBy(...ORDER[query.sort])
      .limit(query.limit)
      .offset(query.offset);
    const items = rows.map((r) => findingSchema.parse(r.data));
    return { items, total: counted?.n ?? 0, limit: query.limit, offset: query.offset };
  }
}

async function insertFindings(
  tx: Parameters<Parameters<Db["transaction"]>[0]>[0],
  scanId: string,
  scanFindings: readonly Finding[],
): Promise<void> {
  for (let i = 0; i < scanFindings.length; i += INSERT_BATCH) {
    const batch = scanFindings.slice(i, i + INSERT_BATCH).map((f) => findingRow(scanId, f));
    await tx.insert(findings).values(batch);
  }
}

/** Whole-file findings (no line) come first within a file. */
const START_LINE = sql`${findings.startLine} asc nulls first`;

const ORDER = {
  severity: [asc(findings.severityRank), asc(findings.file), START_LINE, asc(findings.id)],
  file: [asc(findings.file), START_LINE, asc(findings.severityRank), asc(findings.id)],
  dimension: [
    asc(findings.dimension),
    asc(findings.severityRank),
    asc(findings.file),
    START_LINE,
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
        ? sql`${findings.file} LIKE ${`${escapeLike(query.file)}%`}`
        : eq(findings.file, query.file),
    );
  }
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    // ILIKE: the search is case-insensitive, as the API documents.
    const match = or(
      sql`${findings.message} ILIKE ${pattern}`,
      sql`${findings.ruleId} ILIKE ${pattern}`,
      sql`${findings.file} ILIKE ${pattern}`,
    );
    if (match) out.push(match);
  }
  return out;
}

/** User text is matched literally: %, _ and \ (Postgres' default LIKE escape) lose their meaning. */
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
