/** Limits for folder uploads, enforced by the server and checked early by the dashboard. */
export const UPLOAD_LIMITS = {
  maxFiles: 20_000,
  maxTotalBytes: 200 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
} as const;

/**
 * Folders never uploaded: installed dependencies, build output, caches and VCS data.
 * They are not the author's code and would make uploads huge. Lockfiles are still
 * uploaded, because the dependencies dimension reads them.
 */
export const UPLOAD_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".veritas",
]);

export type UploadSkipReason = "ignored-folder" | "too-large" | "unsafe-path";

/** Whether the dashboard should send this file, and why not if it should not. */
export function uploadDecision(
  path: string,
  size: number,
): { upload: true } | { upload: false; reason: UploadSkipReason } {
  if (!isSafeRelativePath(path)) return { upload: false, reason: "unsafe-path" };
  const dirs = path.split("/").slice(0, -1);
  if (dirs.some((d) => UPLOAD_SKIP_DIRS.has(d))) return { upload: false, reason: "ignored-folder" };
  if (size > UPLOAD_LIMITS.maxFileBytes) return { upload: false, reason: "too-large" };
  return { upload: true };
}

/**
 * A path the server may write under an upload folder: relative, forward slashes, no
 * empty, "." or ".." segments, no control characters, sane lengths. Anything else could
 * escape the folder ("../../etc/passwd", "/abs", "C:\\x") and is rejected outright.
 */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > 1024) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects
  if (/[\u0000-\u001f\\:]/.test(path) || path.startsWith("/")) return false;
  return path.split("/").every((s) => s.length > 0 && s.length <= 255 && s !== "." && s !== "..");
}
