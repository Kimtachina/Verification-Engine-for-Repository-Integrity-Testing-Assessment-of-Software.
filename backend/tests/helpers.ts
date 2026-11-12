import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { languageFor } from "@veritas/shared";
import { type ResolvedConfig, resolveConfig } from "../src/config/load-config";
import { type AnalyzerContext, createMemo } from "../src/engine/analyzers/analyzer";
import type { DiscoveryResult, SourceFile } from "../src/engine/discovery/source-file";
import { splitLines } from "../src/engine/discovery/source-file";

export const FIXTURES = join(import.meta.dir, "fixtures");

/** An in-memory text file, as discovery would produce it. */
export function textFile(path: string, content: string): SourceFile {
  return {
    path,
    absPath: `/virtual/${path}`,
    language: languageFor(path),
    size: Buffer.byteLength(content),
    encoding: "utf-8",
    content,
    lines: splitLines(content).length,
  };
}

/** A temporary directory populated with `files`; call `cleanup()` when done. */
export function tempTree(files: Record<string, string | Uint8Array>): {
  dir: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "veritas-test-"));
  for (const [path, content] of Object.entries(files)) {
    const abs = join(dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function configFor(rootDir: string, input: Record<string, unknown> = {}): ResolvedConfig {
  return resolveConfig({ ...input, root: rootDir }, rootDir);
}

/** Context for calling an analyzer directly on synthetic files. */
export function contextFor(
  files: SourceFile[],
  options: {
    rootDir?: string;
    skipped?: DiscoveryResult["skipped"];
    config?: Record<string, unknown>;
  } = {},
): AnalyzerContext {
  return {
    config: configFor(options.rootDir ?? tmpdir(), options.config),
    discovery: { files, skipped: options.skipped ?? [] },
    signal: new AbortController().signal,
    memo: createMemo(),
  };
}

/** Rule IDs of completed analyzer output, for compact assertions. */
export function ruleIds(findings: ReadonlyArray<{ ruleId: string }>): string[] {
  return findings.map((f) => f.ruleId);
}
