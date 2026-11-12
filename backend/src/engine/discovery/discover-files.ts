import type { Dirent } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { languageFor } from "@veritas/shared";
import { mapLimit } from "../../lib/map-limit";
import { createIgnoreMatcher } from "./ignore";
import {
  type DiscoveryResult,
  type SkippedEntry,
  type SourceFile,
  splitLines,
} from "./source-file";

/** Files above this are never loaded into memory; integrity reports them as oversized. */
export const MAX_READ_BYTES = 5 * 1024 * 1024;
/** Bytes inspected for NUL when deciding whether a file is binary (same heuristic as git). */
const BINARY_SNIFF_BYTES = 8000;
const READ_CONCURRENCY = 32;

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export interface DiscoverOptions {
  rootDir: string;
  ignorePatterns: readonly string[];
}

/**
 * Walks the scan root and loads every non-ignored file.
 *
 * Symlinks are never followed: a link could point outside the root, or form a cycle.
 * They are recorded in `skipped` so the integrity analyzer can report them.
 */
export async function discoverFiles({
  rootDir,
  ignorePatterns,
}: DiscoverOptions): Promise<DiscoveryResult> {
  const { isIgnored, isIgnoredDir } = createIgnoreMatcher(ignorePatterns);

  const filePaths: string[] = [];
  const skipped: SkippedEntry[] = [];

  async function walk(relDir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(join(rootDir, relDir), { withFileTypes: true });
    } catch (error) {
      skipped.push({ path: relDir || ".", reason: "unreadable", detail: errorMessage(error) });
      return;
    }
    // Code-unit order, not locale order, so results are identical on every machine.
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const isDir = entry.isDirectory() && !entry.isSymbolicLink();
      if (isDir ? isIgnoredDir(rel) : isIgnored(rel)) continue;

      if (entry.isSymbolicLink()) skipped.push({ path: rel, reason: "symlink" });
      else if (isDir) await walk(rel);
      else if (entry.isFile()) filePaths.push(rel);
      else skipped.push({ path: rel, reason: "special-file" });
    }
  }

  await walk("");

  const loaded = await mapLimit(filePaths, READ_CONCURRENCY, (rel) => loadFile(rootDir, rel));
  const files: SourceFile[] = [];
  for (const result of loaded) {
    if ("file" in result) files.push(result.file);
    else skipped.push(result.skipped);
  }
  return { files, skipped };
}

async function loadFile(
  rootDir: string,
  path: string,
): Promise<{ file: SourceFile } | { skipped: SkippedEntry }> {
  const absPath = join(rootDir, path);
  const language = languageFor(path);
  try {
    const { size } = await lstat(absPath);
    const base = { path, absPath, language, size };
    if (size > MAX_READ_BYTES) {
      return { file: { ...base, encoding: "unread", content: null, lines: 0 } };
    }

    const bytes = await readFile(absPath);
    if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      return { file: { ...base, encoding: "binary", content: null, lines: 0 } };
    }

    let text: string;
    try {
      text = utf8.decode(bytes);
    } catch {
      return { file: { ...base, encoding: "invalid", content: null, lines: 0 } };
    }

    const hasBom = text.charCodeAt(0) === 0xfeff;
    const content = hasBom ? text.slice(1) : text;
    return {
      file: {
        ...base,
        encoding: hasBom ? "utf-8-bom" : "utf-8",
        content,
        lines: splitLines(content).length,
      },
    };
  } catch (error) {
    return { skipped: { path, reason: "unreadable", detail: errorMessage(error) } };
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
