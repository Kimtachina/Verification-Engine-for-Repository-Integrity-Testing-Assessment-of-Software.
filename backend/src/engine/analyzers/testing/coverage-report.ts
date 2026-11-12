import { existsSync, lstatSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Coverage files VERITAS looks for, relative to the scan root. Found as files rather
 * than through discovery because "**\/coverage/**" is ignored by default.
 */
const CANDIDATES = [
  "coverage/lcov.info",
  "lcov.info",
  "coverage/coverage-summary.json",
  "coverage/cobertura-coverage.xml",
  "coverage.xml",
] as const;

const MAX_REPORT_BYTES = 50 * 1024 * 1024;

export interface CoverageResult {
  /** Relative path of the report used. */
  path: string;
  /** Line coverage, 0–100. */
  linePercent: number;
  modifiedAt: Date;
}

/** Reads the first usable coverage report under `rootDir`, or null if there is none. */
export async function readCoverage(rootDir: string): Promise<CoverageResult | null> {
  for (const path of CANDIDATES) {
    const abs = join(rootDir, path);
    if (!existsSync(abs)) continue;
    // lstat: a symlinked report could point outside the scan root.
    const stat = lstatSync(abs);
    if (!stat.isFile() || stat.size > MAX_REPORT_BYTES) continue;
    const text = await readFile(abs, "utf-8");
    const percent = parseCoverage(path, text);
    if (percent !== null) return { path, linePercent: percent, modifiedAt: stat.mtime };
  }
  return null;
}

export function parseCoverage(path: string, text: string): number | null {
  if (path.endsWith(".info")) return parseLcov(text);
  if (path.endsWith(".json")) return parseIstanbulSummary(text);
  if (path.endsWith(".xml")) return parseCobertura(text);
  return null;
}

/** lcov: sum of LH (lines hit) over sum of LF (lines found) across all records. */
export function parseLcov(text: string): number | null {
  let found = 0;
  let hit = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("LF:")) found += Number(line.slice(3)) || 0;
    else if (line.startsWith("LH:")) hit += Number(line.slice(3)) || 0;
  }
  return found > 0 ? round((hit / found) * 100) : null;
}

export function parseIstanbulSummary(text: string): number | null {
  try {
    const pct = (JSON.parse(text) as { total?: { lines?: { pct?: unknown } } }).total?.lines?.pct;
    return typeof pct === "number" && Number.isFinite(pct) ? round(pct) : null;
  } catch {
    return null;
  }
}

/** Cobertura (coverage.py, many Java tools): `line-rate` on the root element, 0–1. */
export function parseCobertura(text: string): number | null {
  const match = /<coverage\b[^>]*\bline-rate="([0-9.]+)"/.exec(text);
  if (!match?.[1]) return null;
  const rate = Number(match[1]);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? round(rate * 100) : null;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
