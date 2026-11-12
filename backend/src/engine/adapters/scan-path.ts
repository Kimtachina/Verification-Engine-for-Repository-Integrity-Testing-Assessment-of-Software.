import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Converts a path printed by a tool (absolute, or relative to `rootDir`) into a
 * scan-relative forward-slash path. Returns null for anything outside the root.
 *
 * Both the given and the real root are tried, because tools often print resolved
 * paths (macOS reports /tmp as /private/tmp).
 */
export function createScanPathMapper(rootDir: string): (toolPath: string) => string | null {
  const roots = [...new Set([resolve(rootDir), safeRealpath(rootDir)])];
  return (toolPath) => {
    for (const root of roots) {
      const abs = isAbsolute(toolPath) ? toolPath : resolve(root, toolPath);
      const rel = relative(root, abs);
      if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).join("/");
    }
    return null;
  };
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
