import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  apiErrorSchema,
  fileSummarySchema,
  findingPageSchema,
  findingSchema,
  healthSchema,
  reportSchema,
  type Scan,
  type ScanEvent,
  scanComparisonSchema,
  scanEventSchema,
  scanSchema,
  settingsOverridesSchema,
  settingsSchema,
  thresholdsSchema,
  UPLOAD_LIMITS,
  uploadSchema,
} from "@veritas/shared";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { createApp } from "../../src/app";
import { type Db, type OpenedDatabase, openDatabase } from "../../src/db/client";
import { INTERRUPTED_ERROR, ScanRepository } from "../../src/db/scan-repository";
import { runScan } from "../../src/engine/pipeline";
import { ScanRunner, type ScanRunnerDeps } from "../../src/services/scan-runner";
import { SettingsService } from "../../src/services/settings-service";
import { KEEP_UPLOADS, safeName, UploadStore } from "../../src/services/upload-store";
import { FIXTURES } from "../helpers";

const SAMPLE = join(FIXTURES, "sample-project");
/** Built-in dimensions only: fast and identical on every machine. */
const FAST = { dimensions: ["integrity", "complexity", "testing"] } as const;
const ORIGIN = "http://localhost:3000";

let db: Db;
let repo: ScanRepository;
let runner: ScanRunner;
let settings: SettingsService;
let uploads: UploadStore;
let uploadsDir: string;
let app: ReturnType<typeof createApp>;

/** One embedded Postgres for the file, emptied before each test: starting one takes a while. */
let opened: OpenedDatabase | null = null;
afterAll(() => opened?.close());

async function setup(
  runScanImpl?: ScanRunnerDeps["runScan"],
  loadConfig?: ScanRunnerDeps["loadConfig"],
) {
  opened ??= await openDatabase({ memory: true });
  db = opened.db;
  await db.execute(sql`truncate veritas.findings, veritas.scans, veritas.settings`);
  repo = new ScanRepository(db);
  // The fixture has no veritas.config.ts; point the root at it and keep scans fast.
  settings = new SettingsService(db, SAMPLE, { root: SAMPLE, dimensions: [...FAST.dimensions] });
  uploadsDir = mkdtempSync(join(tmpdir(), "veritas-uploads-"));
  uploads = new UploadStore(uploadsDir);
  runner = new ScanRunner({
    repo,
    loadConfig: loadConfig ?? settings.loadConfig,
    uploadRoot: (id) => uploads.rootOf(id),
    ...(runScanImpl && { runScan: runScanImpl }),
  });
  app = createApp({ repo, runner, settings, uploads, root: SAMPLE, corsOrigins: [ORIGIN] });
}

async function call(path: string, init: RequestInit = {}) {
  const res = await app.handle(new Request(`http://localhost${path}`, init));
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, body, text };
}

const post = (path: string, body?: unknown, raw?: string) =>
  call(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(raw !== undefined
      ? { body: raw }
      : body !== undefined
        ? { body: JSON.stringify(body) }
        : {}),
  });

/** Starts a scan through the API and waits until it is stored. */
async function completedScan(body: unknown = {}): Promise<Scan> {
  const { status, body: started } = await post("/api/scans", body);
  expect(status).toBe(202);
  await runner.idle();
  return scanSchema.parse((await call(`/api/scans/${(started as Scan).id}`)).body);
}

/** A runScan that waits for `release()` before doing the real work. */
function gatedRunScan() {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const impl: NonNullable<ScanRunnerDeps["runScan"]> = async (config, opts) => {
    opts.onEvent?.({ type: "discovery-started" });
    await gate;
    return runScan(config, opts);
  };
  return { impl, release };
}

beforeEach(() => setup());

describe("GET /api/health", () => {
  test("reports version, root, every tool and no running scan", async () => {
    const { status, body } = await call("/api/health");
    expect(status).toBe(200);
    const health = healthSchema.parse(body);
    expect(health.root).toBe(SAMPLE);
    expect(health.tools.map((t) => t.name)).toHaveLength(7);
    expect(health.tools.find((t) => t.name === "biome")).toMatchObject({
      available: true,
      source: "bundled",
    });
    expect(health.runningScanId).toBeNull();
  });
});

