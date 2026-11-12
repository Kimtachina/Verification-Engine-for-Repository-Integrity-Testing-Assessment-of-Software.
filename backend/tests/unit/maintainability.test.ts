import { describe, expect, test } from "bun:test";
import {
  buildJsGraph,
  buildPythonGraph,
  findCycles,
  type ImportGraph,
  resolveJs,
} from "../../src/engine/analyzers/maintainability/import-graph";
import { maintainabilityAnalyzer } from "../../src/engine/analyzers/maintainability/maintainability.analyzer";
import type { PythonImport } from "../../src/engine/languages/python/python-facts";
import { findPython } from "../../src/engine/languages/python/python-facts";
import { measureTsDocs } from "../../src/engine/languages/typescript/ts-docs";
import { extractImports } from "../../src/engine/languages/typescript/ts-imports";
import { contextFor, ruleIds, textFile } from "../helpers";

const graph = (edges: Record<string, string[]>): ImportGraph =>
  new Map(Object.entries(edges).map(([k, v]) => [k, new Set(v)]));

describe("findCycles", () => {
  test("finds each strongly connected group once, sorted", () => {
    const cycles = findCycles(
      graph({ a: ["b"], b: ["c"], c: ["a"], d: ["e"], e: ["d"], f: ["a"], g: [] }),
    );
    expect(cycles).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
  });

  test("an acyclic graph has no cycles", () => {
    expect(findCycles(graph({ a: ["b"], b: ["c"], c: [] }))).toEqual([]);
  });

  test("handles a 5,000-module chain without overflowing the stack", () => {
    const edges: Record<string, string[]> = {};
    for (let i = 0; i < 5000; i++) edges[`m${i}`] = [`m${(i + 1) % 5000}`];
    expect(findCycles(graph(edges))[0]).toHaveLength(5000);
  });
});

describe("resolveJs", () => {
  const files = new Set(["src/a.ts", "src/util/index.ts", "src/c.tsx", "src/d.js"]);
  test.each([
    ["src", "./a", "src/a.ts"],
    ["src", "./a.js", "src/a.ts"],
    ["src", "./util", "src/util/index.ts"],
    ["src/util", "../c", "src/c.tsx"],
    ["src", "./d.js", "src/d.js"],
    ["src", "./missing", null],
  ])("from %p import %p -> %p", (dir, spec, expected) => {
    expect(resolveJs(dir, spec, files)).toBe(expected);
  });
});

describe("buildJsGraph", () => {
  test("type-only and dynamic imports cannot form load-time cycles", () => {
    const imports = new Map([
      [
        "a.ts",
        extractImports("a.ts", 'import type { B } from "./b";\nconst lazy = () => import("./c");'),
      ],
      ["b.ts", extractImports("b.ts", 'import { a } from "./a";')],
      ["c.ts", extractImports("c.ts", 'import { a } from "./a";')],
    ]);
    expect(findCycles(buildJsGraph(imports))).toEqual([]);
  });

  test("require() and re-exports do form edges", () => {
    const imports = new Map([
      ["a.js", extractImports("a.js", 'const b = require("./b");')],
      ["b.js", extractImports("b.js", 'export * from "./a";')],
    ]);
    expect(findCycles(buildJsGraph(imports))).toEqual([["a.js", "b.js"]]);
  });
});

describe("buildPythonGraph", () => {
  const imp = (module: string, level = 0, names: string[] = []): PythonImport => ({
    module,
    level,
    names,
    line: 1,
  });

  test("absolute, relative and src-layout imports resolve to project files", () => {
    const imports = new Map<string, PythonImport[]>([
      ["src/shop/cart.py", [imp("shop.pricing")]],
      ["src/shop/pricing.py", [imp("", 1, ["cart"])]],
      ["src/shop/__init__.py", []],
      ["app/main.py", [imp("os"), imp("requests")]],
    ]);
    expect(findCycles(buildPythonGraph(imports))).toEqual([
      ["src/shop/cart.py", "src/shop/pricing.py"],
    ]);
  });

  test("parent-relative import (from ..core import db)", () => {
    const imports = new Map<string, PythonImport[]>([
      ["pkg/api/views.py", [imp("core", 2, ["db"])]],
      ["pkg/core/db.py", [imp("pkg.api.views")]],
    ]);
    expect(findCycles(buildPythonGraph(imports))).toEqual([["pkg/api/views.py", "pkg/core/db.py"]]);
  });
});

