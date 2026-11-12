import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reportSchema } from "@veritas/shared";
import { FIXTURES } from "../helpers";

const CLI = join(import.meta.dir, "../../src/cli.ts");
const SAMPLE = join(FIXTURES, "sample-project");
const CLEAN = join(FIXTURES, "clean-project");
const out = mkdtempSync(join(tmpdir(), "veritas-cli-"));

afterAll(() => rmSync(out, { recursive: true, force: true }));

/** Runs the CLI from an empty directory so no veritas.config.ts is picked up. */
async function cli(...args: string[]) {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    cwd: out,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("veritas CLI", () => {
  test("scan passes the default gate and prints a summary", async () => {
    const { code, stdout } = await cli("scan", "--root", SAMPLE);
    expect(code).toBe(0);
    expect(stdout).toContain("Gate     PASSED");
    expect(stdout).toContain("Complexity");
    expect(stdout).toContain("testing/focused-test");
    expect(stdout).not.toContain("\x1b[");
  });

  test("--fail-on high fails the gate with exit code 1", async () => {
    const { code, stdout } = await cli("scan", "--root", SAMPLE, "--fail-on", "high");
    expect(code).toBe(1);
    expect(stdout).toContain('FAILED  2 finding(s) at or above "high" severity');
  });

  test("--min-score fails a scan below it", async () => {
    const { code } = await cli("scan", "--root", SAMPLE, "--min-score", "99");
    expect(code).toBe(1);
  });

  test("--json writes a schema-valid report", async () => {
    const path = join(out, "nested/report.json");
    const { code } = await cli("scan", "--root", CLEAN, "--json", path, "--top", "0");
    expect(code).toBe(0);
    const report = reportSchema.parse(JSON.parse(readFileSync(path, "utf-8")));
    expect(report.scan.score).toBe(100);
  });

  test("--report writes every format by extension, alongside --json", async () => {
    const paths = ["r/out.json", "r/out.md", "r/out.html", "r/out.sarif"].map((p) => join(out, p));
    const [json, md, html, sarif] = paths as [string, string, string, string];
    const { code, stdout } = await cli(
      "scan",
      "--root",
      SAMPLE,
      "--top",
      "0",
      "--json",
      json,
      "--report",
      md,
      "--report",
      html,
      "--report",
      sarif,
    );
    expect(code).toBe(0);
    expect(
      reportSchema.parse(JSON.parse(readFileSync(json, "utf-8"))).findings.length,
    ).toBeGreaterThan(0);
    expect(readFileSync(md, "utf-8")).toStartWith("# VERITAS report");
    expect(readFileSync(html, "utf-8")).toStartWith("<!doctype html>");
    expect(JSON.parse(readFileSync(sarif, "utf-8")).version).toBe("2.1.0");
    expect(stdout).toContain("SARIF report written to");
  }, 60_000);

  test("an unknown report extension is rejected before scanning", async () => {
    const { code, stderr } = await cli("scan", "--root", SAMPLE, "--report", join(out, "x.pdf"));
    expect(code).toBe(2);
    expect(stderr).toContain("Unknown report extension");
  });

  test("--dimensions limits what runs", async () => {
    const { stdout } = await cli("scan", "--root", SAMPLE, "--dimensions", "integrity");
    expect(stdout).toContain("Integrity");
    expect(stdout).not.toContain("Complexity");
  });

  test.each([
    [["scan", "--root", "/definitely/not/here"], /Scan root does not exist/],
    [["scan", "--root", SAMPLE, "--fail-on", "urgent"], /failOn/],
    [["scan", "--root", SAMPLE, "--dimensions", "speed"], /dimensions/],
    [["scan", "--bogus"], /Unknown option/],
    [["deploy"], /Unknown command/],
    [[], /Usage: veritas scan/],
  ])("usage and config errors exit with 2: %p", async (args, message) => {
    const { code, stdout, stderr } = await cli(...args);
    expect(code).toBe(2);
    expect(stdout + stderr).toMatch(message);
  });

  test("--help and --version exit 0", async () => {
    expect((await cli("--help")).code).toBe(0);
    expect((await cli("--version")).stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