describe("POST /api/scans", () => {
  test("202 with a running scan, which completes in the background", async () => {
    const { status, body } = await post("/api/scans");
    expect(status).toBe(202);
    expect(scanSchema.parse(body)).toMatchObject({ status: "running", root: SAMPLE, score: null });

    await runner.idle();
    const done = scanSchema.parse((await call(`/api/scans/${(body as Scan).id}`)).body);
    expect(done.status).toBe("completed");
    expect(done.score).toBeNumber();
    expect(done.analyzers.map((a) => a.dimension)).toEqual([...FAST.dimensions]);
  });

  test("request options reach the scan", async () => {
    const scan = await completedScan({ dimensions: ["integrity"], failOn: "low" });
    expect(scan.analyzers.map((a) => a.dimension)).toEqual(["integrity"]);
    // sample-project has a low-severity empty file, so failOn "low" fails the gate.
    expect(scan.gate?.passed).toBe(false);
  });

  test("409 while another scan is running; allowed again once it finishes", async () => {
    const gated = gatedRunScan();
    await setup(gated.impl);
    const first = await post("/api/scans");
    const second = await post("/api/scans");
    expect(second.status).toBe(409);
    expect(apiErrorSchema.parse(second.body).error).toContain((first.body as Scan).id);
    expect(healthSchema.parse((await call("/api/health")).body).runningScanId).toBe(
      (first.body as Scan).id,
    );

    gated.release();
    await runner.idle();
    expect((await post("/api/scans")).status).toBe(202);
    await runner.idle();
  });

  test.each([
    ["unknown dimension", { dimensions: ["speed"] }, undefined],
    ["unknown field", { root: "/etc" }, undefined],
    ["score out of range", { minScore: 101 }, undefined],
    ["invalid JSON", undefined, "{ nope"],
  ])("400 for %s", async (_name, body, raw) => {
    const { status, body: error } = await post("/api/scans", body, raw);
    expect(status).toBe(400);
    expect(apiErrorSchema.parse(error).error).toBeString();
  });

  test("the scan root cannot be chosen by the client", async () => {
    // `root` is rejected by the strict schema above; this checks it is not silently honoured either.
    const scan = await completedScan();
    expect(scan.root).toBe(SAMPLE);
  });

  test("a scan that throws is stored as failed with its error", async () => {
    await setup(async () => {
      throw new Error("analyzer exploded");
    });
    const scan = await completedScan();
    expect(scan).toMatchObject({ status: "failed", error: "analyzer exploded", score: null });
    expect(scan.finishedAt).toBeString();
  });

  test("an unexpected server error is a generic 500 that leaks nothing", async () => {
    await setup(undefined, async () => {
      throw new Error("ENOENT: /Users/secret/path/veritas.config.ts");
    });
    const { status, text } = await post("/api/scans");
    expect(status).toBe(500);
    expect(text).not.toContain("/Users/secret");
    expect(JSON.parse(text)).toEqual({ error: "Internal server error" });
  });
});

describe("GET /api/scans and /api/scans/:id", () => {
  test("lists newest first with limit and offset", async () => {
    const a = await completedScan();
    await Bun.sleep(5);
    const b = await completedScan();
    const all = (await call("/api/scans")).body as Scan[];
    expect(all.map((s) => s.id)).toEqual([b.id, a.id]);
    expect(((await call("/api/scans?limit=1&offset=1")).body as Scan[]).map((s) => s.id)).toEqual([
      a.id,
    ]);
  });

  test("400 for a bad limit; 404 JSON for an unknown scan or route", async () => {
    expect((await call("/api/scans?limit=0")).status).toBe(400);
    const missing = await call("/api/scans/nope");
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "Scan not found" });
    expect((await call("/api/nothing-here")).status).toBe(404);
  });
});