describe("measureTsDocs", () => {
  test("counts exported API and JSDoc blocks only", () => {
    const docs = measureTsDocs(
      "a.ts",
      [
        "/** Adds. */",
        "export function add() {}",
        "// a line comment is not documentation",
        "export function sub() {}",
        "export class Cart {}",
        "/** Shape. */",
        "export interface Shape {}",
        "export const handler = () => {};",
        "export const LIMIT = 5;",
        "function internal() {}",
      ].join("\n"),
    );
    expect(docs).toEqual({ total: 5, documented: 2 });
  });
});

describe("maintainability analyzer", () => {
  async function run(files: ReturnType<typeof textFile>[], config: Record<string, unknown> = {}) {
    const result = await maintainabilityAnalyzer.run(contextFor(files, { config }));
    if (result.status !== "completed") throw new Error(JSON.stringify(result));
    return result.findings;
  }
  const readme = textFile("README.md", "# x");

  test("FIXME/HACK/XXX are low, TODO is info, in any comment style", async () => {
    const findings = await run([
      readme,
      textFile("a.ts", "// TODO: later\n/* FIXME broken on empty input */\nconst x = 1; // HACK\n"),
      textFile(
        "b.py",
        "# XXX: race condition\nx = 'TODO in a string is still flagged only after a comment marker'\n",
      ),
    ]);
    expect(findings.map((f) => [f.ruleId, f.severity, f.file, f.startLine, f.message])).toEqual([
      ["maintainability/todo", "info", "a.ts", 1, "TODO: later"],
      ["maintainability/fixme", "low", "a.ts", 2, "FIXME: broken on empty input"],
      ["maintainability/hack", "low", "a.ts", 3, "HACK comment without a description."],
      ["maintainability/xxx", "low", "b.py", 1, "XXX: race condition"],
    ]);
  });

  test("missing README", async () => {
    expect(ruleIds(await run([textFile("a.ts", "export {};")]))).toEqual([
      "maintainability/missing-readme",
    ]);
    expect(await run([readme, textFile("a.ts", "export {};")])).toEqual([]);
  });

  test("doc coverage below target, with a 5-definition minimum", async () => {
    const undocumented = Array.from({ length: 6 }, (_, i) => `export function f${i}() {}`).join(
      "\n",
    );
    const findings = await run([readme, textFile("a.ts", undocumented)]);
    expect(findings[0]).toMatchObject({
      ruleId: "maintainability/doc-coverage",
      severity: "medium",
      file: ".",
    });
    expect(findings[0]?.message).toContain("0 of 6");
    expect(await run([readme, textFile("a.ts", "export function f() {}")])).toEqual([]);
    expect(
      await run([readme, textFile("a.ts", undocumented)], { thresholds: { minDocCoverage: 0 } }),
    ).toEqual([]);
  });

  test.skipIf(!findPython())(
    "Python docstrings and import cycles go through the shared Python facts",
    async () => {
      const findings = await run([
        readme,
        textFile("pkg/__init__.py", ""),
        textFile(
          "pkg/a.py",
          "from . import b\ndef one():\n    pass\ndef two():\n    pass\ndef three():\n    pass\n",
        ),
        textFile(
          "pkg/b.py",
          'from pkg import a\ndef four():\n    """Doc."""\ndef five():\n    pass\n',
        ),
      ]);
      expect(findings.map((f) => f.ruleId).sort()).toEqual([
        "maintainability/circular-import",
        "maintainability/doc-coverage",
      ]);
      expect(findings.find((f) => f.ruleId === "maintainability/doc-coverage")?.message).toContain(
        "1 of 5",
      );
    },
  );

  test("skips when there is no program source", async () => {
    const result = await maintainabilityAnalyzer.run(contextFor([readme]));
    expect(result.status).toBe("skipped");
  });
});
