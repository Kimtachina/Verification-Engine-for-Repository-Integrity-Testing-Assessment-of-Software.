import { describe, expect, test } from "bun:test";
import { measureTsFile } from "../../src/engine/languages/typescript/ts-metrics";

function only(content: string, path = "a.ts") {
  const { functions, parseError } = measureTsFile(path, content);
  expect(parseError).toBeUndefined();
  expect(functions).toHaveLength(1);
  return functions[0]!;
}

describe("measureTsFile", () => {
  // Reference examples from the Cognitive Complexity white paper (G. Ann Campbell).
  test("sumOfPrimes: nested loops, labelled continue", () => {
    const fn = only(`
function sumOfPrimes(max: number) {
  let total = 0;
  OUT: for (let i = 1; i <= max; ++i) {
    for (let j = 2; j < i; ++j) {
      if (i % j === 0) {
        continue OUT;
      }
    }
    total += i;
  }
  return total;
}`);
    expect(fn).toMatchObject({ name: "sumOfPrimes", cyclomatic: 4, cognitive: 7, maxNesting: 3 });
  });

  test("getWords: a switch costs 1 cognitive however many cases", () => {
    const fn = only(`
function getWords(n: number) {
  switch (n) {
    case 1: return "one";
    case 2: return "a couple";
    case 3: return "a few";
    default: return "lots";
  }
}`);
    expect(fn).toMatchObject({ cyclomatic: 4, cognitive: 1, maxNesting: 1 });
  });

  test("logical operators: one per run of identical operators", () => {
    const fn = only(`function f(a, b, c, d) { if (a && b && c || d) return 1; return 0; }`, "a.js");
    // cognitive: if 1 + runs [&&, ||] 2; cyclomatic: 1 + if + 3 operators
    expect(fn).toMatchObject({ cognitive: 3, cyclomatic: 5 });
  });

  test("parentheses do not hide a logical sequence", () => {
    const fn = only(`function f(a, b, c) { return a && (b || c); }`);
    expect(fn.cognitive).toBe(2);
  });

  test("else-if chain: no nesting penalty, same depth", () => {
    const fn = only(`
function grade(s: number) {
  if (s > 90) { return "A"; }
  else if (s > 80) { return "B"; }
  else { return "C"; }
}`);
    expect(fn).toMatchObject({ cognitive: 3, cyclomatic: 3, maxNesting: 1 });
  });

  test("nesting penalty grows with depth", () => {
    const fn = only(`
function f(xs: number[][]) {
  while (xs.length) {
    for (const row of xs) {
      if (row.length) {
        try { row.pop(); } catch { break; }
      }
    }
  }
}`);
    // while 1, for 1+1, if 1+2, catch 1+3 (try adds nesting depth but no increment)
    expect(fn.cognitive).toBe(10);
    expect(fn.maxNesting).toBe(4);
  });

  test("ternary and nullish assignment count as decisions", () => {
    const fn = only(`function f(a?: number) { a ??= 1; return a > 0 ? "pos" : "neg"; }`);
    expect(fn.cyclomatic).toBe(3);
    expect(fn.cognitive).toBe(1);
  });

  test("nested functions are measured separately, not folded into the parent", () => {
    const { functions } = measureTsFile(
      "a.ts",
      `
function outer(items: number[]) {
  const check = (x: number) => {
    if (x > 1) { if (x > 2) { return true; } }
    return false;
  };
  return items.filter(check);
}`,
    );
    const byName = Object.fromEntries(functions.map((f) => [f.name, f]));
    expect(byName.outer).toMatchObject({ cyclomatic: 1, cognitive: 0, maxNesting: 0 });
    expect(byName.check).toMatchObject({ cyclomatic: 3, cognitive: 3, maxNesting: 2 });
  });

  test("an arrow passed as a logical operand is not counted in the parent", () => {
    const { functions } = measureTsFile(
      "a.ts",
      `function f(a) { return a && (() => { if (a) {} }); }`,
    );
    expect(functions.find((f) => f.name === "f")).toMatchObject({ cognitive: 1, maxNesting: 0 });
  });

  test("names: class methods, constructors, object properties, anonymous", () => {
    const { functions } = measureTsFile(
      "a.ts",
      `
class Cart {
  constructor() {}
  total() { return 0; }
  get size() { return 0; }
}
const handlers = { onClick: function () {} };
[1].map(() => 1);
export default () => {};`,
    );
    expect(functions.map((f) => f.name)).toEqual([
      "Cart.constructor",
      "Cart.total",
      "Cart.size",
      "onClick",
      "<anonymous>",
      "default",
    ]);
  });

  test("reports line span", () => {
    const fn = only(`\n\nfunction f() {\n  return 1;\n}\n`);
    expect(fn).toMatchObject({ startLine: 3, endLine: 5 });
  });

  test("TSX parses", () => {
    const fn = only(
      `export function App({ on }: { on: boolean }) { return on ? <b>on</b> : <i>off</i>; }`,
      "App.tsx",
    );
    expect(fn.cyclomatic).toBe(2);
  });

  test("syntax errors are reported, not thrown", () => {
    const result = measureTsFile("a.ts", "function (");
    expect(result.parseError).toBeString();
  });

  test("declarations without a body are ignored", () => {
    const { functions } = measureTsFile(
      "a.ts",
      "declare function f(): void; interface I { m(): void }",
    );
    expect(functions).toEqual([]);
  });
});
