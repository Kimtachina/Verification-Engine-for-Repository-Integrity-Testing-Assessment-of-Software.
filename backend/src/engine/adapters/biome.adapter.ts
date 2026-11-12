import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Severity } from "@veritas/shared";
import { z } from "zod";
import { asPathArgs, chunkByLength } from "../../lib/chunk";
import type { RawFinding } from "../analyzers/analyzer";
import { runProcess } from "./run-process";
import { createScanPathMapper } from "./scan-path";

/**
 * Not named biome.json on purpose: Biome would treat a biome.json inside VERITAS's own
 * source tree as a nested project config and refuse to lint VERITAS itself.
 */
const VERITAS_CONFIG = join(import.meta.dir, "configs", "veritas-biome.json");

const outputSchema = z.object({
  diagnostics: z.array(
    z.object({
      severity: z.string(),
      message: z.string(),
      category: z.string().optional(),
      location: z
        .object({
          path: z.string().optional(),
          start: z.object({ line: z.int() }).optional(),
          end: z.object({ line: z.int() }).optional(),
        })
        .optional(),
    }),
  ),
});

/** Rule groups whose findings are usually real bugs rather than style preferences. */
const BUG_GROUPS = new Set(["correctness", "suspicious", "security"]);

/** The project's own Biome config at the scan root wins; otherwise VERITAS's recommended preset. */
export function biomeConfigPath(rootDir: string): string {
  const own = ["biome.json", "biome.jsonc"].map((f) => join(rootDir, f)).find((f) => existsSync(f));
  return own ?? VERITAS_CONFIG;
}

export async function runBiome(opts: {
  biome: string;
  rootDir: string;
  files: readonly string[];
  signal: AbortSignal;
}): Promise<RawFinding[]> {
  const findings: RawFinding[] = [];
  for (const chunk of chunkByLength(opts.files)) {
    const { exitCode, stdout, stderr } = await runProcess({
      cmd: [
        opts.biome,
        "lint",
        "--reporter=json",
        "--max-diagnostics=none",
        "--files-ignore-unknown=true",
        "--no-errors-on-unmatched",
        `--config-path=${biomeConfigPath(opts.rootDir)}`,
        ...asPathArgs(chunk),
      ],
      cwd: opts.rootDir,
      signal: opts.signal,
    });
    // Biome exits 1 when it reports errors; only missing JSON means it actually failed.
    if (!stdout.trim())
      throw new Error(`biome failed (exit ${exitCode}): ${stderr.slice(0, 2000)}`);
    findings.push(...parseBiome(stdout, opts.rootDir));
  }
  return findings;
}

export function parseBiome(stdout: string, rootDir: string): RawFinding[] {
  const toScanPath = createScanPathMapper(rootDir);
  const { diagnostics } = outputSchema.parse(JSON.parse(stdout));
  const findings: RawFinding[] = [];
  for (const d of diagnostics) {
    // Syntax errors belong to the correctness dimension, which reports them itself.
    if (!d.category?.startsWith("lint/") || !d.location?.path) continue;
    const file = toScanPath(d.location.path);
    if (!file) continue;
    const [, group = "", rule = ""] = d.category.split("/");
    const finding: RawFinding = {
      severity: biomeSeverity(d.severity, group),
      ruleId: d.category,
      message: d.message,
      file,
      source: "biome",
      helpUrl: `https://biomejs.dev/linter/rules/${kebab(rule)}/`,
    };
    const start = d.location.start?.line;
    if (start !== undefined) {
      finding.startLine = start;
      const end = d.location.end?.line;
      if (end !== undefined && end >= start) finding.endLine = end;
    }
    findings.push(finding);
  }
  return findings;
}

function biomeSeverity(severity: string, group: string): Severity {
  if (severity === "info") return "info";
  return BUG_GROUPS.has(group) ? "medium" : "low";
}

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}
