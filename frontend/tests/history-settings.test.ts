import { describe, expect, test } from "bun:test";
import { type Scan, settingsOverridesSchema } from "@veritas/shared";
import { THRESHOLD_FIELDS, toFormState, toOverrides } from "../src/lib/settings-form";
import { trendPath, trendPoints } from "../src/lib/trend";

const scan = (
  id: string,
  startedAt: string,
  score: number | null,
  status: Scan["status"] = "completed",
) => ({ id, startedAt, score, grade: score === null ? null : "B", status }) as Scan;

describe("trendPoints", () => {
  const box = { width: 120, height: 120, padding: 10 };

  test("completed scans only, oldest first, evenly spaced; y=top for 100", () => {
    const points = trendPoints(
      [
        scan("c", "2026-01-03", 50),
        scan("a", "2026-01-01", 100),
        scan("running", "2026-01-04", null, "running"),
        scan("failed", "2026-01-05", null, "failed"),
        scan("b", "2026-01-02", 0),
      ],
      box,
    );
    expect(points.map((p) => p.scan.id)).toEqual(["a", "b", "c"]);
    expect(points.map((p) => [p.x, p.y])).toEqual([
      [10, 10],
      [60, 110],
      [110, 60],
    ]);
    expect(trendPath(points)).toBe("M10.0 10.0 L60.0 110.0 L110.0 60.0");
  });

  test("a single scan sits in the middle", () => {
    expect(trendPoints([scan("a", "2026-01-01", 80)], box)[0]?.x).toBe(60);
  });

  test("no completed scans, no points", () => {
    expect(trendPoints([scan("r", "2026-01-01", null, "running")], box)).toEqual([]);
  });
});

describe("settings form", () => {
  test("blank fields are not overrides; filled ones are, with seconds turned into ms", () => {
    const form = toFormState({});
    expect(toOverrides(form)).toEqual({});

    form.failOn = "high";
    form.minScore = "75";
    form.thresholds.maxCyclomatic = "12";
    form.thresholds.minTestRatio = "0.25";
    form.weights.security = "4";
    form.ignore = "  generated/**\n\n**/*.snap  \n";
    form.timeoutSeconds = "90";
    expect(toOverrides(form)).toEqual({
      gate: { failOn: "high", minScore: 75 },
      thresholds: { maxCyclomatic: 12, minTestRatio: 0.25 },
      weights: { security: 4 },
      ignore: ["generated/**", "**/*.snap"],
      analyzerTimeoutMs: 90_000,
    });
  });

  test("round-trip: overrides → form → overrides", () => {
    const overrides = {
      gate: { failOn: "medium" as const },
      thresholds: { maxNesting: 3 },
      weights: { lint: 0 },
      ignore: ["a/**"],
      analyzerTimeoutMs: 1500,
    };
    expect(toOverrides(toFormState(overrides))).toEqual(overrides);
  });

  test("a weight of 0 is kept (it means: do not count this dimension)", () => {
    const form = toFormState({});
    form.weights.testing = "0";
    expect(toOverrides(form).weights).toEqual({ testing: 0 });
  });

  test("the form offers exactly the thresholds the API accepts", () => {
    const formKeys = THRESHOLD_FIELDS.map((f): string => f.key).sort();
    const apiKeys = Object.keys(settingsOverridesSchema.shape.thresholds.unwrap().shape).sort();
    expect(formKeys).toEqual(apiKeys);
  });
});
