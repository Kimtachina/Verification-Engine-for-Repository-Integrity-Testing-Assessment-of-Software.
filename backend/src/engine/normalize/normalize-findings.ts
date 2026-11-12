import { createHash } from "node:crypto";
import {
  compareSeverity,
  type Dimension,
  type Finding,
  findingSchema,
  languageFor,
} from "@veritas/shared";
import { PROJECT_FILE, type RawFinding } from "../analyzers/analyzer";
import { type SourceFile, splitLines } from "../discovery/source-file";

const MAX_SNIPPET_LINES = 8;
const MAX_SNIPPET_CHARS = 4000;

/**
 * Turns one analyzer's raw findings into complete, validated `Finding`s:
 * fills language and snippet, drops exact duplicates, and assigns a fingerprint
 * that survives unrelated edits to the file.
 *
 * Throws if an analyzer produced an invalid finding; the pipeline records that as
 * an analyzer failure rather than letting bad data reach the report.
 */
export function normalizeFindings(
  dimension: Dimension,
  raw: readonly RawFinding[],
  filesByPath: ReadonlyMap<string, SourceFile>,
  scanId: string,
): Finding[] {
  const linesOf = memoizeLines();
  const fingerprintFor = createFingerprinter(dimension);

  return dedupe(raw).map((r) => {
    const source = filesByPath.get(r.file);
    const lines = source ? linesOf(source) : [];
    const lineText = r.startLine !== undefined ? (lines[r.startLine - 1] ?? "") : "";
    const fingerprint = fingerprintFor(r, lineText);

    const candidate: Record<string, unknown> = {
      ...r,
      id: `${scanId}-${fingerprint}`,
      fingerprint,
      dimension,
      language: source?.language ?? languageOfPath(r.file),
    };
    const snippet = r.snippet ?? cutSnippet(lines, r.startLine, r.endLine);
    if (snippet === undefined) delete candidate.snippet;
    else candidate.snippet = truncate(snippet, MAX_SNIPPET_CHARS);

    return findingSchema.parse(candidate);
  });
}

/** Drops findings identical in rule, file, line and message. First one wins. */
function dedupe(raw: readonly RawFinding[]): RawFinding[] {
  const seen = new Set<string>();
  return raw.filter((r) => {
    const key = [r.ruleId, r.file, r.startLine ?? "", r.message].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Fingerprints from line content, not line number, so inserting code above a finding
 * keeps its identity. Identical lines in one file are told apart by occurrence order.
 */
function createFingerprinter(dimension: Dimension) {
  const occurrences = new Map<string, number>();
  return (r: RawFinding, lineText: string): string => {
    const basis = [dimension, r.ruleId, r.file, normalizeWhitespace(lineText)].join("\u0000");
    const occurrence = occurrences.get(basis) ?? 0;
    occurrences.set(basis, occurrence + 1);
    const input = occurrence === 0 ? basis : `${basis}\u0000${occurrence}`;
    return sha256(input).slice(0, 32);
  };
}

function memoizeLines(): (file: SourceFile) => string[] {
  const cache = new Map<string, string[]>();
  return (file) => {
    let lines = cache.get(file.path);
    if (!lines) {
      lines = file.content === null ? [] : splitLines(file.content);
      cache.set(file.path, lines);
    }
    return lines;
  };
}

/** For files discovery never loaded, such as a coverage report or the project itself. */
function languageOfPath(path: string) {
  return path === PROJECT_FILE ? "other" : languageFor(path);
}

/** Worst first, then by file and line, so reports read top to bottom. */
export function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort(
    (a, b) =>
      compareSeverity(a.severity, b.severity) ||
      a.file.localeCompare(b.file) ||
      (a.startLine ?? 0) - (b.startLine ?? 0) ||
      a.ruleId.localeCompare(b.ruleId),
  );
}

function cutSnippet(
  lines: readonly string[],
  startLine: number | undefined,
  endLine: number | undefined,
): string | undefined {
  if (startLine === undefined || lines.length === 0) return undefined;
  const last = Math.min(endLine ?? startLine, startLine + MAX_SNIPPET_LINES - 1, lines.length);
  const slice = lines.slice(startLine - 1, last);
  return slice.length > 0 ? slice.join("\n") : undefined;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function normalizeWhitespace(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
