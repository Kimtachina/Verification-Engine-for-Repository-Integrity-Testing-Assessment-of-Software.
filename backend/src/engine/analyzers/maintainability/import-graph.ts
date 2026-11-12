import { posix } from "node:path";
import type { PythonImport } from "../../languages/python/python-facts";
import type { ModuleImport } from "../../languages/typescript/ts-imports";

/** file → files it imports at load time (scan-relative paths). */
export type ImportGraph = Map<string, Set<string>>;

const JS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
/** TypeScript ESM code imports "./x.js" for a file that is really x.ts. */
const JS_TO_TS: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};

/**
 * Edges between project files from relative imports. Type-only imports are erased at
 * compile time and dynamic import() loads lazily, so neither can cause a load-time cycle.
 */
export function buildJsGraph(importsByFile: ReadonlyMap<string, ModuleImport[]>): ImportGraph {
  const files = new Set(importsByFile.keys());
  const graph: ImportGraph = new Map();
  for (const [file, imports] of importsByFile) {
    const edges = new Set<string>();
    for (const imp of imports) {
      if (imp.typeOnly || imp.dynamic || !imp.specifier.startsWith(".")) continue;
      const target = resolveJs(posix.dirname(file), imp.specifier, files);
      if (target && target !== file) edges.add(target);
    }
    graph.set(file, edges);
  }
  return graph;
}

export function resolveJs(
  fromDir: string,
  specifier: string,
  files: ReadonlySet<string>,
): string | null {
  const base = posix.normalize(posix.join(fromDir, specifier));
  const candidates = [
    base,
    ...JS_EXTENSIONS.map((e) => base + e),
    ...JS_EXTENSIONS.map((e) => `${base}/index${e}`),
  ];
  const ext = posix.extname(base);
  for (const ts of JS_TO_TS[ext] ?? []) candidates.push(base.slice(0, -ext.length) + ts);
  return candidates.find((c) => files.has(c)) ?? null;
}

/**
 * Edges between project Python modules. Module names are derived from paths relative
 * to the scan root, and to `src/` for the common src layout.
 */
export function buildPythonGraph(importsByFile: ReadonlyMap<string, PythonImport[]>): ImportGraph {
  const modules = new Map<string, string>();
  for (const file of importsByFile.keys()) {
    for (const name of moduleNames(file)) if (!modules.has(name)) modules.set(name, file);
  }

  const graph: ImportGraph = new Map();
  for (const [file, imports] of importsByFile) {
    const edges = new Set<string>();
    for (const imp of imports) {
      for (const target of resolvePython(file, imp, modules)) {
        if (target !== file) edges.add(target);
      }
    }
    graph.set(file, edges);
  }
  return graph;
}

function moduleNames(file: string): string[] {
  const noExt = file.replace(/\.pyi?$/, "").replace(/\/__init__$/, "");
  const dotted = noExt.split("/").join(".");
  return dotted.startsWith("src.") ? [dotted, dotted.slice(4)] : [dotted];
}

function resolvePython(
  file: string,
  imp: PythonImport,
  modules: ReadonlyMap<string, string>,
): string[] {
  let base = imp.module;
  if (imp.level > 0) {
    // The package a file belongs to: its folder, or the folder itself for __init__.py.
    const pkg = posix
      .dirname(file)
      .split("/")
      .filter((p) => p !== ".");
    const up = pkg.slice(0, Math.max(0, pkg.length - (imp.level - 1)));
    base = [...up, ...(imp.module ? imp.module.split(".") : [])].join(".");
  }
  const resolved: string[] = [];
  // `from pkg import mod` may name submodules; each one found is its own edge.
  for (const name of imp.names) {
    const sub = modules.get(base ? `${base}.${name}` : name);
    if (sub) resolved.push(sub);
  }
  if (resolved.length === 0 && base) {
    const target = modules.get(base) ?? modules.get(base.replace(/^src\./, ""));
    if (target) resolved.push(target);
  }
  return resolved;
}

/**
 * Strongly connected components with more than one file: each is a set of modules that
 * all (indirectly) import each other. Tarjan's algorithm, iterative so a long import
 * chain cannot overflow the call stack.
 */
export function findCycles(graph: ImportGraph): string[][] {
  const tarjan = new Tarjan(graph);
  for (const node of [...graph.keys()].sort()) tarjan.run(node);
  return tarjan.cycles.sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
}

interface Frame {
  node: string;
  edges: string[];
  next: number;
}

class Tarjan {
  readonly cycles: string[][] = [];
  private counter = 0;
  private readonly index = new Map<string, number>();
  private readonly lowlink = new Map<string, number>();
  private readonly stack: string[] = [];
  private readonly onStack = new Set<string>();
  private readonly work: Frame[] = [];

  constructor(private readonly graph: ImportGraph) {}

  /** Explores everything reachable from `start` that has not been visited yet. */
  run(start: string): void {
    if (this.index.has(start)) return;
    this.open(start);
    while (this.work.length > 0) {
      const frame = this.work[this.work.length - 1] as Frame;
      if (frame.next < frame.edges.length) this.follow(frame, frame.edges[frame.next++] as string);
      else this.close(frame);
    }
  }

  private open(node: string): void {
    this.index.set(node, this.counter);
    this.lowlink.set(node, this.counter);
    this.counter++;
    this.stack.push(node);
    this.onStack.add(node);
    this.work.push({ node, edges: [...(this.graph.get(node) ?? [])].sort(), next: 0 });
  }

  /** One edge: descend into an unvisited target, or note a back edge into the current path. */
  private follow(frame: Frame, target: string): void {
    if (!this.index.has(target)) this.open(target);
    else if (this.onStack.has(target)) this.lower(frame.node, this.index.get(target));
  }

  /** All edges done: report the node's component if it is a root, and update the parent. */
  private close(frame: Frame): void {
    this.work.pop();
    const parent = this.work[this.work.length - 1];
    if (parent) this.lower(parent.node, this.lowlink.get(frame.node));
    if (this.lowlink.get(frame.node) !== this.index.get(frame.node)) return;
    const component = this.popComponent(frame.node);
    if (component.length > 1) this.cycles.push(component.sort());
  }

  private popComponent(root: string): string[] {
    const component: string[] = [];
    for (let member = this.stack.pop(); member !== undefined; member = this.stack.pop()) {
      this.onStack.delete(member);
      component.push(member);
      if (member === root) break;
    }
    return component;
  }

  private lower(node: string, value: number | undefined): void {
    if (value !== undefined && value < (this.lowlink.get(node) ?? Number.POSITIVE_INFINITY)) {
      this.lowlink.set(node, value);
    }
  }
}
