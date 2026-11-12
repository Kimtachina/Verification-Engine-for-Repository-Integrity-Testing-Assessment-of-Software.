import type { Language } from "@veritas/shared";

export type FileEncoding = "utf-8" | "utf-8-bom" | "invalid" | "binary" | "unread";

/** One file found under the scan root, with its content loaded when it is readable text. */
export interface SourceFile {
  /** Relative to the scan root, forward slashes. */
  path: string;
  absPath: string;
  language: Language;
  size: number;
  encoding: FileEncoding;
  /** null for binary, invalid-encoding, or too-large-to-load files. */
  content: string | null;
  /** Line count of `content`; 0 when content is null or empty. */
  lines: number;
}

export interface SkippedEntry {
  path: string;
  reason: "symlink" | "unreadable" | "special-file";
  detail?: string;
}

export interface DiscoveryResult {
  files: SourceFile[];
  skipped: SkippedEntry[];
}

/** Splits text into lines, accepting \n, \r\n and lone \r. A trailing newline adds no line. */
export function splitLines(content: string): string[] {
  if (content.length === 0) return [];
  const lines = content.split(/\r\n|\r|\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
