import { describe, expect, test } from "bun:test";
import type { Finding, Report, Scan } from "@veritas/shared";
import { esc, renderHtmlReport } from "../../src/reports/html-report";
import { renderMarkdownReport } from "../../src/reports/markdown-report";
import { formatForPath, renderReport } from "../../src/reports/render-report";
import { renderSarifReport, type SarifLog } from "../../src/reports/sarif-report";

const scan: Scan = {
  id: "s1",
  status: "completed",
  root: "/work/my app",
  startedAt: "2026-11-12T00:00:00.000Z",
  finishedAt: "2026-11-12T00:00:05.000Z",
  error: null,
  stats: {
    files: 3,
    lines: 120,
    bytes: 4000,
    byLanguage: { typescript: { files: 3, lines: 120 } },
  },
  analyzers: [
    { dimension: "security", status: "completed", durationMs: 10, findingCount: 2 },
    {
      dimension: "lint",
      status: "skipped",
      durationMs: 0,
      findingCount: 0,
      reason: "biome | not <installed>",
    },
  ],
  dimensions: [
    {
      dimension: "security",
      score: 70,
      grade: "C",
      counts: { critical: 1, high: 1, medium: 0, low: 0, info: 0 },
    },
    {
      dimension: "lint",
      score: null,
      grade: null,
      counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    },
  ],
  score: 70,
  grade: "C",
  gate: { passed: false, reasons: ['1 finding(s) at or above "critical" severity'] },
  counts: { critical: 1, high: 1, medium: 0, low: 0, info: 0 },
};

/** Content an attacker controls: everything below comes from the scanned code or tools. */
const hostile: Finding = {
  id: "s1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  dimension: "security",
  severity: "critical",
  ruleId: "x/<img src=x onerror=alert(1)>",
  message: "<script>alert('xss')</script> | **bold** [link](javascript:alert(1))",
  file: "src/<evil>.ts",
  language: "typescript",
  startLine: 7,
  endLine: 8,
  snippet: "const a = `</pre><script>alert(1)</script>`;\n```\nclosing fence attempt",
  suggestion: "Use <b>safe</b> APIs",
  source: "semgrep",
  helpUrl: "https://semgrep.dev/r/x",
};

const projectLevel: Finding = {
  ...hostile,
  id: "s1-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  fingerprint: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  severity: "high",
  ruleId: "testing/no-tests",
  message: "No tests.",
  file: ".",
  startLine: undefined,
  endLine: undefined,
  snippet: undefined,
  suggestion: undefined,
  helpUrl: undefined,
};

const report: Report = {
  schemaVersion: 1,
  veritasVersion: "0.1.0",
  generatedAt: "2026-11-12T00:00:06.000Z",
  scan,
  findings: [hostile, projectLevel],
};

