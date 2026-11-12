import { existsSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, posix } from "node:path";
import { z } from "zod";
import type { SourceFile } from "../../discovery/source-file";
import type { ModuleImport } from "../../languages/typescript/ts-imports";
import type { RawFinding } from "../analyzer";

const SOURCE = "veritas";
const LOCKFILES = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
];
const BUILTINS = new Set(builtinModules);

const manifestSchema = z
  .object({
    name: z.string().optional(),
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
    peerDependencies: z.record(z.string(), z.string()).optional(),
    optionalDependencies: z.record(z.string(), z.string()).optional(),
    scripts: z.record(z.string(), z.string()).optional(),
  })
  .loose();

interface Manifest {
  /** Scan-relative path of package.json. */
  path: string;
  /** Directory of the package, "" for the scan root. */
  dir: string;
  name: string | undefined;
  runtime: Set<string>;
  declared: Set<string>;
  scripts: string;
}

/**
 * Package name of a bare import: "@scope/pkg/sub" → "@scope/pkg", "lodash/fp" → "lodash".
 * Null for relative paths, Node/Bun built-ins, URLs, and path aliases ("@/x", "~/x", "#x").
 */
export function packageNameOf(specifier: string): string | null {
  if (/^(?:\.|\/|[a-z]+:)/i.test(specifier)) return null; // ./x, /x, node:fs, bun:test, https:
  if (/^(?:@\/|~\/|#|\$)/.test(specifier)) return null;
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? "");
  if (!name || BUILTINS.has(name)) return null;
  return name;
}

/**
 * Checks each package.json against the imports of the files it owns:
 * - an imported package that is not declared breaks on a clean install (medium);
 * - a runtime dependency nothing imports bloats installs and attack surface (low);
 * - no lockfile means installs are not reproducible (low).
 */
export function checkNpmManifests(
  rootDir: string,
  files: readonly SourceFile[],
  importsByFile: ReadonlyMap<string, ModuleImport[]>,
): RawFinding[] {
  const manifests = files
    .filter((f) => posix.basename(f.path) === "package.json" && f.content !== null)
    .map((f) => parseManifest(f))
    .filter((m): m is Manifest => m !== null)
    // Deepest first, so each file is owned by its nearest package.json.
    .sort((a, b) => b.dir.length - a.dir.length);
  if (manifests.length === 0) return [];

  const owner = (path: string) =>
    manifests.find((m) => m.dir === "" || path.startsWith(`${m.dir}/`));
  const used = new Map(manifests.map((m) => [m.path, new Set<string>()]));
  const localTopDirs = new Set(files.map((f) => f.path.split("/")[0] ?? ""));
  const findings: RawFinding[] = [];

  for (const [file, imports] of importsByFile) {
    const manifest = owner(file);
    if (!manifest) continue;
    for (const imp of imports) {
      const name = packageNameOf(imp.specifier);
      if (!name || name === manifest.name) continue;
      used.get(manifest.path)?.add(name);
      // `import type` compiles away. "components/Button" with a baseUrl alias is a local folder.
      if (manifest.declared.has(name) || localTopDirs.has(name) || imp.typeOnly) continue;
      findings.push({
        severity: "medium",
        ruleId: "dependencies/undeclared",
        message: `\`${name}\` is imported but not declared in ${manifest.path}; a clean install will not include it.`,
        suggestion: `Add it with your package manager, e.g. \`npm install ${name}\`.`,
        file,
        startLine: imp.line,
        source: SOURCE,
      });
    }
  }

  for (const manifest of manifests) {
    const imported = used.get(manifest.path) ?? new Set();
    for (const dep of manifest.runtime) {
      if (imported.has(dep) || dep.startsWith("@types/") || manifest.scripts.includes(dep))
        continue;
      findings.push({
        severity: "low",
        ruleId: "dependencies/unused",
        message: `Runtime dependency \`${dep}\` is never imported.`,
        suggestion:
          "Remove it if it is really unused; if it is used only by tooling, move it to devDependencies.",
        file: manifest.path,
        source: SOURCE,
      });
    }
    const hasDeps = manifest.declared.size > 0;
    const lockDir = join(rootDir, manifest.dir);
    if (hasDeps && !LOCKFILES.some((l) => existsSync(join(lockDir, l)))) {
      findings.push({
        severity: "low",
        ruleId: "dependencies/missing-lockfile",
        message:
          "No lockfile next to package.json, so every install may resolve different versions.",
        suggestion:
          "Commit the lockfile your package manager creates (package-lock.json, pnpm-lock.yaml, yarn.lock or bun.lock). Known-vulnerability checks for npm packages also need it: without exact versions they cannot run.",
        file: manifest.path,
        source: SOURCE,
      });
    }
  }
  return findings;
}

function parseManifest(file: SourceFile): Manifest | null {
  let json: unknown;
  try {
    json = JSON.parse(file.content ?? "");
  } catch {
    return null; // Invalid JSON is a correctness problem, not a dependency one.
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) return null;
  const m = parsed.data;
  const keys = (r: Record<string, string> | undefined) => Object.keys(r ?? {});
  return {
    path: file.path,
    dir: posix.dirname(file.path) === "." ? "" : posix.dirname(file.path),
    name: m.name,
    runtime: new Set(keys(m.dependencies)),
    declared: new Set([
      ...keys(m.dependencies),
      ...keys(m.devDependencies),
      ...keys(m.peerDependencies),
      ...keys(m.optionalDependencies),
    ]),
    scripts: Object.values(m.scripts ?? {}).join("\n"),
  };
}
