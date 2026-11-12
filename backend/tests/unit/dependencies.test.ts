import { afterAll, describe, expect, test } from "bun:test";
import {
  checkNpmManifests,
  packageNameOf,
} from "../../src/engine/analyzers/dependencies/npm-manifest";
import { extractImports } from "../../src/engine/languages/typescript/ts-imports";
import { ruleIds, tempTree, textFile } from "../helpers";

describe("packageNameOf", () => {
  test.each([
    ["react", "react"],
    ["lodash/fp", "lodash"],
    ["@scope/pkg", "@scope/pkg"],
    ["@scope/pkg/sub/path", "@scope/pkg"],
    ["./local", null],
    ["../up", null],
    ["/abs", null],
    ["node:fs", null],
    ["fs", null],
    ["path", null],
    ["bun:test", null],
    ["https://cdn.example/x.js", null],
    ["@/components/Button", null],
    ["~/utils", null],
    ["#internal", null],
  ] as const)("%p -> %p", (specifier, expected) => {
    expect(packageNameOf(specifier)).toBe(expected);
  });
});

describe("checkNpmManifests", () => {
  const trees: Array<{ cleanup: () => void }> = [];
  afterAll(() => {
    for (const t of trees) t.cleanup();
  });

  function check(files: Record<string, string>, onDisk: Record<string, string> = {}) {
    const tree = tempTree(onDisk);
    trees.push(tree);
    const sources = Object.entries(files).map(([p, c]) => textFile(p, c));
    const imports = new Map(
      sources
        .filter((f) => /\.[jt]sx?$/.test(f.path))
        .map((f) => [f.path, extractImports(f.path, f.content ?? "")]),
    );
    return checkNpmManifests(tree.dir, sources, imports);
  }

  test("undeclared imports are reported where they are imported", () => {
    const findings = check(
      {
        "package.json": JSON.stringify({
          name: "app",
          dependencies: { react: "18.0.0" },
          devDependencies: { vitest: "1" },
        }),
        "src/a.ts":
          'import React from "react";\nimport { z } from "zod";\nimport { test } from "vitest";\nimport fs from "node:fs";\n',
      },
      { "bun.lock": "" },
    );
    expect(findings.map((f) => [f.ruleId, f.file, f.startLine])).toEqual([
      ["dependencies/undeclared", "src/a.ts", 2],
    ]);
    expect(findings[0]?.message).toContain("`zod`");
  });

  test("type-only imports, self-imports and local folder aliases are not undeclared", () => {
    const findings = check(
      {
        "package.json": JSON.stringify({ name: "@me/app", dependencies: {} }),
        "src/a.ts":
          'import type { Z } from "zod";\nimport { x } from "@me/app/sub";\nimport { b } from "src/b";\n',
        "src/b.ts": "export const b = 1;\n",
      },
      { "package-lock.json": "{}" },
    );
    expect(findings).toEqual([]);
  });

  test("unused runtime dependencies; @types and script-only tools are exempt", () => {
    const findings = check(
      {
        "package.json": JSON.stringify({
          dependencies: { react: "1", "left-pad": "1", "@types/node": "1", prisma: "5" },
          scripts: { migrate: "prisma migrate deploy" },
        }),
        "src/a.tsx": 'import React from "react";\n',
      },
      { "pnpm-lock.yaml": "" },
    );
    expect(findings.map((f) => f.message)).toEqual([
      "Runtime dependency `left-pad` is never imported.",
    ]);
  });

  test("missing lockfile, only when there are dependencies", () => {
    expect(
      ruleIds(
        check({
          "package.json": JSON.stringify({ dependencies: { a: "1" } }),
          "x.ts": 'import "a";',
        }),
      ),
    ).toEqual(["dependencies/missing-lockfile"]);
    expect(check({ "package.json": JSON.stringify({ name: "empty" }) })).toEqual([]);
  });

  test("each file is checked against its nearest package.json in a monorepo", () => {
    const findings = check(
      {
        "package.json": JSON.stringify({ dependencies: { react: "1" } }),
        "src/root.ts": 'import "react";\n',
        "packages/api/package.json": JSON.stringify({ dependencies: { express: "4" } }),
        "packages/api/server.ts": 'import "express";\nimport "react";\n',
      },
      { "bun.lock": "", "packages/api/bun.lock": "" },
    );
    expect(findings.map((f) => [f.ruleId, f.file, f.startLine])).toEqual([
      ["dependencies/undeclared", "packages/api/server.ts", 2],
    ]);
  });

  test("invalid package.json is ignored rather than crashing", () => {
    expect(check({ "package.json": "{ not json", "a.ts": 'import "x";' })).toEqual([]);
  });
});
