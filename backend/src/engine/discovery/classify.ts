import type { Language } from "@veritas/shared";
import type { SourceFile } from "./source-file";

/** Languages grouped by ecosystem: a TS project's tests may be JS and vice versa. */
export type LanguageFamily = "js" | "python";

export function familyOf(language: Language): LanguageFamily | null {
  if (language === "typescript" || language === "javascript") return "js";
  if (language === "python") return "python";
  return null;
}

const TEST_DIRS = new Set(["test", "tests", "__tests__", "spec", "specs", "e2e"]);

export function isTestFile(path: string): boolean {
  const segments = path.split("/");
  const name = segments.at(-1) ?? "";
  if (segments.slice(0, -1).some((s) => TEST_DIRS.has(s))) return true;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) return true;
  if (/^test_.+\.py$/.test(name) || /.+_test\.py$/.test(name)) return true;
  return name === "conftest.py";
}

/** Tooling config, type declarations and similar: real files, but not the program itself. */
function isNonProgramFile(path: string): boolean {
  const name = path.split("/").at(-1) ?? "";
  return (
    /\.d\.[cm]?ts$/.test(name) ||
    /\.config\.[cm]?[jt]s$/.test(name) ||
    /^\..+rc\.[cm]?[jt]s$/.test(name) ||
    name === "setup.py" ||
    name === "manage.py"
  );
}

/** A file written in a supported language that is part of the program, not its tests or tooling. */
export function isProgramSource(file: SourceFile): boolean {
  return (
    file.content !== null &&
    familyOf(file.language) !== null &&
    !isTestFile(file.path) &&
    !isNonProgramFile(file.path)
  );
}

/**
 * The module name a test targets, used to pair tests with sources:
 * `user.service.test.ts` -> `user.service`, `test_parser.py` -> `parser`.
 */
export function testedModuleName(testPath: string): string {
  const name = testPath.split("/").at(-1) ?? "";
  const patterns: ReadonlyArray<readonly [RegExp, string]> = [
    [/\.(?:test|spec)\.[cm]?[jt]sx?$/, ""],
    [/^test_(.+)\.py$/, "$1"],
    [/^(.+)_test\.py$/, "$1"],
  ];
  for (const [pattern, replacement] of patterns) {
    if (pattern.test(name)) return name.replace(pattern, replacement);
  }
  // A file inside a tests/ folder without a test suffix, e.g. tests/cart.ts.
  return moduleName(name);
}

export function moduleName(path: string): string {
  return (path.split("/").at(-1) ?? "").replace(/\.[^.]+$/, "");
}
