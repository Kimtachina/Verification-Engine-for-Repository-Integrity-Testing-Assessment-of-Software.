import type { Severity } from "@veritas/shared";
import { z } from "zod";
import { asPathArgs, chunkByLength } from "../../lib/chunk";
import type { RawFinding } from "../analyzers/analyzer";
import { runProcess } from "./run-process";
import { createScanPathMapper } from "./scan-path";

/**
 * VERITAS never installs the scanned project's dependencies, so every third-party import
 * would look missing. These rules only report that, so they are dropped.
 */
const DEPENDENCY_RULES = new Set([
  "reportMissingImports",
  "reportMissingModuleSource",
  "reportMissingTypeStubs",
]);

const outputSchema = z.object({
  generalDiagnostics: z.array(
    z.object({
      file: z.string(),
      severity: z.enum(["error", "warning", "information"]),
      message: z.string(),
      rule: z.string().optional(),
      range: z
        .object({ start: z.object({ line: z.int() }), end: z.object({ line: z.int() }) })
        .optional(),
    }),
  ),
});

export async function runPyright(opts: {
  pyright: string;
  rootDir: string;
  files: readonly string[];
  signal: AbortSignal;
}): Promise<RawFinding[]> {
  const findings: RawFinding[] = [];
  // Large chunks: Pyright infers types across files, so fewer splits means better results.
  for (const chunk of chunkByLength(opts.files, 200_000)) {
    const { exitCode, stdout, stderr } = await runProcess({
      cmd: [opts.pyright, "--outputjson", ...asPathArgs(chunk)],
      cwd: opts.rootDir,
      signal: opts.signal,
    });
    // 0 = clean, 1 = diagnostics reported; anything else is a crash or bad config.
    if (exitCode > 1 || !stdout.trim()) {
      throw new Error(`pyright failed (exit ${exitCode}): ${(stderr || stdout).slice(0, 2000)}`);
    }
    findings.push(...parsePyright(stdout, opts.rootDir));
  }
  return findings;
}

export function parsePyright(stdout: string, rootDir: string): RawFinding[] {
  const toScanPath = createScanPathMapper(rootDir);
  const findings: RawFinding[] = [];
  for (const d of outputSchema.parse(JSON.parse(stdout)).generalDiagnostics) {
    // Diagnostics without a rule are syntax errors, which correctness reports itself.
    if (!d.rule || DEPENDENCY_RULES.has(d.rule)) continue;
    const file = toScanPath(d.file);
    if (!file) continue;
    const finding: RawFinding = {
      severity: pyrightSeverity(d.severity),
      ruleId: `pyright/${d.rule}`,
      message: d.message,
      file,
      source: "pyright",
      helpUrl: `https://microsoft.github.io/pyright/#/configuration?id=${d.rule}`,
    };
    if (d.range) {
      // Pyright lines are 0-based.
      finding.startLine = d.range.start.line + 1;
      if (d.range.end.line >= d.range.start.line) finding.endLine = d.range.end.line + 1;
    }
    findings.push(finding);
  }
  return findings;
}

function pyrightSeverity(severity: "error" | "warning" | "information"): Severity {
  if (severity === "error") return "medium";
  return severity === "warning" ? "low" : "info";
}