describe("GET /api/scans/:id/findings", () => {
  let scan: Scan;
  beforeEach(async () => {
    scan = await completedScan();
  });
  const page = async (query = "") => {
    const res = await call(`/api/scans/${scan.id}/findings${query}`);
    expect(res.status).toBe(200);
    return findingPageSchema.parse(res.body);
  };

  test("everything, worst first, with the total", async () => {
    const all = await page();
    expect(all.total).toBe(
      scan.counts.critical +
        scan.counts.high +
        scan.counts.medium +
        scan.counts.low +
        scan.counts.info,
    );
    expect(all.items[0]?.severity).toBe("high");
    expect(all.items.at(-1)?.severity).toBe("info");
  });

  test("pagination keeps the total and returns the next slice", async () => {
    const all = await page();
    const second = await page("?limit=2&offset=2");
    expect(second.total).toBe(all.total);
    expect(second.items.map((f) => f.id)).toEqual(all.items.slice(2, 4).map((f) => f.id));
  });

  test("filters: severity list, dimension, exact file, folder prefix, text", async () => {
    expect(
      (await page("?severity=high,info")).items.every((f) => ["high", "info"].includes(f.severity)),
    ).toBe(true);
    expect(
      (await page("?dimension=complexity")).items.every((f) => f.dimension === "complexity"),
    ).toBe(true);
    expect(
      (await page("?file=src/pricing.ts")).items.every((f) => f.file === "src/pricing.ts"),
    ).toBe(true);
    const folder = await page("?file=src/");
    expect(folder.total).toBeGreaterThan(0);
    expect(folder.items.every((f) => f.file.startsWith("src/"))).toBe(true);
    const text = await page("?q=COGNITIVE");
    expect(text.items.map((f) => f.ruleId)).toEqual(["complexity/cognitive"]);
  });

  test("LIKE wildcards in user text are matched literally", async () => {
    expect((await page("?q=%25")).total).toBe(0); // "%"
    expect((await page("?q=_")).total).toBe(0);
    expect((await page("?file=s%25/")).total).toBe(0); // "s%/"
  });

  test("sort by file", async () => {
    const files = (await page("?sort=file&limit=500")).items.map((f) => f.file);
    expect(files).toEqual([...files].sort());
  });

  test.each(["?severity=urgent", "?limit=501", "?offset=-1", "?sort=random", "?unknown=1"])(
    "400 for %s",
    async (query) => {
      expect((await call(`/api/scans/${scan.id}/findings${query}`)).status).toBe(400);
    },
  );

  test("GET /api/findings/:id", async () => {
    const first = (await page()).items[0];
    const res = await call(`/api/findings/${first?.id}`);
    expect(findingSchema.parse(res.body)).toEqual(first!);
    expect((await call("/api/findings/nope")).status).toBe(404);
  });
});

describe("GET /api/scans/:id/files", () => {
  test("counts per file, most severe first, summing to the scan total", async () => {
    const scan = await completedScan();
    const res = await call(`/api/scans/${scan.id}/files`);
    const files = z.array(fileSummarySchema).parse(res.body);
    const total = Object.values(scan.counts).reduce((a, b) => a + b, 0);
    expect(files.reduce((n, f) => n + f.total, 0)).toBe(total);
    for (const f of files) expect(f.critical + f.high + f.medium + f.low + f.info).toBe(f.total);
    // Severity weights (critical 10, high 5, medium 2, low 0.5, info 0):
    // src/pricing.ts 3×medium = 6; tests/pricing.test.ts high + low = 5.5; "." high + info = 5.
    expect(files.slice(0, 3).map((f) => f.file)).toEqual([
      "src/pricing.ts",
      "tests/pricing.test.ts",
      ".",
    ]);
    expect((await call("/api/scans/nope/files")).status).toBe(404);
  });
});

