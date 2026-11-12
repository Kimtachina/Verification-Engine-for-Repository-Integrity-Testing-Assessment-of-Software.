import { describe, expect, test } from "bun:test";
import { PROJECT_FILE } from "../../src/engine/analyzers/analyzer";
import {
  parseCobertura,
  parseIstanbulSummary,
  parseLcov,
} from "../../src/engine/analyzers/testing/coverage-report";
import { testingAnalyzer } from "../../src/engine/analyzers/testing/testing.analyzer";
import { isTestFile, testedModuleName } from "../../src/engine/discovery/classify";
import type { SourceFile } from "../../src/engine/discovery/source-file";
import { contextFor, ruleIds, tempTree, textFile } from "../helpers";

const longSource = (path: string) => textFile(path, "export const x = 1;\n".repeat(25));

async function run(files: SourceFile[], rootDir?: string) {
  const result = await testingAnalyzer.run(contextFor(files, rootDir ? { rootDir } : {}));
  if (result.status !== "completed")
    throw new Error(`expected completed: ${JSON.stringify(result)}`);
  return result.findings.filter((f) => f.ruleId !== "testing/no-coverage-report");
}

describe("classify", () => {
  test.each([
    ["src/a.test.ts", true],
    ["src/a.spec.jsx", true],
    ["tests/helpers.ts", true],
    ["pkg/__tests__/x.js", true],
    ["test_parser.py", true],
    ["parser_test.py", true],
    ["conftest.py", true],
    ["src/contest.py", false],
    ["src/testing-utils.ts", false],
    ["src/latest.ts", false],
  ] as const)("isTestFile(%p) = %p", (path, expected) => {
    expect(isTestFile(path)).toBe(expected);
  });

  test.each([
    ["src/user.service.test.ts", "user.service"],
    ["tests/test_parser.py", "parser"],
    ["parser_test.py", "parser"],
    ["a.spec.tsx", "a"],
    ["tests/cart.ts", "cart"],
  ] as const)("testedModuleName(%p) = %p", (path, expected) => {
    expect(testedModuleName(path)).toBe(expected);
  });
});

describe("testing analyzer", () => {
  test("skips when there is no program source", async () => {
    const result = await testingAnalyzer.run(contextFor([textFile("README.md", "# hi")]));
    expect(result).toMatchObject({ status: "skipped" });
  });

  test("no tests at all is a high project-level finding, per language family", async () => {
    const findings = await run([longSource("src/a.ts"), longSource("app/main.py")]);
    const noTests = findings.filter((f) => f.ruleId === "testing/no-tests");
    expect(noTests).toHaveLength(2);
    expect(noTests.every((f) => f.severity === "high" && f.file === PROJECT_FILE)).toBe(true);
  });

  test("JS tests do not count for Python sources", async () => {
    const findings = await run([
      longSource("src/a.ts"),
      textFile("src/a.test.ts", "test('x', () => expect(1).toBe(1));"),
      longSource("app/main.py"),
    ]);
    expect(findings.filter((f) => f.ruleId === "testing/no-tests").map((f) => f.message)).toEqual([
      "1 Python source file(s) and no test files.",
    ]);
  });

  test("low test ratio", async () => {
    const sources = ["a", "b", "c", "d", "e", "f"].map((n) => longSource(`src/${n}.ts`));
    const findings = await run([
      ...sources,
      textFile("src/a.test.ts", "test('x', () => expect(1).toBe(1));"),
    ]);
    expect(ruleIds(findings)).toContain("testing/low-test-ratio");
  });

  test("modules without a same-named test are info only, and small files are exempt", async () => {
    const findings = await run([
      longSource("src/cart.ts"),
      longSource("src/price.ts"),
      textFile("src/tiny.ts", "export {};\n"),
      longSource("src/index.ts"),
      textFile("tests/cart.test.ts", "test('x', () => expect(1).toBe(1));"),
    ]);
    const unmatched = findings.filter((f) => f.ruleId === "testing/no-matching-test");
    expect(unmatched.map((f) => [f.file, f.severity])).toEqual([["src/price.ts", "info"]]);
  });

  test("focused, skipped and assertion-free tests", async () => {
    const findings = await run([
      longSource("src/a.ts"),
      textFile(
        "src/a.test.ts",
        [
          "describe('a', () => {",
          "  it.only('runs alone', () => expect(1).toBe(1));",
          "  it.skip('later', () => {});",
          "  xit('old', () => {});",
          "});",
        ].join("\n"),
      ),
      textFile("src/b.test.ts", "test('does nothing', () => { doThing(); });"),
    ]);
    expect(findings.map((f) => [f.ruleId, f.file, f.startLine, f.severity])).toEqual([
      ["testing/focused-test", "src/a.test.ts", 2, "high"],
      ["testing/skipped-test", "src/a.test.ts", 3, "low"],
      ["testing/skipped-test", "src/a.test.ts", 4, "low"],
      ["testing/no-assertions", "src/b.test.ts", undefined, "medium"],
    ]);
  });

  test("python: skipped tests and assertion-free tests", async () => {
    const findings = await run([
      longSource("app/parser.py"),
      textFile(
        "tests/test_parser.py",
        "import pytest\n\n@pytest.mark.skip\ndef test_a():\n    assert parse() == 1\n",
      ),
      textFile("tests/test_empty.py", "def test_nothing():\n    parse()\n"),
      textFile("tests/conftest.py", "import pytest\n"),
    ]);
    expect(findings.map((f) => [f.ruleId, f.file, f.startLine])).toEqual([
      ["testing/skipped-test", "tests/test_parser.py", 3],
      ["testing/no-assertions", "tests/test_empty.py", undefined],
    ]);
  });

  test("reads a coverage report from the scan root", async () => {
    const tree = tempTree({ "lcov.info": "SF:a.ts\nLF:10\nLH:4\nend_of_record\n" });
    try {
      const findings = await run(
        [longSource("src/a.ts"), textFile("src/a.test.ts", "expect(1)")],
        tree.dir,
      );
      const coverage = findings.find((f) => f.ruleId === "testing/low-coverage");
      expect(coverage).toMatchObject({ severity: "medium", file: "lcov.info" });
      expect(coverage?.message).toContain("40%");
    } finally {
      tree.cleanup();
    }
  });

  test("notes when no coverage report exists", async () => {
    const result = await testingAnalyzer.run(contextFor([longSource("src/a.ts")]));
    expect(result.status === "completed" && ruleIds(result.findings)).toContain(
      "testing/no-coverage-report",
    );
  });
});

describe("coverage parsers", () => {
  test("lcov sums every record", () => {
    expect(parseLcov("LF:10\nLH:5\nend_of_record\nLF:30\nLH:30\nend_of_record\n")).toBe(87.5);
    expect(parseLcov("TN:\n")).toBeNull();
  });

  test("istanbul summary", () => {
    expect(parseIstanbulSummary('{"total":{"lines":{"pct":72.456}}}')).toBe(72.5);
    expect(parseIstanbulSummary("not json")).toBeNull();
  });

  test("cobertura", () => {
    expect(parseCobertura('<?xml version="1.0"?><coverage version="7" line-rate="0.8312">')).toBe(
      83.1,
    );
    expect(parseCobertura('<coverage line-rate="3">')).toBeNull();
  });
});
