import { existsSync } from "node:fs";
import { join } from "node:path";
import { findExecutable } from "./run-process";

export type ToolName =
  | "biome"
  | "ruff"
  | "pyright"
  | "jscpd"
  | "semgrep"
  | "gitleaks"
  | "osv-scanner";

/** How to install each tool, shown when a dimension is skipped because it is missing. */
export const INSTALL_HINT: Record<ToolName, string> = {
  biome: "bun install (bundled with VERITAS)",
  pyright: "bun install (bundled with VERITAS)",
  jscpd: "bun install (bundled with VERITAS)",
  ruff: "brew install ruff",
  semgrep: "brew install semgrep",
  gitleaks: "brew install gitleaks",
  "osv-scanner": "brew install osv-scanner",
};

/** Tools VERITAS pins as npm dependencies, so every install uses the same version. */
const BUNDLED_BIN_DIRS = [
  join(import.meta.dir, "../../../node_modules/.bin"),
  join(import.meta.dir, "../../../../node_modules/.bin"),
];

/** The bundled copy if there is one, otherwise the tool on PATH, otherwise null. */
export function findTool(name: ToolName): string | null {
  for (const dir of BUNDLED_BIN_DIRS) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return findExecutable(name);
}

export function missingToolReason(name: ToolName): string {
  return `${name} is not installed (${INSTALL_HINT[name]})`;
}
