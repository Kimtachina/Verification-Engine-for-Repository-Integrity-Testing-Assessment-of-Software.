import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { collectTsDiagnostics } from "../../src/engine/languages/typescript/ts-diagnostics";
import { tempTree } from "../helpers";

const trees: Array<{ cleanup: () => void }> = [];
afterAll(() => {
  for (const t of trees) t.cleanup();
});

function diagnose(files: Record<string, string>, onDisk: Record<string, string> = {}, root = "") {
  const tree = tempTree(onDisk);
  trees.push(tree);
  const list = Object.entries(files).map(([path, content]) => ({ path, content }));
  return collectTsDiagnostics(join(tree.dir, root), list);
}

const summary = (r: ReturnType<typeof diagnose>) =>
  r.diagnostics.map((d) => `${d.kind} ${d.path}:${d.line} ${d.code}`);

describe("collectTsDiagnostics", () => {
  test("syntax errors in TS and JS; type errors in TS only", () => {
    const result = diagnose({
      "a.ts": "const n: number = 'x';\n",
      "b.js": "const n = 1;\nn.foo.bar = (;\n",
      "c.js": "/** @type {number} */\nconst n = 'not checked without checkJs';\n",
    });
    expect(summary(result)).toEqual(["syntax b.js:2 1109", "type a.ts:1 2322"]);
  });

  test("a file with a syntax error gets no type errors piled on top", () => {
    const result = diagnose({ "a.ts": "const n: number = 'x';\nfunction (\n" });
    expect(result.diagnostics.every((d) => d.kind === "syntax")).toBe(true);
  });

  test("errors caused only by uninstalled packages or @types are not reported", () => {
    const result = diagnose({
      "a.ts": [
        'import { thing } from "not-installed";',
        "const t: string = thing;",
        "process.env.X;",
        "describe('x', () => {});",
      ].join("\n"),
      "b.tsx": "export const el = <div />;\n",
    });
    expect(result.diagnostics).toEqual([]);
  });

  test("files depending on an uninstalled package, directly or via local imports, are not type checked", () => {
    // Found by VERITAS scanning itself: an interface extending a type from a missing package
    // has no members, so every use of it looked like an error.
    const result = diagnose({
      "base.ts":
        'import type { Config } from "not-installed";\nexport interface Resolved extends Config { root: string }\n',
      "use.ts":
        'import type { Resolved } from "./base";\ndeclare const r: Resolved;\nexport const n: number = r.thresholds;\n',
      "clean.ts": "export const s: string = 1;\n",
    });
    expect(summary(result)).toEqual(["type clean.ts:1 2322"]);
    expect(result.notes.join(" ")).toContain("2 of 3 TypeScript file(s) not type checked");
  });

  test("without a tsconfig, only errors that hold in both strict and loose mode are reported", () => {
    const result = diagnose({
      // Valid only in strict mode: narrowing on a boolean discriminant needs strictNullChecks.
      "strict-style.ts": [
        "type R = { ok: true; value: number } | { ok: false; reason: string };",
        "export function f(r: R) { if (r.ok) return r.value; return r.reason; }",
      ].join("\n"),
      // Valid only in loose mode: implicit any.
      "loose-style.ts": "export function g(x) { return x; }\n",
      // Wrong in both.
      "wrong.ts": "export const n: number = 'x';\n",
    });
    expect(summary(result)).toEqual(["type wrong.ts:1 2322"]);
  });

  test("relative imports resolve inside the scan, so cross-file type errors are caught", () => {
    const result = diagnose({
      "lib.ts": "export const count: number = 1;\n",
      "main.ts": 'import { count } from "./lib";\nconst s: string = count;\n',
    });
    expect(summary(result)).toEqual(["type main.ts:2 2322"]);
  });

  test("sandbox: packages installed ABOVE the scan root are never used for resolution", () => {
    // If resolution escaped the root, `n` would be typed number and assigning it to a
    // string would be an error. Inside the sandbox the package is unresolved, so no error.
    const result = diagnose(
      { "main.ts": 'import { n } from "fakepkg";\nconst s: string = n;\nexport { s };\n' },
      {
        "node_modules/fakepkg/package.json": '{ "name": "fakepkg", "types": "index.d.ts" }',
        "node_modules/fakepkg/index.d.ts": "export declare const n: number;\n",
        "code/.keep": "",
      },
      "code",
    );
    expect(result.diagnostics).toEqual([]);
  });

  test("packages the project itself ships in its own node_modules are used", () => {
    const result = diagnose(
      { "main.ts": 'import { n } from "fakepkg";\nconst s: string = n;\nexport { s };\n' },
      {
        "node_modules/fakepkg/package.json": '{ "name": "fakepkg", "types": "index.d.ts" }',
        "node_modules/fakepkg/index.d.ts": "export declare const n: number;\n",
      },
    );
    expect(summary(result)).toEqual(["type main.ts:2 2322"]);
  });

  test("the project's tsconfig.json is respected (strict finds implicit any)", () => {
    const code = { "a.ts": "export function f(x) { return x; }\n" };
    expect(diagnose(code).diagnostics).toEqual([]);
    const strict = diagnose(code, { "tsconfig.json": '{ "compilerOptions": { "strict": true } }' });
    expect(summary(strict)).toEqual(["type a.ts:1 7006"]);
  });

  test("an unresolvable `extends` still type checks, with a note", () => {
    const result = diagnose(
      { "a.ts": "const n: number = 'x';\n" },
      { "tsconfig.json": '{ "extends": "@tsconfig/missing/tsconfig.json" }' },
    );
    expect(summary(result)).toEqual(["type a.ts:1 2322"]);
    expect(result.notes.join(" ")).toContain("extends");
  });
});
