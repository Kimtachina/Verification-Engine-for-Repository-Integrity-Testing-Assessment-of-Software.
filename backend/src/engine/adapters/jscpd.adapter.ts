import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { runProcess } from "./run-process";
import { createScanPathMapper } from "./scan-path";

/** jscpd format names for the languages VERITAS analyses. */
const FORMATS = ["typescript", "tsx", "javascript", "jsx", "python"];

const locationSchema = z.object({ name: z.string(), start: z.int(), end: z.int() });
const reportSchema = z.object({
  duplicates: z.array(
    z.object({
      lines: z.int(),
      tokens: z.int().optional(),
      firstFile: locationSchema,
      secondFile: locationSchema,
    }),
  ),
  statistics: z.object({
    total: z.object({
      lines: z.number(),
      duplicatedLines: z.number(),
      percentage: z.number(),
    }),
  }),
});

export interface DuplicateBlock {
  lines: number;
  original: { file: string; start: number; end: number };
  copy: { file: string; start: number; end: number };
}

export interface DuplicationReport {
  blocks: DuplicateBlock[];
  /** Percentage of analysed lines that are duplicated, 0–100. */
  percentage: number;
  duplicatedLines: number;
  totalLines: number;
}

export async function runJscpd(opts: {
  jscpd: string;
  rootDir: string;
  ignorePatterns: readonly string[];
  minLines: number;
  signal: AbortSignal;
}): Promise<DuplicationReport> {
  // Run from an empty temp dir so a .jscpd.json in the scanned project cannot redirect output.
  const workDir = await mkdtemp(join(tmpdir(), "veritas-jscpd-"));
  try {
    const { exitCode, stderr } = await runProcess({
      cmd: [
        opts.jscpd,
        opts.rootDir,
        "--reporters=json",
        `--output=${workDir}`,
        "--absolute",
        "--silent",
        `--min-lines=${opts.minLines}`,
        `--format=${FORMATS.join(",")}`,
        ...(opts.ignorePatterns.length > 0 ? [`--ignore=${opts.ignorePatterns.join(",")}`] : []),
      ],
      cwd: workDir,
      signal: opts.signal,
    });
    if (exitCode !== 0)
      throw new Error(`jscpd failed (exit ${exitCode}): ${stderr.slice(0, 2000)}`);
    const json = await readFile(join(workDir, "jscpd-report.json"), "utf-8");
    return parseJscpd(json, opts.rootDir);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export function parseJscpd(json: string, rootDir: string): DuplicationReport {
  const toScanPath = createScanPathMapper(rootDir);
  const report = reportSchema.parse(JSON.parse(json));
  const blocks: DuplicateBlock[] = [];
  for (const d of report.duplicates) {
    const original = toScanPath(d.firstFile.name);
    const copy = toScanPath(d.secondFile.name);
    if (!original || !copy) continue;
    blocks.push({
      lines: d.lines,
      original: { file: original, start: d.firstFile.start, end: d.firstFile.end },
      copy: { file: copy, start: d.secondFile.start, end: d.secondFile.end },
    });
  }
  const { percentage, duplicatedLines, lines } = report.statistics.total;
  return { blocks, percentage, duplicatedLines, totalLines: lines };
}
