import type { Severity } from "@veritas/shared";
import { z } from "zod";
import { asPathArgs, chunkByLength } from "../../lib/chunk";
import type { RawFinding } from "../analyzers/analyzer";
import { runProcess } from "./run-process";
import { createScanPathMapper } from "./scan-path";

const resultSchema = z.object({
  check_id: z.string(),
  path: z.string(),
  start: z.object({ line: z.int() }),
  end: z.object({ line: z.int() }),
  extra: z.object({
    message: z.string(),
    severity: z.string(),
    metadata: z
      .object({
        "source-rule-url": z.string().optional(),
        references: z.array(z.string()).optional(),
        cwe: z.union([z.string(), z.array(z.string())]).optional(),
        confidence: z.string().optional(),
      })
      .loose()
      .optional(),
  }),
});
const outputSchema = z.object({
  results: z.array(resultSchema),
  errors: z.array(
    z
      .object({ type: z.unknown(), message: z.string().optional(), level: z.string().optional() })
      .loose(),
  ),
});

export async function runSemgrep(opts: {
  semgrep: string;
  rootDir: string;
  files: readonly string[];
  rules: readonly string[];
  signal: AbortSignal;
}): Promise<RawFinding[]> {
  const findings: RawFinding[] = [];
  // Large chunks: every Semgrep run re-loads the rule sets, which is the slow part.
  for (const chunk of chunkByLength(opts.files, 200_000)) {
    const { exitCode, stdout, stderr } = await runProcess({
      cmd: [
        opts.semgrep,
        "scan",
        "--json",
        "--quiet",
        "--metrics=off",
        "--disable-version-check",
        // The scanned code may sit inside a git repo that ignores it (VERITAS's own code/).
        "--no-git-ignore",
        ...opts.rules.map((r) => `--config=${r}`),
        ...asPathArgs(chunk),
      ],
      cwd: opts.rootDir,
      signal: opts.signal,
      env: { ...semgrepEnv() },
    });
    // Exit 0 with or without findings (no --error); anything else is a failure.
    if (exitCode !== 0 || !stdout.trim()) {
      throw new Error(`semgrep failed (exit ${exitCode}): ${(stderr || stdout).slice(0, 2000)}`);
    }
    findings.push(...parseSemgrep(stdout, opts.rootDir));
  }
  return findings;
}

export function parseSemgrep(stdout: string, rootDir: string): RawFinding[] {
  const toScanPath = createScanPathMapper(rootDir);
  const findings: RawFinding[] = [];
  for (const r of outputSchema.parse(JSON.parse(stdout)).results) {
    // Secret detection is the secrets dimension's job (Gitleaks); avoid double counting.
    if (r.check_id.includes(".secrets.")) continue;
    const file = toScanPath(r.path);
    if (!file) continue;
    const meta = r.extra.metadata;
    const finding: RawFinding = {
      severity: semgrepSeverity(r.extra.severity),
      ruleId: `semgrep/${shortRuleId(r.check_id)}`,
      message: withCwe(r.extra.message.trim(), meta?.cwe),
      file,
      startLine: r.start.line,
      source: "semgrep",
    };
    if (r.end.line >= r.start.line) finding.endLine = r.end.line;
    const help = meta?.["source-rule-url"] ?? meta?.references?.[0];
    if (help && URL.canParse(help)) finding.helpUrl = help;
    findings.push(finding);
  }
  return findings;
}

/** "python.lang.security.audit.subprocess-shell-true.subprocess-shell-true" → "python.lang.security.audit.subprocess-shell-true" */
function shortRuleId(checkId: string): string {
  const parts = checkId.split(".");
  return parts.length > 1 && parts.at(-1) === parts.at(-2) ? parts.slice(0, -1).join(".") : checkId;
}

function withCwe(message: string, cwe: string | string[] | undefined): string {
  const first = Array.isArray(cwe) ? cwe[0] : cwe;
  const id = first?.match(/CWE-\d+/)?.[0];
  return id && !message.includes(id) ? `${message} (${id})` : message;
}

function semgrepSeverity(severity: string): Severity {
  switch (severity.toUpperCase()) {
    case "ERROR":
    case "HIGH":
    case "CRITICAL":
      return "high";
    case "WARNING":
    case "MEDIUM":
      return "medium";
    default:
      return "low";
  }
}

function semgrepEnv(): Record<string, string> {
  const env: Record<string, string> = { SEMGREP_SEND_METRICS: "off" };
  for (const key of ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