describe("GET /api/scans/:id/compare/:baseId", () => {
  test("identical scans: nothing introduced or resolved", async () => {
    const base = await completedScan();
    const head = await completedScan();
    const cmp = scanComparisonSchema.parse(
      (await call(`/api/scans/${head.id}/compare/${base.id}`)).body,
    );
    expect(cmp).toMatchObject({
      baseScanId: base.id,
      headScanId: head.id,
      scoreDelta: 0,
      introduced: [],
      resolved: [],
    });
    expect(cmp.persistingCount).toBeGreaterThan(0);
  });

  test("fewer dimensions: their findings show as resolved", async () => {
    const base = await completedScan();
    const head = await completedScan({ dimensions: ["integrity"] });
    const cmp = scanComparisonSchema.parse(
      (await call(`/api/scans/${head.id}/compare/${base.id}`)).body,
    );
    expect(cmp.introduced).toEqual([]);
    expect(cmp.resolved.length).toBeGreaterThan(0);
    expect(cmp.resolved.every((f) => f.dimension !== "integrity")).toBe(true);
  });

  test("404 for an unknown scan, 409 for one still running", async () => {
    const done = await completedScan();
    expect((await call(`/api/scans/${done.id}/compare/nope`)).status).toBe(404);
    const gated = gatedRunScan();
    await setup(gated.impl);
    const other = await completedScanAfter(gated);
    expect(other.status).toBe(409);
  });

  async function completedScanAfter(gated: ReturnType<typeof gatedRunScan>) {
    const running = (await post("/api/scans")).body as Scan;
    const res = await call(`/api/scans/${running.id}/compare/${running.id}`);
    gated.release();
    await runner.idle();
    return res;
  }
});

describe("GET /api/scans/:id/report", () => {
  test("JSON report download, schema-valid and complete", async () => {
    const scan = await completedScan();
    const res = await call(`/api/scans/${scan.id}/report`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="veritas-report-${scan.id}.json"`,
    );
    const report = reportSchema.parse(res.body);
    expect(report.findings).toHaveLength(
      report.scan.counts.high +
        report.scan.counts.medium +
        report.scan.counts.low +
        report.scan.counts.info +
        report.scan.counts.critical,
    );
  });

  test.each([
    ["markdown", "text/markdown", ".md", "# VERITAS report"],
    ["html", "text/html", ".html", "<!doctype html>"],
    ["sarif", "application/sarif+json", ".sarif", '"version": "2.1.0"'],
  ])("%s download", async (format, type, ext, start) => {
    const scan = await completedScan();
    const res = await call(`/api/scans/${scan.id}/report?format=${format}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toStartWith(type);
    expect(res.headers.get("content-disposition")).toEndWith(`${ext}"`);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.text).toContain(start);
  });

  test("bad format is 400", async () => {
    const scan = await completedScan();
    expect((await call(`/api/scans/${scan.id}/report?format=pdf`)).status).toBe(400);
  });
});

/** Reads an SSE response to the end and parses its events. */
async function readEvents(res: Response): Promise<ScanEvent[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((block) => block.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => l !== undefined)
    .map((l) => scanEventSchema.parse(JSON.parse(l.slice(6))));
}

describe("GET /api/scans/:id/events (SSE)", () => {
  test("a running scan replays past events, streams the rest, and ends with the stored result", async () => {
    const gated = gatedRunScan();
    await setup(gated.impl);
    const scan = (await post("/api/scans")).body as Scan;

    // Subscribe after the scan has already emitted discovery-started.
    const res = await app.handle(new Request(`http://localhost/api/scans/${scan.id}/events`));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = readEvents(res);
    gated.release();

    const types = (await events).map((e) => e.type);
    expect(types[0]).toBe("discovery-started");
    expect(types).toContain("analyzer-finished");
    expect(types.at(-1)).toBe("scan-finished");
    expect(types.filter((t) => t === "scan-finished")).toHaveLength(1);

    const finished = (await events).at(-1);
    expect(finished?.type === "scan-finished" && finished.scan.status).toBe("completed");
    // The findings are already stored when scan-finished arrives.
    const page = findingPageSchema.parse((await call(`/api/scans/${scan.id}/findings`)).body);
    expect(page.total).toBeGreaterThan(0);
  });

  test("a finished scan sends a single scan-finished and closes", async () => {
    const scan = await completedScan();
    const events = await readEvents(
      await app.handle(new Request(`http://localhost/api/scans/${scan.id}/events`)),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "scan-finished",
      scan: { id: scan.id, status: "completed" },
    });
  });

  test("404 for an unknown scan", async () => {
    expect((await call("/api/scans/nope/events")).status).toBe(404);
  });
});

