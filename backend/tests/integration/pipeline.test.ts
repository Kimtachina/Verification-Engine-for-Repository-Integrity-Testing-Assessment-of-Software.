import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DIMENSIONS, type Dimension, type ScanEvent, scanSchema } from "@veritas/shared";
import type { Analyzer } from "../../src/engine/analyzers/analyzer";
import { findPython } from "../../src/engine/languages/python/python-facts";
import { runScan } from "../../src/engine/pipeline";
import { buildReport } from "../../src/reports/json-report";
import { configFor, FIXTURES } from "../helpers";

const SAMPLE = join(FIXTURES, "sample-project");
const CLEAN = join(FIXTURES, "clean-project");

/**
 * Dimensions whose results are identical on every machine: built in, or backed by a tool
 * VERITAS bundles (Biome, Pyright, jscpd). Security, secrets and dependencies rely on
 * separately installed tools and the network, so they are tested where available.
 */
const DETERMINISTIC: Dimension[] = [
  "integrity",
  "correctness",
  "lint",
  "complexity",
  "duplication",
  "testing",
  "maintainability",
];

describe("runScan on sample-project", async () => {
  const events: ScanEvent[] = [];
  const outcome = await runScan(configFor(SAMPLE, { dimensions: DETERMINISTIC }), {
    scanId: "s1",
    onEvent: (e) => events.push(e),
  });
  const { scan, findings } = outcome;
  const summary = findings.map(
    (f) => `${f.severity} ${f.ruleId} ${f.file}${f.startLine ? `:${f.startLine}` : ""}`,
  );
  const python = findPython() !== null;

  test("produces a valid scan and report", () => {
    expect(scanSchema.safeParse(scan).success).toBe(true);
    expect(() => buildReport(outcome)).not.toThrow();
  });

  test("reports exactly the planted problems, worst first", () => {
    const expected = [
      "high testing/no-tests .",
      "high testing/focused-test tests/pricing.test.ts:5",
      // 3 TS exports + 2 Python functions reach the 5-definition minimum only with Python.
      ...(python ? ["medium maintainability/doc-coverage ."] : []),
      ...(python ? ["medium complexity/nesting app/legacy.py:2"] : []),
      "medium complexity/cognitive src/pricing.ts:9",
      "medium complexity/cyclomatic src/pricing.ts:9",
      "medium complexity/nesting src/pricing.ts:9",
      "low integrity/empty-source-file src/empty.ts",
      "low lint/complexity/useOptionalChain src/pricing.ts:15",
      "low testing/skipped-test tests/pricing.test.ts:9",
      "info testing/no-coverage-report .",
    ];
    expect(summary).toEqual(expected);
  });

  test("stats count every discovered file by language", () => {
    expect(scan.stats).toMatchObject({
      files: 6,
      byLanguage: { typescript: { files: 4 }, python: { files: 1 }, other: { files: 1 } },
    });
  });

  test("every configured dimension completes and is scored", () => {
    expect(scan.analyzers.map((a) => a.dimension)).toEqual(DETERMINISTIC);
    for (const run of scan.analyzers) expect(run.status).toBe("completed");
    const scored = scan.dimensions.filter((d) => d.score !== null).map((d) => d.dimension);
    expect(scored).toEqual(DETERMINISTIC);
  });

  test("scores and gate are consistent", () => {
    expect(scan.score).toBeGreaterThan(0);
    expect(scan.score).toBeLessThan(100);
    expect(scan.gate).toEqual({ passed: true, reasons: [] });
    expect(scan.counts.high).toBe(2);
  });

  test("ids are scoped to the scan", () => {
    expect(findings.every((f) => f.id === `s1-${f.fingerprint}`)).toBe(true);
  });

  test("events arrive in order: discovery, analyzers, finish", () => {
    expect(events[0]).toEqual({ type: "discovery-started" });
    expect(events[1]).toMatchObject({ type: "discovery-finished", files: 6 });
    expect(events.at(-1)).toMatchObject({ type: "scan-finished" });
    expect(events.filter((e) => e.type === "analyzer-started")).toHaveLength(DETERMINISTIC.length);
    expect(events.filter((e) => e.type === "analyzer-finished")).toHaveLength(DETERMINISTIC.length);
  });
});

