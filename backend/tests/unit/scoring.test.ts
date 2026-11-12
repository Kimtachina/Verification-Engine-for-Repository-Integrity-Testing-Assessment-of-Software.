import { describe, expect, test } from "bun:test";
import type { Finding, Severity } from "@veritas/shared";
import { resolveWeights } from "../../src/config/weights";
import { evaluateGate } from "../../src/engine/scoring/gate";
import { countSeverities, overallScore, scoreDimension } from "../../src/engine/scoring/score";

let n = 0;
const finding = (severity: Severity, file = "src/a.ts"): Finding => ({
  id: `f${++n}`,
  fingerprint: "0123456789abcdef",
  dimension: "lint",
  severity,
  ruleId: "r",
  message: "m",
  file,
  language: "typescript",
  source: "test",
});
const many = (count: number, severity: Severity) =>
  Array.from({ length: count }, () => finding(severity));

describe("scoreDimension", () => {
  test("no findings is a perfect score", () => {
    expect(scoreDimension([], 5000)).toBe(100);
  });

  test("documented calibration points per 1,000 lines", () => {
    expect(scoreDimension([finding("critical")], 1000)).toBe(60.7);
    expect(scoreDimension([finding("high")], 1000)).toBe(77.9);
    expect(scoreDimension([finding("medium")], 1000)).toBe(90.5);
    expect(scoreDimension([finding("low")], 1000)).toBe(97.5);
    expect(scoreDimension([finding("info")], 1000)).toBe(100);
  });

  test("file findings scale with size: same density, same score", () => {
    expect(scoreDimension(many(4, "medium"), 2000)).toBe(
      scoreDimension(many(20, "medium"), 10_000),
    );
  });

  test("small files are not over-penalised: size floor is 1,000 lines", () => {
    expect(scoreDimension([finding("high")], 50)).toBe(scoreDimension([finding("high")], 1000));
  });

  test("project-level findings count in full regardless of size", () => {
    expect(scoreDimension([finding("high", ".")], 100_000)).toBe(77.9);
  });

  test("monotonic: more findings never raise the score", () => {
    let previous = 100;
    for (let i = 1; i <= 30; i++) {
      const score = scoreDimension(many(i, "medium"), 3000);
      expect(score).toBeLessThanOrEqual(previous);
      previous = score;
    }
    expect(previous).toBeGreaterThanOrEqual(0);
  });
});

describe("overallScore", () => {
  test("weighted mean that ignores unscored dimensions", () => {
    const weights = resolveWeights({ weights: {} });
    // security weight 3, integrity weight 1
    const score = overallScore(
      [
        { dimension: "security", score: 50 },
        { dimension: "integrity", score: 100 },
        { dimension: "lint", score: null },
      ],
      weights,
    );
    expect(score).toBe(62.5);
  });

  test("null when nothing was scored", () => {
    expect(
      overallScore([{ dimension: "lint", score: null }], resolveWeights({ weights: {} })),
    ).toBeNull();
  });
});

describe("countSeverities", () => {
  test("every severity key is present", () => {
    expect(countSeverities([finding("high"), finding("high"), finding("info")])).toEqual({
      critical: 0,
      high: 2,
      medium: 0,
      low: 0,
      info: 1,
    });
  });
});

describe("evaluateGate", () => {
  test("passes with no blocking findings and no minimum score", () => {
    expect(evaluateGate(many(5, "high"), 40, { failOn: "critical", minScore: 0 })).toEqual({
      passed: true,
      reasons: [],
    });
  });

  test("one blocking finding fails it whatever the score", () => {
    const gate = evaluateGate([finding("critical")], 99, { failOn: "critical", minScore: 0 });
    expect(gate.passed).toBe(false);
    expect(gate.reasons[0]).toContain('1 finding(s) at or above "critical"');
  });

  test("failOn is inclusive of worse severities", () => {
    expect(evaluateGate([finding("critical")], 99, { failOn: "high", minScore: 0 }).passed).toBe(
      false,
    );
    expect(evaluateGate([finding("medium")], 99, { failOn: "high", minScore: 0 }).passed).toBe(
      true,
    );
  });

  test("minimum score, including when nothing could be scored", () => {
    expect(evaluateGate([], 70, { failOn: "critical", minScore: 80 }).reasons).toEqual([
      "Overall score 70 is below the minimum 80",
    ]);
    expect(evaluateGate([], null, { failOn: "critical", minScore: 80 }).passed).toBe(false);
    expect(evaluateGate([], 80, { failOn: "critical", minScore: 80 }).passed).toBe(true);
  });
});