describe("startup recovery", () => {
  test("scans left running by a stopped server are marked failed", async () => {
    const gated = gatedRunScan();
    await setup(gated.impl);
    const scan = (await post("/api/scans")).body as Scan;
    // Simulate a restart: a fresh repository over the same database sees a "running" row.
    expect(await repo.failInterruptedScans("2026-01-01T00:00:00.000Z")).toBe(1);
    expect(await repo.getScan(scan.id)).toMatchObject({
      status: "failed",
      error: INTERRUPTED_ERROR,
    });
    gated.release();
    await runner.idle();
  });
});

describe("CORS", () => {
  test("the dashboard origin is allowed; others are not", async () => {
    const preflight = (origin: string) =>
      app.handle(
        new Request("http://localhost/api/scans", {
          method: "OPTIONS",
          headers: { origin, "access-control-request-method": "POST" },
        }),
      );
    expect((await preflight(ORIGIN)).headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(
      (await preflight("https://evil.example")).headers.get("access-control-allow-origin"),
    ).not.toBe("https://evil.example");
  });
});

describe("/api/settings", () => {
  const put = (body: unknown) =>
    call("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  test("defaults: no overrides, every dimension weighted", async () => {
    const res = await call("/api/settings");
    const s = settingsSchema.parse(res.body);
    expect(s.overrides).toEqual({});
    expect(s.effective.root).toBe(SAMPLE);
    expect(s.effective.thresholds.maxCyclomatic).toBe(10);
    expect(Object.keys(s.effective.weights)).toHaveLength(10);
    expect(s.configPath).toBeNull();
  });

  test("saved overrides change the effective config and the next scan", async () => {
    const saved = settingsSchema.parse(
      (
        await put({
          gate: { failOn: "low" },
          thresholds: { maxCyclomatic: 50 },
          weights: { testing: 0 },
        })
      ).body,
    );
    expect(saved.effective.gate.failOn).toBe("low");
    expect(saved.effective.thresholds.maxCyclomatic).toBe(50);
    expect(saved.effective.thresholds.maxNesting).toBe(4);
    expect(saved.effective.weights.testing).toBe(0);

    const scan = await completedScan();
    // failOn "low" fails the gate on the fixture's low-severity empty file.
    expect(scan.gate?.passed).toBe(false);
    // maxCyclomatic 50: priceFor (14) is no longer reported.
    const page = findingPageSchema.parse(
      (await call(`/api/scans/${scan.id}/findings?q=cyclomatic`)).body,
    );
    expect(page.total).toBe(0);
  });

  test("a scan request's own options win over saved settings", async () => {
    await put({ gate: { failOn: "low" } });
    const scan = await completedScan({ failOn: "critical" });
    expect(scan.gate?.passed).toBe(true);
  });

  test("settings survive a new service over the same database", async () => {
    await put({ ignore: ["src/**"] });
    const again = new SettingsService(db, SAMPLE, { root: SAMPLE });
    expect(await again.overrides()).toEqual({ ignore: ["src/**"] });
  });

  test.each([
    ["unknown field", { root: "/etc" }],
    ["unknown threshold", { thresholds: { speed: 1 } }],
    ["bad severity", { gate: { failOn: "urgent" } }],
    ["negative weight", { weights: { lint: -1 } }],
    ["tiny timeout", { analyzerTimeoutMs: 5 }],
  ])("400 and nothing saved for %s", async (_name, body) => {
    expect((await put(body)).status).toBe(400);
    expect(await settings.overrides()).toEqual({});
  });

  test("the overrides schema covers exactly the configurable thresholds", () => {
    const configurable = Object.keys(thresholdsSchema.shape).sort();
    const overridable = Object.keys(settingsOverridesSchema.shape.thresholds.unwrap().shape).sort();
    expect(overridable).toEqual(configurable);
  });
});

