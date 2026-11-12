import { describe, expect, test } from "bun:test";
import type { AnalyzerRun, Scan, ScanEvent } from "@veritas/shared";
import { toQueryString } from "../src/lib/api-client";
import {
  filtersFromParams,
  filtersToParams,
  filtersToQuery,
  findingsHref,
  PAGE_SIZE,
} from "../src/lib/finding-filters";
import { formatLocation, scanIdOfFinding } from "../src/lib/format";
import { initialProgress, percentDone, reduceProgress } from "../src/lib/scan-progress";

const run = (dimension: AnalyzerRun["dimension"]): AnalyzerRun => ({
  dimension,
  status: "completed",
  durationMs: 10,
  findingCount: 2,
});

describe("reduceProgress", () => {
  const fold = (events: ScanEvent[]) => events.reduce(reduceProgress, initialProgress);

  test("tracks phases, counts and per-dimension state", () => {
    const state = fold([
      { type: "discovery-started" },
      { type: "discovery-finished", files: 12, lines: 340 },
      { type: "analyzer-started", dimension: "lint" },
      { type: "analyzer-started", dimension: "secrets" },
      { type: "analyzer-finished", run: run("lint") },
    ]);
    expect(state).toMatchObject({ phase: "analyzing", files: 12, lines: 340 });
    expect(state.dimensions.lint).toEqual({ state: "done", run: run("lint") });
    expect(state.dimensions.secrets).toEqual({ state: "running" });
    expect(percentDone(state)).toBe(50);
  });

  test("a replay after reconnect starts over instead of duplicating", () => {
    const events: ScanEvent[] = [
      { type: "discovery-started" },
      { type: "analyzer-started", dimension: "lint" },
    ];
    expect(fold([...events, ...events])).toEqual(fold(events));
  });

  test("finished is 100% and carries the scan", () => {
    const scan = { id: "s1" } as Scan;
    const state = fold([{ type: "discovery-started" }, { type: "scan-finished", scan }]);
    expect(state.phase).toBe("finished");
    expect(state.scan).toBe(scan);
    expect(percentDone(state)).toBe(100);
  });
});

describe("finding filters in the URL", () => {
  test("round-trip: params → filters → params", () => {
    const qs = "severity=critical,high&dimension=lint&file=src/&q=eval&sort=file&page=3";
    const filters = filtersFromParams(new URLSearchParams(qs));
    expect(filters).toEqual({
      severity: ["critical", "high"],
      dimension: ["lint"],
      file: "src/",
      q: "eval",
      sort: "file",
      page: 3,
    });
    expect(filtersToParams(filters).toString()).toBe(new URLSearchParams(qs).toString());
  });

  test("unknown or malformed values are dropped, not sent to the API", () => {
    const filters = filtersFromParams(
      new URLSearchParams("severity=urgent,low&dimension=speed&sort=random&page=-2"),
    );
    expect(filters).toMatchObject({ severity: ["low"], dimension: [], sort: "severity", page: 1 });
  });

  test("page becomes offset; empty filters are omitted", () => {
    const query = filtersToQuery(filtersFromParams(new URLSearchParams("page=2&q=%20%20")));
    expect(query).toEqual({ sort: "severity", limit: PAGE_SIZE, offset: PAGE_SIZE });
  });

  test("findingsHref builds a minimal link", () => {
    expect(findingsHref("s1", {})).toBe("/scans/s1");
    expect(findingsHref("s1", { file: "src/a.ts" })).toBe("/scans/s1?file=src%2Fa.ts");
    expect(findingsHref("s1", { dimension: ["security"] })).toBe("/scans/s1?dimension=security");
  });
});

describe("toQueryString", () => {
  test("joins arrays, skips empty values", () => {
    expect(
      toQueryString({
        severity: ["high", "low"],
        q: "",
        file: undefined,
        limit: 50,
        dimension: [],
      }),
    ).toBe("?severity=high%2Clow&limit=50");
    expect(toQueryString({})).toBe("");
  });
});

describe("format helpers", () => {
  test("scanIdOfFinding splits off the 32-hex fingerprint", () => {
    const scanId = "b5d24da2-cb2b-4c05-83b8-b0f006787f42";
    expect(scanIdOfFinding(`${scanId}-${"a".repeat(32)}`)).toBe(scanId);
    expect(scanIdOfFinding("not-a-finding-id")).toBeNull();
  });

  test.each([
    [{ file: "." }, "ทั้งโปรเจกต์"],
    [{ file: "src/a.ts" }, "src/a.ts"],
    [{ file: "src/a.ts", startLine: 4 }, "src/a.ts:4"],
    [{ file: "src/a.ts", startLine: 4, endLine: 4 }, "src/a.ts:4"],
    [{ file: "src/a.ts", startLine: 4, endLine: 9 }, "src/a.ts:4–9"],
  ])("formatLocation(%p) = %p", (finding, expected) => {
    expect(formatLocation(finding)).toBe(expected);
  });
});