describe("HTML report", () => {
  const html = renderHtmlReport(report);

  test("no markup from the scanned code survives", () => {
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<evil>");
    expect(html).not.toContain("<b>safe</b>");
    expect(html).toContain("&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;");
    expect(html).toContain("&lt;/pre&gt;&lt;script&gt;");
  });

  test("self-contained: CSP forbids scripts and remote loads; no external URLs except rule links", () => {
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`);
    // Escaped text such as "&lt;img src=x" is fine; real tags are not.
    expect(html).not.toMatch(/<(script|img|link|iframe|object|embed)\b|\ssrc="/i);
  });

  test("only http(s) help links become anchors", () => {
    expect(html).toContain('href="https://semgrep.dev/r/x"');
    const js = renderHtmlReport({
      ...report,
      findings: [{ ...hostile, helpUrl: "javascript:alert(1)" }],
    });
    expect(js).not.toContain('javascript:alert(1)"');
    expect(js).not.toMatch(/href="javascript:/i);
  });

  test("shows real line numbers and the summary", () => {
    expect(html).toContain('<span class="ln">7</span>');
    expect(html).toContain('<span class="ln">8</span>');
    expect(html).toContain("ไม่ผ่านเกณฑ์");
    expect(html).toContain("ทั้งโปรเจกต์");
  });

  test.each([
    ["<", "&lt;"],
    [">", "&gt;"],
    ["&", "&amp;"],
    ['"', "&quot;"],
    ["'", "&#39;"],
  ])("esc(%p)", (input, output) => {
    expect(esc(input)).toBe(output);
  });
});

describe("Markdown report", () => {
  const md = renderMarkdownReport(report);

  test("text from the code cannot inject HTML, links or table cells", () => {
    // Code blocks and inline code render literally, so only text outside them can inject.
    const outsideCode = md.replace(/^\s*(`{3,})[\s\S]*?^\s*\1\s*$/gm, "").replace(/`[^`\n]*`/g, "");
    // An escaped "\\<" renders as a literal "<"; only an unescaped one starts a tag.
    expect(outsideCode).not.toMatch(/(?<!\\)<(script|img|b)\b/i);
    expect(md).toContain("\\<script\\>");
    expect(md).not.toContain("](javascript:");
    // The pipe in a skipped dimension's reason is escaped, so the table keeps 8 columns.
    const lintRow = md.split("\n").find((l) => l.startsWith("| Lint |"));
    expect(lintRow?.split(/(?<!\\)\|/).length).toBe(10);
  });

  test("snippet fence is longer than any backtick run inside it", () => {
    const fenceLines = md.split("\n").filter((l) => /^\s*`{4,}\s*$/.test(l));
    expect(fenceLines).toHaveLength(2);
  });

  test("project-level findings and the gate are reported", () => {
    expect(md).toContain("`project`");
    expect(md).toContain("❌ failed");
    expect(md).toContain("### Critical (1)");
  });

  test("javascript: help links are dropped", () => {
    const out = renderMarkdownReport({
      ...report,
      findings: [{ ...hostile, helpUrl: "javascript:alert(1)" }],
    });
    expect(out).not.toContain("Rule documentation");
  });
});

describe("SARIF report", () => {
  const sarif = JSON.parse(renderSarifReport(report)) as SarifLog;
  const run = sarif.runs[0]!;

  test("valid 2.1.0 shape with one rule per rule id", () => {
    expect(sarif.version).toBe("2.1.0");
    expect(run.tool.driver.name).toBe("VERITAS");
    expect(run.tool.driver.rules.map((r) => r.id)).toEqual([hostile.ruleId, "testing/no-tests"]);
    expect(run.results.map((r) => r.ruleIndex)).toEqual([0, 1]);
  });

  test("severity maps to SARIF level; fingerprints track alerts across commits", () => {
    expect(run.results.map((r) => r.level)).toEqual(["error", "error"]);
    expect(run.results[0]?.partialFingerprints).toEqual({ "veritas/v1": hostile.fingerprint });
  });

  test("file locations are relative to SRCROOT and URI-encoded; project findings have none", () => {
    expect(run.originalUriBaseIds.SRCROOT?.uri).toBe("file:///work/my%20app/");
    expect(run.results[0]?.locations?.[0]?.physicalLocation).toEqual({
      artifactLocation: { uri: "src/%3Cevil%3E.ts", uriBaseId: "SRCROOT" },
      region: { startLine: 7, endLine: 8 },
    });
    expect(run.results[1]?.locations).toBeUndefined();
  });
});

describe("renderReport / formatForPath", () => {
  test.each([
    ["out/report.json", "json"],
    ["report.MD", "markdown"],
    ["r.markdown", "markdown"],
    ["r.html", "html"],
    ["r.htm", "html"],
    ["r.sarif", "sarif"],
    ["r.pdf", null],
    ["noext", null],
  ] as const)("%p -> %p", (path, format) => {
    expect(formatForPath(path)).toBe(format);
  });

  test("every format renders with its content type", () => {
    for (const format of ["json", "markdown", "html", "sarif"] as const) {
      const out = renderReport(report, format);
      expect(out.body.length).toBeGreaterThan(100);
      expect(out.contentType).toContain("charset=utf-8");
    }
    expect(JSON.parse(renderReport(report, "json").body)).toEqual(report);
  });
});
