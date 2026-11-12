import { existsSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import ts from "typescript";

export interface TsDiagnostic {
  /** Scan-relative path. */
  path: string;
  line: number;
  code: number;
  message: string;
  kind: "syntax" | "type";
}

export interface TsDiagnosticsResult {
  diagnostics: TsDiagnostic[];
  notes: string[];
}

/**
 * Errors caused only by VERITAS not installing the project's dependencies or global
 * type packages (@types/node, @types/jest, React's JSX types). Reporting them would
 * blame the code for the scanner's environment.
 */
export const ENVIRONMENT_ERROR_CODES = new Set([
  2307, // Cannot find module 'x'
  2792, // Cannot find module 'x'. Did you mean to set moduleResolution?
  7016, // Could not find a declaration file for module 'x'
  2688, // Cannot find type definition file for 'x'
  2503, // Cannot find namespace 'x' (React, JSX)
  2874, // This JSX tag requires 'React' to be in scope
  2875, // This JSX tag requires the module path 'react/jsx-runtime' to exist
  7026, // JSX element implicitly has type 'any'
  2580, // Cannot find name 'require'. Do you need to install type definitions for node?
  2591, // Same, with a tsconfig hint
  2582, // Cannot find name 'describe'. Do you need to install type definitions for a test runner?
  2593, // Same, with a tsconfig hint
  2867, // Cannot find name 'Bun'. Do you need to install type definitions for Bun?
  2868, // Same, with a tsconfig hint
]);

/** Above this, type checking is skipped to keep scans fast; syntax is still checked. */
export const MAX_TYPECHECK_FILES = 3000;

const BASE_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.Preserve,
  allowJs: false,
  esModuleInterop: true,
  resolveJsonModule: true,
};

/**
 * Settings forced on every run. Global @types are still loaded automatically, but only
 * from node_modules under the scan root, because the compiler host is sandboxed there.
 */
const FORCED_OPTIONS: ts.CompilerOptions = {
  noEmit: true,
  skipLibCheck: true,
  incremental: false,
  composite: false,
};

const TS_EXTENSIONS = /\.(?:[cm]?ts|tsx)$/i;

type ScanFile = { path: string; content: string };

/**
 * Syntax errors for every JS/TS file and type errors for TS files (as tsc does by default).
 *
 * Each TS file is checked with the nearest tsconfig.json between it and the scan root.
 * Files with no tsconfig are checked twice, strict and loose, and only errors found by
 * both are reported: without a config VERITAS cannot know which mode the author wrote
 * for, and an error in both modes is a real error in either.
 *
 * Type errors are only reported for files whose imports all resolve, directly and through
 * the local files they import. A type built on an uninstalled package is unknown, and
 * errors derived from it (a property "missing" from an interface extending it) would be
 * false. VERITAS never installs dependencies; projects that ship node_modules under the
 * scan root get full checking.
 */
export function collectTsDiagnostics(
  rootDir: string,
  files: readonly ScanFile[],
): TsDiagnosticsResult {
  const sandbox = createSandbox(resolve(rootDir), files);
  const notes: string[] = [];
  const diagnostics: TsDiagnostic[] = [];

  // Pass 1: syntax. Parsing does not depend on compiler options or other files.
  const syntaxProgram = sandbox.program(files, { ...BASE_OPTIONS, allowJs: true, noResolve: true });
  const unparsable = new Set<string>();
  for (const file of files) {
    const sf = syntaxProgram.getSourceFile(sandbox.abs(file.path));
    if (!sf) continue;
    const syntax = syntaxProgram.getSyntacticDiagnostics(sf);
    if (syntax.length > 0) unparsable.add(file.path);
    diagnostics.push(...syntax.map((d) => sandbox.toDiagnostic(d, "syntax")));
  }

  // Pass 2: types. A file that does not parse would only produce noise from the parse error.
  const tsFiles = files.filter((f) => TS_EXTENSIONS.test(f.path) && !unparsable.has(f.path));
  if (tsFiles.length > MAX_TYPECHECK_FILES) {
    notes.push(
      `Type checking skipped: ${tsFiles.length} TypeScript files (limit ${MAX_TYPECHECK_FILES})`,
    );
    return { diagnostics, notes };
  }
  const unchecked = new Set<string>();
  for (const [configPath, group] of groupByNearestConfig(sandbox.root, tsFiles)) {
    if (configPath) {
      const { options, note } = loadTsconfig(sandbox, configPath);
      if (note) notes.push(note);
      const result = sandbox.typeErrors(group, options);
      diagnostics.push(...result.errors);
      for (const path of result.unchecked) unchecked.add(path);
    } else {
      const strict = sandbox.typeErrors(group, { ...BASE_OPTIONS, strict: true });
      const loose = sandbox.typeErrors(group, { ...BASE_OPTIONS, strict: false });
      const key = (d: TsDiagnostic) => `${d.path}:${d.line}:${d.code}`;
      const inLoose = new Set(loose.errors.map(key));
      diagnostics.push(...strict.errors.filter((d) => inLoose.has(key(d))));
      for (const path of [...strict.unchecked, ...loose.unchecked]) unchecked.add(path);
    }
  }
  if (unchecked.size > 0) {
    notes.push(
      `${unchecked.size} of ${tsFiles.length} TypeScript file(s) not type checked: they depend on packages not installed under the scan root (syntax was still checked)`,
    );
  }
  return { diagnostics, notes };
}

