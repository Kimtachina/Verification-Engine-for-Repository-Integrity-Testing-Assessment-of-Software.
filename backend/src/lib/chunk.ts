/**
 * Splits paths into groups whose combined length stays under `maxChars`, so each group
 * fits on one command line (macOS limits arguments to about 1 MB in total).
 */
export function chunkByLength(paths: readonly string[], maxChars = 100_000): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let length = 0;
  for (const path of paths) {
    if (current.length > 0 && length + path.length + 1 > maxChars) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(path);
    length += path.length + 1;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Prefixes relative paths with "./" so a file named like an option ("-rf.ts",
 * "--config.py") can never be read as one. Works with every tool, unlike "--".
 */
export function asPathArgs(paths: readonly string[]): string[] {
  return paths.map((p) => (p.startsWith("/") ? p : `./${p}`));
}
