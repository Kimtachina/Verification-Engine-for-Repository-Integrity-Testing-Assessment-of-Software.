import { join } from "node:path";
import { z } from "zod";
import { findExecutable, runProcess } from "../../adapters/run-process";
import type { FileMetrics } from "./function-metrics";

const SCRIPT = join(import.meta.dir, "python_metrics.py");

const responseSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      functions: z.array(
        z.object({
          name: z.string(),
          startLine: z.int().positive(),
          endLine: z.int().positive(),
          cyclomatic: z.int().positive(),
          cognitive: z.int().nonnegative(),
          maxNesting: z.int().nonnegative(),
        }),
      ),
      parseError: z.string().optional(),
    }),
  ),
});

export function findPython(): string | null {
  return findExecutable("python3") ?? findExecutable("python");
}

/**
 * Measures Python files with Python's own parser. Contents go over stdin, so the
 * script never reads the scanned tree; `-I` keeps it from loading anything from
 * the environment, user site-packages or the current directory.
 */
export async function measurePythonFiles(
  python: string,
  files: ReadonlyArray<{ path: string; content: string }>,
  signal: AbortSignal,
): Promise<FileMetrics[]> {
  if (files.length === 0) return [];
  const { exitCode, stdout, stderr } = await runProcess({
    cmd: [python, "-I", SCRIPT],
    stdin: JSON.stringify({ files }),
    signal,
  });
  if (exitCode !== 0) {
    throw new Error(`Python metrics script failed (exit ${exitCode}): ${stderr.slice(0, 2000)}`);
  }
  const parsed = responseSchema.parse(JSON.parse(stdout));
  return parsed.files.map((f) => {
    const metrics: FileMetrics = { path: f.path, functions: f.functions };
    if (f.parseError !== undefined) metrics.parseError = f.parseError;
    return metrics;
  });
}
