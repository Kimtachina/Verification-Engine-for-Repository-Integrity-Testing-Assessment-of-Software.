import {
  DIMENSION_META,
  type Dimension,
  type Grade,
  SEVERITY_META,
  type Severity,
} from "@veritas/shared";

const dateTime = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" });
const number = new Intl.NumberFormat("th-TH");

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatNumber(n: number): string {
  return number.format(n);
}

/** "2.4 วินาที", "1 นาที 5 วินาที". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} มิลลิวินาที`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} วินาที`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} นาที ${Math.round(seconds % 60)} วินาที`;
}

/** Duration of a finished scan, or null while it runs. */
export function scanDuration(scan: {
  startedAt: string;
  finishedAt: string | null;
}): number | null {
  return scan.finishedAt === null ? null : Date.parse(scan.finishedAt) - Date.parse(scan.startedAt);
}

export const dimensionLabel = (d: Dimension) => DIMENSION_META[d].labelTh;
export const severityLabel = (s: Severity) => SEVERITY_META[s].labelTh;

/** "src/a.ts:12–18", "src/a.ts", or "ทั้งโปรเจกต์" for project-level findings. */
export function formatLocation(f: { file: string; startLine?: number; endLine?: number }): string {
  if (f.file === ".") return "ทั้งโปรเจกต์";
  if (f.startLine === undefined) return f.file;
  const range =
    f.endLine !== undefined && f.endLine !== f.startLine
      ? `${f.startLine}–${f.endLine}`
      : `${f.startLine}`;
  return `${f.file}:${range}`;
}

/** Tailwind text colour class for a grade: A/B good, C caution, D/F bad. */
export function gradeTone(grade: Grade): string {
  if (grade === "A" || grade === "B") return "text-good";
  return grade === "C" ? "text-sev-medium" : "text-sev-high";
}

/**
 * Finding ids are `<scanId>-<fingerprint>` (see backend normalize-findings.ts), and the
 * fingerprint is always 32 hex characters, so the scan id is everything before it.
 */
export function scanIdOfFinding(findingId: string): string | null {
  const match = /^(.+)-[a-f0-9]{32}$/.exec(findingId);
  return match?.[1] ?? null;
}
