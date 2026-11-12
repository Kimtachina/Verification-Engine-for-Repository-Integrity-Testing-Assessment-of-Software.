export interface IgnoreMatcher {
  /** True if this file path matches an ignore pattern. */
  isIgnored(path: string): boolean;
  /** True if this directory should be pruned, e.g. "**\/node_modules/**" prunes node_modules. */
  isIgnoredDir(path: string): boolean;
  /** True if any directory above this path is pruned. Ignores patterns on the file itself. */
  isInIgnoredDir(path: string): boolean;
}

export function createIgnoreMatcher(patterns: readonly string[]): IgnoreMatcher {
  const globs = patterns.map((p) => new Bun.Glob(p));
  const isIgnored = (path: string) => globs.some((g) => g.match(path));
  // A directory is pruned when anything inside it would be ignored. The probe name
  // contains a NUL byte, so no real file name can collide with it.
  const isIgnoredDir = (path: string) => isIgnored(path) || isIgnored(`${path}/\u0000probe`);
  const isInIgnoredDir = (path: string) => {
    const segments = path.split("/");
    for (let i = 1; i < segments.length; i++) {
      if (isIgnoredDir(segments.slice(0, i).join("/"))) return true;
    }
    return false;
  };
  return { isIgnored, isIgnoredDir, isInIgnoredDir };
}