interface Sandbox {
  root: string;
  abs(path: string): string;
  allowed(path: string): boolean;
  program(files: readonly ScanFile[], options: ts.CompilerOptions): ts.Program;
  /** Type errors in `files`, except files that depend on unresolvable packages (`unchecked`). */
  typeErrors(
    files: readonly ScanFile[],
    options: ts.CompilerOptions,
  ): { errors: TsDiagnostic[]; unchecked: string[] };
  toDiagnostic(d: ts.Diagnostic, kind: TsDiagnostic["kind"]): TsDiagnostic;
}

/**
 * A compiler host that sees the scanned files (from memory), anything on disk under the
 * scan root (e.g. declarations in the project's own node_modules) and TypeScript's lib
 * files. Nothing else: imports must not resolve against packages that happen to sit
 * above the scan root, such as VERITAS's own dependencies.
 */
function createSandbox(root: string, files: readonly ScanFile[]): Sandbox {
  const libDir = dirname(ts.getDefaultLibFilePath({}));
  const contents = new Map(files.map((f) => [join(root, f.path), f.content]));
  const allowed = (path: string) => {
    const abs = resolve(path);
    return isInside(abs, root) || isInside(abs, libDir);
  };
  const toRelative = (abs: string) => relative(root, abs).split(sep).join("/");

  const createHost = (opts: ts.CompilerOptions) => {
    const host = ts.createCompilerHost(opts, true);
    const read = host.readFile.bind(host);
    host.readFile = (p) => contents.get(resolve(p)) ?? (allowed(p) ? read(p) : undefined);
    host.fileExists = (p) => contents.has(resolve(p)) || (allowed(p) && ts.sys.fileExists(p));
    host.directoryExists = (p) => allowed(p) && (ts.sys.directoryExists?.(p) ?? false);
    host.getDirectories = (p) => (allowed(p) ? (ts.sys.getDirectories?.(p) ?? []) : []);
    host.realpath = (p) => p;
    host.getCurrentDirectory = () => root;
    host.writeFile = () => {};
    return host;
  };

  const program = (group: readonly ScanFile[], options: ts.CompilerOptions) => {
    const opts = { ...options, ...FORCED_OPTIONS };
    return ts.createProgram({
      rootNames: group.map((f) => join(root, f.path)),
      options: opts,
      host: createHost(opts),
    });
  };

  /**
   * Absolute paths of scanned files that import, directly or through other scanned files,
   * a module that does not resolve inside the sandbox.
   */
  const dependsOnMissing = (options: ts.CompilerOptions): Set<string> => {
    const opts = { ...options, ...FORCED_OPTIONS };
    const host = createHost(opts);
    const cache = ts.createModuleResolutionCache(root, (f) => f, opts);
    const importers = new Map<string, string[]>();
    const tainted = new Set<string>();
    for (const [abs, content] of contents) {
      for (const { fileName } of ts.preProcessFile(content, true, true).importedFiles) {
        const target = ts.resolveModuleName(fileName, abs, opts, host, cache).resolvedModule;
        if (!target) tainted.add(abs);
        else if (contents.has(resolve(target.resolvedFileName))) {
          const to = resolve(target.resolvedFileName);
          importers.set(to, [...(importers.get(to) ?? []), abs]);
        }
      }
    }
    // Spread the taint from each file to everything that imports it.
    const queue = [...tainted];
    for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
      for (const importer of importers.get(file) ?? []) {
        if (!tainted.has(importer)) {
          tainted.add(importer);
          queue.push(importer);
        }
      }
    }
    return tainted;
  };

  const toDiagnostic = (d: ts.Diagnostic, kind: TsDiagnostic["kind"]): TsDiagnostic => ({
    path: d.file ? toRelative(resolve(d.file.fileName)) : ".",
    line:
      d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 1,
    code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    kind,
  });

  const typeErrors = (group: readonly ScanFile[], options: ts.CompilerOptions) => {
    const p = program(group, options);
    const tainted = dependsOnMissing(options);
    const out: TsDiagnostic[] = [];
    const unchecked: string[] = [];
    for (const file of group) {
      if (tainted.has(join(root, file.path))) {
        unchecked.push(file.path);
        continue;
      }
      const sf = p.getSourceFile(join(root, file.path));
      if (!sf) continue;
      for (const d of p.getSemanticDiagnostics(sf)) {
        if (d.category === ts.DiagnosticCategory.Error && !isEnvironmentError(d)) {
          out.push(toDiagnostic(d, "type"));
        }
      }
    }
    return { errors: out, unchecked };
  };

  return { root, abs: (path) => join(root, path), allowed, program, typeErrors, toDiagnostic };
}

