import { describe, expect, test } from "bun:test";
import { collectPythonFacts, findPython } from "../../src/engine/languages/python/python-facts";

const python = findPython();
const signal = new AbortController().signal;

async function measure(content: string) {
  const [result] = await collectPythonFacts(python!, [{ path: "m.py", content }], signal);
  return result!;
}

async function only(content: string) {
  const { functions, parseError } = await measure(content);
  expect(parseError).toBeUndefined();
  expect(functions).toHaveLength(1);
  return functions[0]!;
}

// Same reference cases as ts-metrics.test.ts, so both languages score alike.
describe.skipIf(!python)("collectPythonFacts", () => {
  test("sum_of_primes: nested loops", async () => {
    const fn = await only(`
def sum_of_primes(limit):
    total = 0
    for i in range(1, limit + 1):
        for j in range(2, i):
            if i % j == 0:
                break
        else:
            total += i
    return total
`);
    // for 1, for 1+1, if 1+2, for-else 1
    expect(fn).toMatchObject({ name: "sum_of_primes", cyclomatic: 4, cognitive: 7, maxNesting: 3 });
  });

  test("match: one cognitive point, a cyclomatic point per non-wildcard case", async () => {
    const fn = await only(`
def get_words(n):
    match n:
        case 1:
            return "one"
        case 2:
            return "a couple"
        case 3:
            return "a few"
        case _:
            return "lots"
`);
    expect(fn).toMatchObject({ cyclomatic: 4, cognitive: 1, maxNesting: 1 });
  });

  test("boolean operators: one per run of identical operators", async () => {
    const fn = await only(`
def f(a, b, c, d):
    if a and b and c or d:
        return 1
    return 0
`);
    expect(fn).toMatchObject({ cognitive: 3, cyclomatic: 5 });
  });

  test("elif chain: no nesting penalty, same depth", async () => {
    const fn = await only(`
def grade(s):
    if s > 90:
        return "A"
    elif s > 80:
        return "B"
    else:
        return "C"
`);
    expect(fn).toMatchObject({ cognitive: 3, cyclomatic: 3, maxNesting: 1 });
  });

  test("try/except nesting", async () => {
    const fn = await only(`
def f(rows):
    while rows:
        for row in rows:
            if row:
                try:
                    row.pop()
                except IndexError:
                    break
`);
    expect(fn.cognitive).toBe(10);
    expect(fn.maxNesting).toBe(4);
  });

  test("comprehension with filter counts its loop and condition", async () => {
    const fn = await only(`
def evens(xs):
    return [x for x in xs if x % 2 == 0]
`);
    expect(fn.cyclomatic).toBe(3);
  });

  test("nested functions and methods get qualified names and separate metrics", async () => {
    const { functions } = await measure(`
class Cart:
    @property
    def total(self):
        def add(a, b):
            if a:
                return a + b
            return b
        return add(1, 2)
`);
    const byName = Object.fromEntries(functions.map((f) => [f.name, f]));
    expect(Object.keys(byName)).toEqual(["Cart.total", "Cart.total.add"]);
    expect(byName["Cart.total"]).toMatchObject({ cyclomatic: 1, cognitive: 0, startLine: 3 });
    expect(byName["Cart.total.add"]).toMatchObject({ cyclomatic: 2, cognitive: 1 });
  });

  test("syntax errors are reported per file, not thrown", async () => {
    const result = await measure("def broken(:\n");
    expect(result.parseError).toStartWith("SyntaxError");
    expect(result.functions).toEqual([]);
  });

  test("code is parsed, never executed", async () => {
    const { functions } = await measure(
      `import os\nos.system("touch /tmp/veritas-should-not-exist")\ndef f():\n    pass\n`,
    );
    expect(functions).toHaveLength(1);
    expect(await Bun.file("/tmp/veritas-should-not-exist").exists()).toBe(false);
  });
});