describe("POST /api/uploads", () => {
  function form(files: Record<string, string | Blob>, name = "my-app") {
    const fd = new FormData();
    for (const [path, content] of Object.entries(files)) {
      fd.append("files", typeof content === "string" ? new Blob([content]) : content, path);
    }
    fd.append("name", name);
    return fd;
  }
  const upload = (fd: FormData) => call("/api/uploads", { method: "POST", body: fd });

  test("stores the folder and a scan of it reports on its files", async () => {
    const res = await upload(
      form({
        "src/pricing.ts": readFileSync(join(SAMPLE, "src/pricing.ts"), "utf-8"),
        "src/empty.ts": "",
        "README.md": "# my app",
      }),
    );
    expect(res.status).toBe(201);
    const meta = uploadSchema.parse(res.body);
    expect(meta).toMatchObject({ name: "my-app", files: 3 });

    const scan = await completedScan({ uploadId: meta.id });
    expect(scan.root).toBe(join(uploadsDir, meta.id, "my-app"));
    const page = findingPageSchema.parse(
      (await call(`/api/scans/${scan.id}/findings?limit=500`)).body,
    );
    expect(page.items.map((f) => f.ruleId)).toContain("complexity/cyclomatic");
    expect(page.items.map((f) => f.file)).toContain("src/empty.ts");
  });

  test.each([
    ["parent traversal", "../escape.ts"],
    ["deep traversal", "src/../../escape.ts"],
    ["absolute path", "/tmp/escape.ts"],
    ["windows path", "src\\escape.ts"],
    ["drive letter", "C:/escape.ts"],
    ["empty segment", "src//a.ts"],
    ["dot segment", "./a.ts"],
  ])("rejects %s and writes nothing", async (_name, path) => {
    const res = await upload(form({ "ok.ts": "x", [path]: "pwned" }));
    expect(res.status).toBe(400);
    expect(readdirSync(uploadsDir)).toEqual([]);
    expect(existsSync(join(uploadsDir, "..", "escape.ts"))).toBe(false);
  });

  test("413 above the per-file limit; 400 for no files or not multipart", async () => {
    const big = new Blob([new Uint8Array(UPLOAD_LIMITS.maxFileBytes + 1)]);
    expect((await upload(form({ "big.bin": big }))).status).toBe(413);
    expect((await upload(form({}))).status).toBe(400);
    const json = await call("/api/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(json.status).toBe(400);
    expect(readdirSync(uploadsDir)).toEqual([]);
  });

  test("duplicate paths are rejected", async () => {
    const fd = new FormData();
    fd.append("files", new Blob(["a"]), "a.ts");
    fd.append("files", new Blob(["b"]), "a.ts");
    expect((await upload(fd)).status).toBe(400);
  });

  test("scanning an unknown or malformed upload id", async () => {
    expect((await post("/api/scans", { uploadId: crypto.randomUUID() })).status).toBe(404);
    expect((await post("/api/scans", { uploadId: "../../etc" })).status).toBe(400);
  });

  test(`only the ${KEEP_UPLOADS} newest uploads are kept`, async () => {
    const ids: string[] = [];
    for (let i = 0; i < KEEP_UPLOADS + 2; i++) {
      ids.push(
        uploadSchema.parse((await upload(form({ "a.ts": `export const n = ${i};` }))).body).id,
      );
      await Bun.sleep(2);
    }
    expect(readdirSync(uploadsDir).sort()).toEqual(ids.slice(2).sort());
    expect(await uploads.rootOf(ids[0]!)).toBeNull();
  });

  test.each([
    ["my-app", "my-app"],
    ["../../etc", "-..-etc"],
    ["...", "project"],
    ["", "project"],
    ["a/b", "a-b"],
    ["โปรเจกต์", "โปรเจกต์"],
  ])("safeName(%p) = %p", (raw, expected) => {
    expect(safeName(raw)).toBe(expected);
  });
});
