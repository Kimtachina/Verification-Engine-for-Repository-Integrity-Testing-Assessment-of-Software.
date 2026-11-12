import { join } from "node:path";
import { z } from "zod";
import { findExecutable, runProcess } from "../../adapters/run-process";
import type { AnalyzerContext } from "../../analyzers/analyzer";
import type { SourceFile } from "../../discovery/source-file";

const SCRIPT = join(import.meta.dir, "python_facts.py");

const functionSchema = z.object({
  name: z.string(),
  startLine: z.int().positive(),
  endLine: z.int().positive(),
  cyclomatic: z.int().positive(),
  cognitive: z.int().nonnegative(),
  maxNesting: z.int().nonnegative(),
});

const fileFactsSchema = z.object({
  path: z.string(),
  functions: z.array(functionSchema),
  imports: z.array(
    z.object({
      /** Dotted module name; "" for `from . import x`. */
      module: z.string(),
      /** 0 for absolute imports, 1 for `.`, 2 for `..` and so on. */
      level: z.int().nonnegative(),
      names: z.array(z.string()),
      line: z.int().positive(),
    }),
  ),
  docs: z.object({ total: z.int().nonnegative(), documented: z.int().nonnegative() }),
  parseError: z.string().optional(),
  parseErrorLine: z.int().positive().optional(),
});

const responseSchema = z.object({ files: z.array(fileFactsSchema) });

export type PythonFileFacts = z.infer<typeof fileFactsSchema>;
export type PythonImport = PythonFileFacts["imports"][number];

export function findPython(): string | null {
  return findExecutable("python3") ?? findExecutable("python");
}

/**
 * Parses Python files with Python's own parser and returns facts for each.
 * Contents go over stdin, so the script never reads the scanned tree; `-I` keeps it
 * from loading anything from the environment, user site-packages or current directory.
 */
export async function collectPythonFacts(
  python: string,
  files: ReadonlyArray<{ path: string; content: string }>,
  signal: AbortSignal,
): Promise<PythonFileFacts[]> {
  if (files.length === 0) return [];
  const { exitCode, stdout, stderr } = await runProcess({
    cmd: [python, "-I", SCRIPT],
    stdin: JSON.stringify({ files: files.map(({ path, content }) => ({ path, content })) }),
    signal,
  });
  if (exitCode !== 0) {
    throw new Error(`Python facts script failed (exit ${exitCode}): ${stderr.slice(0, 2000)}`);
  }
  return responseSchema.parse(JSON.parse(stdout)).files;
}

export type PythonFacts =
  | { available: true; byPath: ReadonlyMap<string, PythonFileFacts> }
  | { available: false; reason: string };

/**
 * Facts for every readable Python file in the scan. Computed once per scan and shared
 * by the complexity, correctness and maintainability analyzers.
 */
export function pythonFactsFor(ctx: AnalyzerContext): Promise<PythonFacts> {
  return ctx.memo("python-facts", async (): Promise<PythonFacts> => {
    const files = ctx.discovery.files.filter(
      (f): f is SourceFile & { content: string } => f.language === "python" && f.content !== null,
    );
    if (files.length === 0) return { available: true, byPath: new Map() };
    const python = findPython();
    if (!python) return { available: false, reason: "python3 not found on PATH" };
    const facts = await collectPythonFacts(python, files, ctx.signal);
    return { available: true, byPath: new Map(facts.map((f) => [f.path, f])) };
  });
}
