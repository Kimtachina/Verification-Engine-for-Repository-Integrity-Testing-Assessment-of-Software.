import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Severity } from "@veritas/shared";
import { z } from "zod";
import { asPathArgs, chunkByLength } from "../../lib/chunk";
import type { RawFinding } from "../analyzers/analyzer";
import { runProcess } from "./run-process";
import { createScanPathMapper } from "./scan-path";

/**
 * Rules used when the project has no Ruff config: pyflakes (F), real-error pycodestyle
 * checks (E4, E7, E9), bugbear (B), simplifications (SIM) and comprehensions (C4).
 * Security rules (S) are left to Semgrep, and import sorting is a formatter concern.
 */
export const DEFAULT_RUFF_SELECT = ["E4", "E7", "E9", "F", "B", "SIM", "C4"];

/**
 * Rules that usually indicate a real bug: pyflakes (F401), bugbear (B006) and syntax-level
 * pycodestyle errors (E902). The digit matters: "F" alone would also match FBT and FURB.
 */
const BUG_CODE = /^(?:F|B|E9)\d/;

const outputSchema = z.array(
  z.object({
    code: z.string().nullable(),
    message: z.string(),
    filename: z.string(),
    location: z.object({ row: z.int() }).nullable().optional(),
    end_location: z.object({ row: z.int() }).nullable().optional(),
    url: z.string().nullable().optional(),
  }),
);

export function hasRuffConfig(rootDir: string): boolean {
  if (existsSync(join(rootDir, "ruff.toml")) || existsSync(join(rootDir, ".ruff.toml")))
    return true;
  const pyproject = join(rootDir, "pyproject.toml");
  return existsSync(pyproject) && readFileSync(pyproject, "utf-8").includes("[tool.ruff");
}

export async function runRuff(opts: {
  ruff: string;
  rootDir: string;
  files: readonly string[];
  signal: AbortSignal;
}): Promise<RawFinding[]> {
  // Without a project config, --isolated also stops Ruff picking up a config from a parent folder.
  const configArgs = hasRuffConfig(opts.rootDir)
    ? []
    : ["--isolated", `--select=${DEFAULT_RUFF_SELECT.join(",")}`];
  const findings: RawFinding[] = [];
  for (const chunk of chunkByLength(opts.files)) {
    const { exitCode, stdout, stderr } = await runProcess({
      cmd: [
        opts.ruff,
        "check",
        "--output-format=json",
        "--exit-zero",
        "--no-cache",
        ...configArgs,
        ...asPathArgs(chunk),
      ],
      cwd: opts.rootDir,
      signal: opts.signal,
    });
    if (exitCode !== 0) throw new Error(`ruff failed (exit ${exitCode}): ${stderr.slice(0, 2000)}`);
    findings.push(...parseRuff(stdout, opts.rootDir));
  }
  return findings;
}

export function parseRuff(stdout: string, rootDir: string): RawFinding[] {
  const toScanPath = createScanPathMapper(rootDir);
  const findings: RawFinding[] = [];
  for (const d of outputSchema.parse(JSON.parse(stdout))) {
    // A null code is a syntax error; the correctness dimension reports those.
    if (!d.code) continue;
    const file = toScanPath(d.filename);
    if (!file) continue;
    const code = d.code;
    const finding: RawFinding = {
      severity: ruffSeverity(code),
      ruleId: `ruff/${code}`,
      message: d.message,
      file,
      source: "ruff",
    };
    if (d.url) finding.helpUrl = d.url;
    const start = d.location?.row;
    if (start !== undefined && start > 0) {
      finding.startLine = start;
      const end = d.end_location?.row;
      if (end !== undefined && end >= start) finding.endLine = end;
    }
    findings.push(finding);
  }
  return findings;
}

function ruffSeverity(code: string): Severity {
  return BUG_CODE.test(code) ? "medium" : "low";
}