function isEnvironmentError(d: ts.Diagnostic): boolean {
  if (ENVIRONMENT_ERROR_CODES.has(d.code)) return true;
  // import.meta.env / .dir / .main / .hot come from runtime type packages (Vite, Bun, Node)
  // that VERITAS does not install, so a "missing" property there says nothing about the code.
  return (
    d.code === 2339 &&
    ts.flattenDiagnosticMessageText(d.messageText, "\n").includes("type 'ImportMeta'")
  );
}

/** Files grouped by the nearest tsconfig.json at or above them, up to the scan root. */
function groupByNearestConfig(
  root: string,
  files: readonly ScanFile[],
): Map<string | null, ScanFile[]> {
  const configForDir = new Map<string, string | null>();
  const nearest = (dir: string): string | null => {
    const cached = configForDir.get(dir);
    if (cached !== undefined) return cached;
    const candidate = join(root, dir, "tsconfig.json");
    const found = existsSync(candidate) ? candidate : dir === "" ? null : nearest(parentDir(dir));
    configForDir.set(dir, found);
    return found;
  };
  const groups = new Map<string | null, ScanFile[]>();
  for (const file of files) {
    const config = nearest(parentDir(file.path));
    groups.set(config, [...(groups.get(config) ?? []), file]);
  }
  return groups;
}

function parentDir(path: string): string {
  const dir = posix.dirname(path);
  return dir === "." ? "" : dir;
}

/** Compiler options from a tsconfig.json, read through the sandbox. */
function loadTsconfig(
  sandbox: Sandbox,
  configPath: string,
): { options: ts.CompilerOptions; note?: string } {
  const label = relative(sandbox.root, configPath).split(sep).join("/");
  const host: ts.ParseConfigHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readDirectory: (p, ...rest) => (sandbox.allowed(p) ? ts.sys.readDirectory(p, ...rest) : []),
    fileExists: (p) => sandbox.allowed(p) && ts.sys.fileExists(p),
    readFile: (p) => (sandbox.allowed(p) ? ts.sys.readFile(p) : undefined),
  };
  const raw = ts.readConfigFile(configPath, host.readFile);
  if (raw.error) {
    return {
      options: { ...BASE_OPTIONS, strict: false },
      note: `${label} could not be read; its files were type checked with lenient defaults`,
    };
  }
  const parsed = ts.parseJsonConfigFileContent(raw.config, host, dirname(configPath));
  const options = { ...BASE_OPTIONS, ...parsed.options };
  // An `extends` pointing at an uninstalled package is expected; keep what did parse.
  const failed = parsed.errors.some((e) => e.category === ts.DiagnosticCategory.Error);
  return failed
    ? {
        options,
        note: `Parts of ${label} could not be resolved (e.g. \`extends\` from an uninstalled package); remaining settings were used`,
      }
    : { options };
}

function isInside(path: string, dir: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel));
}