describe("runScan with every dimension", () => {
  test("each of the 10 dimensions has an analyzer, and every non-completed run explains why", async () => {
    const { scan } = await runScan(configFor(SAMPLE));
    expect(scan.analyzers.map((a) => a.dimension)).toEqual([...DIMENSIONS]);
    for (const run of scan.analyzers) {
      expect(run.reason ?? "").not.toContain("No analyzer");
      if (run.status !== "completed") expect(run.reason).toBeString();
    }
  }, 120_000);
});

describe("runScan on clean-project", () => {
  test("scores 100 with no scored findings and reads its coverage report", async () => {
    const { scan, findings } = await runScan(configFor(CLEAN, { dimensions: DETERMINISTIC }));
    expect(findings).toEqual([]);
    expect(scan.score).toBe(100);
    expect(scan.grade).toBe("A");
  });

  test("fingerprints are identical across repeated scans", async () => {
    const a = await runScan(configFor(SAMPLE), { scanId: "a" });
    const b = await runScan(configFor(SAMPLE), { scanId: "b" });
    expect(a.findings.map((f) => f.fingerprint)).toEqual(b.findings.map((f) => f.fingerprint));
  });
});

describe("analyzer failure isolation", () => {
  const ok: Analyzer = {
    dimension: "integrity",
    run: async () => ({ status: "completed", findings: [] }),
  };
  const config = configFor(CLEAN, { dimensions: ["integrity", "lint"] });

  test("a throwing analyzer is recorded as failed; the scan still completes", async () => {
    const throwing: Analyzer = {
      dimension: "lint",
      run: async () => {
        throw new Error("tool crashed");
      },
    };
    const { scan } = await runScan(config, {
      analyzers: new Map([
        ["integrity", ok],
        ["lint", throwing],
      ]),
    });
    expect(scan.status).toBe("completed");
    expect(scan.analyzers.find((a) => a.dimension === "lint")).toMatchObject({
      status: "failed",
      reason: "tool crashed",
    });
    expect(scan.dimensions.find((d) => d.dimension === "lint")?.score).toBeNull();
    expect(scan.score).toBe(100);
  });

  test("a hanging analyzer times out and is told to abort", async () => {
    let aborted = false;
    const hanging: Analyzer = {
      dimension: "lint",
      run: ({ signal }) =>
        new Promise(() => {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
    };
    const { scan } = await runScan(
      configFor(CLEAN, { dimensions: ["lint"], analyzerTimeoutMs: 50 }),
      {
        analyzers: new Map([["lint", hanging]]),
      },
    );
    expect(scan.analyzers[0]).toMatchObject({ status: "failed", reason: "Timed out after 50 ms" });
    expect(aborted).toBe(true);
    expect(scan.score).toBeNull();
  });

  test("an invalid finding fails that analyzer instead of corrupting the report", async () => {
    const invalid: Analyzer = {
      dimension: "lint",
      run: async () => ({
        status: "completed",
        findings: [
          { severity: "low", ruleId: "r", message: "m", file: "/abs/path.ts", source: "t" },
        ],
      }),
    };
    const { scan, findings } = await runScan(config, {
      analyzers: new Map([
        ["integrity", ok],
        ["lint", invalid],
      ]),
    });
    expect(scan.analyzers.find((a) => a.dimension === "lint")?.status).toBe("failed");
    expect(findings).toEqual([]);
  });

  test("only configured dimensions run", async () => {
    const { scan } = await runScan(configFor(CLEAN, { dimensions: ["integrity"] }));
    expect(scan.analyzers.map((a) => a.dimension)).toEqual(["integrity"]);
  });
});
