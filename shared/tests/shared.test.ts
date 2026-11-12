import { describe, expect, test } from "bun:test";
import {
  analyzerRunSchema,
  compareSeverity,
  configSchema,
  DIMENSION_META,
  DIMENSIONS,
  findingSchema,
  gradeFor,
  isAtLeast,
  languageFor,
  SEVERITIES,
} from "../src";

const validFinding = {
  id: "f1",
  fingerprint: "a1b2c3d4e5f60718",
  dimension: "security",
  severity: "high",
  ruleId: "no-eval",
  message: "eval() executes arbitrary code",
  file: "src/app.ts",
  language: "typescript",
  startLine: 10,
  endLine: 12,
  source: "semgrep",
} as const;

describe("severity", () => {
  test("sorts worst first", () => {
    const sorted = [...SEVERITIES].reverse().sort(compareSeverity);
    expect(sorted).toEqual([...SEVERITIES]);
  });

  test("isAtLeast is inclusive", () => {
    expect(isAtLeast("critical", "high")).toBe(true);
    expect(isAtLeast("high", "high")).toBe(true);
    expect(isAtLeast("medium", "high")).toBe(false);
  });
});

describe("gradeFor", () => {
  test.each([
    [100, "A"],
    [90, "A"],
    [89.99, "B"],
    [80, "B"],
    [70, "C"],
    [60, "D"],
    [59.9, "F"],
    [0, "F"],
  ] as const)("%p -> %p", (score, grade) => {
    expect(gradeFor(score)).toBe(grade);
  });

  test.each([-1, 101, Number.NaN])("rejects %p", (score) => {
    expect(() => gradeFor(score)).toThrow(RangeError);
  });
});

describe("languageFor", () => {
  test.each([
    ["src/a.ts", "typescript"],
    ["App.TSX", "typescript"],
    ["lib/x.mjs", "javascript"],
    ["main.py", "python"],
    ["README.md", "other"],
    ["Makefile", "other"],
    [".env", "other"],
  ] as const)("%p -> %p", (path, language) => {
    expect(languageFor(path)).toBe(language);
  });
});

describe("dimensions", () => {
  test("every dimension has metadata with a positive weight", () => {
    for (const d of DIMENSIONS) {
      expect(DIMENSION_META[d].defaultWeight).toBeGreaterThan(0);
    }
  });
});

describe("findingSchema", () => {
  test("accepts a valid finding", () => {
    expect(findingSchema.safeParse(validFinding).success).toBe(true);
  });

  test("accepts a project-level finding without lines", () => {
    const { startLine: _s, endLine: _e, ...noLines } = validFinding;
    expect(findingSchema.safeParse(noLines).success).toBe(true);
  });

  test.each(["/etc/passwd", "../outside.ts", "src\\win.ts", "a/../../b.ts"])(
    "rejects unsafe path %p",
    (file) => {
      expect(findingSchema.safeParse({ ...validFinding, file }).success).toBe(false);
    },
  );

  test("rejects endLine before startLine", () => {
    expect(findingSchema.safeParse({ ...validFinding, startLine: 5, endLine: 4 }).success).toBe(
      false,
    );
  });

  test("rejects endLine without startLine", () => {
    const { startLine: _s, ...rest } = validFinding;
    expect(findingSchema.safeParse(rest).success).toBe(false);
  });

  test("rejects non-hex fingerprint", () => {
    expect(findingSchema.safeParse({ ...validFinding, fingerprint: "not-hex!" }).success).toBe(
      false,
    );
  });

  test("rejects zero and fractional lines", () => {
    expect(findingSchema.safeParse({ ...validFinding, startLine: 0 }).success).toBe(false);
    expect(findingSchema.safeParse({ ...validFinding, startLine: 1.5 }).success).toBe(false);
  });
});

describe("analyzerRunSchema", () => {
  const base = { dimension: "secrets", durationMs: 5, findingCount: 0 } as const;

  test("skipped run needs a reason", () => {
    expect(analyzerRunSchema.safeParse({ ...base, status: "skipped" }).success).toBe(false);
    expect(
      analyzerRunSchema.safeParse({ ...base, status: "skipped", reason: "gitleaks not installed" })
        .success,
    ).toBe(true);
  });

  test("completed run needs no reason", () => {
    expect(analyzerRunSchema.safeParse({ ...base, status: "completed" }).success).toBe(true);
  });
});

describe("configSchema", () => {
  test("empty input resolves every default, including nested ones", () => {
    const config = configSchema.parse({});
    expect(config.root).toBe("code");
    expect(config.ignore).toEqual([]);
    expect(config.dimensions).toBeUndefined();
    expect(config.thresholds.maxCyclomatic).toBe(10);
    expect(config.gate.failOn).toBe("critical");
    expect(config.analyzerTimeoutMs).toBe(120_000);
  });

  test("partial nested input keeps other defaults", () => {
    const config = configSchema.parse({ thresholds: { maxNesting: 6 } });
    expect(config.thresholds.maxNesting).toBe(6);
    expect(config.thresholds.maxFileLines).toBe(500);
  });

  test("rejects unknown dimension and negative weight", () => {
    expect(configSchema.safeParse({ dimensions: ["speed"] }).success).toBe(false);
    expect(configSchema.safeParse({ weights: { security: -1 } }).success).toBe(false);
  });

  test("rejects empty dimension list", () => {
    expect(configSchema.safeParse({ dimensions: [] }).success).toBe(false);
  });
});
