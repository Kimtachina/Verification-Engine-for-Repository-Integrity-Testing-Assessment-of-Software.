import { z } from "zod";
import type { RawFinding } from "../analyzers/analyzer";
import { runProcess } from "./run-process";
import { createScanPathMapper } from "./scan-path";

const outputSchema = z.array(
  z.object({
    RuleID: z.string(),
    Description: z.string(),
    StartLine: z.int(),
    EndLine: z.int(),
    Match: z.string(),
    File: z.string(),
  }),
);

/** Skip files above this; secrets live in source and config, not in large data dumps. */
const MAX_TARGET_MB = 5;

export async function runGitleaks(opts: {
  gitleaks: string;
  rootDir: string;
  signal: AbortSignal;
}): Promise<RawFinding[]> {
  const { exitCode, stdout, stderr } = await runProcess({
    cmd: [
      opts.gitleaks,
      "dir",
      opts.rootDir,
      "--report-format=json",
      "--report-path=-",
      "--no-banner",
      "--log-level=error",
      // Secrets are replaced with REDACTED before they ever leave Gitleaks.
      "--redact",
      // Exit 0 when leaks are found, so a non-zero exit always means Gitleaks failed.
      "--exit-code=0",
      `--max-target-megabytes=${MAX_TARGET_MB}`,
    ],
    cwd: opts.rootDir,
    signal: opts.signal,
  });
  if (exitCode !== 0)
    throw new Error(`gitleaks failed (exit ${exitCode}): ${stderr.slice(0, 2000)}`);
  return parseGitleaks(stdout, opts.rootDir);
}

export function parseGitleaks(stdout: string, rootDir: string): RawFinding[] {
  const toScanPath = createScanPathMapper(rootDir);
  const findings: RawFinding[] = [];
  for (const leak of outputSchema.parse(JSON.parse(stdout || "[]"))) {
    const file = toScanPath(leak.File);
    if (!file) continue;
    const finding: RawFinding = {
      severity: "critical",
      ruleId: `gitleaks/${leak.RuleID}`,
      message: `${leak.Description.replace(/\.$/, "")}.`,
      suggestion:
        "Revoke and rotate this credential now: it is exposed to everyone with access to the code and its history. Then load it from an environment variable or secret manager.",
      file,
      startLine: leak.StartLine,
      // Never let the pipeline cut a snippet from the file here: it would contain the secret.
      snippet: redactSnippet(leak.Match),
      source: "gitleaks",
    };
    if (leak.EndLine >= leak.StartLine) finding.endLine = leak.EndLine;
    findings.push(finding);
  }
  return findings;
}

/**
 * Gitleaks' redacted match. Defence in depth: if "REDACTED" is somehow absent, the match
 * may still hold the secret, so show nothing rather than risk leaking it into a report.
 */
function redactSnippet(match: string): string {
  return match.includes("REDACTED") ? match : "[secret redacted]";
}
