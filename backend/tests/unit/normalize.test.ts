import { describe, expect, test } from "bun:test";
import type { RawFinding } from "../../src/engine/analyzers/analyzer";
import { normalizeFindings, sortFindings } from "../../src/engine/normalize/normalize-findings";
import { textFile } from "../helpers";

const raw = (overrides: Partial<RawFinding> = {}): RawFinding => ({
  severity: "medium",
  ruleId: "x/rule",
  message: "Problem",
  file: "src/a.ts",
  startLine: 2,
  source: "test",
  ...overrides,
});

function normalize(content: string, findings: RawFinding[]) {
  const file = textFile("src/a.ts", content);
  return normalizeFindings("lint", findings, new Map([[file.path, file]]), "scan1");
}

describe("normalizeFindings", () => {
  test("fills dimension, language, snippet, id and fingerprint", () => {
    const [f] = normalize("one\n  two  \nthree\n", [raw()]);
    expect(f).toMatchObject({
      dimension: "lint",
      language: "typescript",
      snippet: "  two  ",
      id: `scan1-${f?.fingerprint}`,
    });
    expect(f?.fingerprint).toMatch(/^[a-f0-9]{32}$/);
  });

  test("fingerprint survives lines inserted above and whitespace changes", () => {
    const [before] = normalize("a\nconst x = eval(s);\n", [raw({ startLine: 2 })]);
    const [after] = normalize("new\nlines\na\n   const  x = eval(s);\n", [raw({ startLine: 4 })]);
    expect(after?.fingerprint).toBe(before!.fingerprint);
  });

  test("fingerprint changes when the offending line changes", () => {
    const [a] = normalize("a\neval(s)\n", [raw()]);
    const [b] = normalize("a\neval(t)\n", [raw()]);
    expect(a?.fingerprint).not.toBe(b?.fingerprint);
  });

  test("identical lines in one file get distinct, stable fingerprints", () => {
    const findings = normalize("x\nfoo()\nfoo()\n", [raw({ startLine: 2 }), raw({ startLine: 3 })]);
    expect(new Set(findings.map((f) => f.fingerprint)).size).toBe(2);
  });

  test("exact duplicates are dropped", () => {
    expect(normalize("a\nb\n", [raw(), raw()])).toHaveLength(1);
  });

  test("snippet covers the span but is capped at 8 lines", () => {
    const content = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join("\n");
    const [f] = normalize(content, [raw({ startLine: 3, endLine: 25 })]);
    expect(f?.snippet?.split("\n")).toEqual([
      "line3",
      "line4",
      "line5",
      "line6",
      "line7",
      "line8",
      "line9",
      "line10",
    ]);
  });

  test("an analyzer-provided snippet wins", () => {
    const [f] = normalize("a\nb\n", [raw({ snippet: "custom" })]);
    expect(f?.snippet).toBe("custom");
  });

  test("project-level findings have no snippet and language 'other'", () => {
    const [f] = normalize("a\n", [raw({ file: ".", startLine: undefined })]);
    expect(f?.language).toBe("other");
    expect(f?.snippet).toBeUndefined();
  });

  test("an invalid finding throws instead of reaching the report", () => {
    expect(() => normalize("a\n", [raw({ file: "../escape.ts" })])).toThrow();
  });
});

describe("sortFindings", () => {
  test("worst first, then file, then line", () => {
    const findings = normalize("1\n2\n3\n4\n5\n", [
      raw({ severity: "low", startLine: 1 }),
      raw({ severity: "high", startLine: 5 }),
      raw({ severity: "high", startLine: 2 }),
    ]);
    expect(sortFindings(findings).map((f) => [f.severity, f.startLine])).toEqual([
      ["high", 2],
      ["high", 5],
      ["low", 1],
    ]);
  });
});
