import { describe, expect, test } from "bun:test";
import { parseBiome } from "../../src/engine/adapters/biome.adapter";
import { parseGitleaks } from "../../src/engine/adapters/gitleaks.adapter";
import { parseJscpd } from "../../src/engine/adapters/jscpd.adapter";
import { parseOsvScanner } from "../../src/engine/adapters/osv-scanner.adapter";
import { parsePyright } from "../../src/engine/adapters/pyright.adapter";
import { parseRuff } from "../../src/engine/adapters/ruff.adapter";
import { createScanPathMapper } from "../../src/engine/adapters/scan-path";
import { parseSemgrep } from "../../src/engine/adapters/semgrep.adapter";
import { cvssSeverity } from "../../src/engine/analyzers/dependencies/dependencies.analyzer";
import { asPathArgs, chunkByLength } from "../../src/lib/chunk";

const ROOT = "/scan/root";

describe("createScanPathMapper", () => {
  const map = createScanPathMapper(ROOT);
  test.each([
    ["/scan/root/src/a.ts", "src/a.ts"],
    ["src/a.ts", "src/a.ts"],
    ["./src/a.ts", "src/a.ts"],
    ["/scan/root", null],
    ["/elsewhere/a.ts", null],
    ["../outside.ts", null],
  ])("%p -> %p", (input, expected) => {
    expect(map(input)).toBe(expected);
  });
});

describe("chunk helpers", () => {
  test("chunks stay under the limit and keep every path in order", () => {
    const paths = Array.from({ length: 50 }, (_, i) => `src/file-${i}.ts`);
    const chunks = chunkByLength(paths, 100);
    expect(chunks.flat()).toEqual(paths);
    for (const c of chunks) expect(c.join(" ").length).toBeLessThanOrEqual(100);
  });

  test("paths that look like options cannot be read as options", () => {
    expect(asPathArgs(["-rf.ts", "--config.py", "/abs/x.ts"])).toEqual([
      "./-rf.ts",
      "./--config.py",
      "/abs/x.ts",
    ]);
  });
});

describe("parseBiome", () => {
  const diag = (category: string, severity = "error", path = "src/a.ts") => ({
    severity,
    message: "m",
    category,
    location: { path, start: { line: 3, column: 1 }, end: { line: 4, column: 2 } },
  });
  const run = (...diagnostics: object[]) => parseBiome(JSON.stringify({ diagnostics }), ROOT);

  test("bug-prone groups are medium, others low, info stays info", () => {
    const findings = run(
      diag("lint/suspicious/noDebugger"),
      diag("lint/correctness/noUnusedVariables", "warning"),
      diag("lint/style/useConst"),
      diag("lint/complexity/useOptionalChain", "info"),
    );
    expect(findings.map((f) => f.severity)).toEqual(["medium", "medium", "low", "info"]);
    expect(findings[0]).toMatchObject({
      ruleId: "lint/suspicious/noDebugger",
      startLine: 3,
      endLine: 4,
      helpUrl: "https://biomejs.dev/linter/rules/no-debugger/",
    });
  });

  test("syntax errors and files outside the root are dropped", () => {
    expect(run(diag("parse"), diag("lint/style/useConst", "error", "/other/x.ts"))).toEqual([]);
  });
});

describe("parseRuff", () => {
  const item = (code: string | null, row = 2) => ({
    code,
    message: "m",
    filename: `${ROOT}/app/x.py`,
    location: { row, column: 1 },
    end_location: { row, column: 5 },
    url: "https://docs.astral.sh/ruff/rules/x",
  });

  test("bug rules are medium; FBT/FURB are not mistaken for F", () => {
    const findings = parseRuff(
      JSON.stringify([
        item("F401"),
        item("B006"),
        item("E902"),
        item("FBT001"),
        item("FURB101"),
        item("SIM108"),
      ]),
      ROOT,
    );
    expect(findings.map((f) => [f.ruleId, f.severity])).toEqual([
      ["ruff/F401", "medium"],
      ["ruff/B006", "medium"],
      ["ruff/E902", "medium"],
      ["ruff/FBT001", "low"],
      ["ruff/FURB101", "low"],
      ["ruff/SIM108", "low"],
    ]);
    expect(findings[0]).toMatchObject({ file: "app/x.py", startLine: 2 });
  });

  test("syntax errors (null code) are left to correctness", () => {
    expect(parseRuff(JSON.stringify([item(null)]), ROOT)).toEqual([]);
  });
});

describe("parsePyright", () => {
  const diag = (rule: string | undefined, severity = "error") => ({
    file: `${ROOT}/app/x.py`,
    severity,
    message: "m",
    ...(rule && { rule }),
    range: { start: { line: 4, character: 0 }, end: { line: 5, character: 1 } },
  });

  test("0-based lines become 1-based; severities map down one level", () => {
    const findings = parsePyright(
      JSON.stringify({
        generalDiagnostics: [
          diag("reportAssignmentType"),
          diag("reportOptionalMemberAccess", "warning"),
        ],
      }),
      ROOT,
    );
    expect(findings.map((f) => [f.ruleId, f.severity, f.startLine, f.endLine])).toEqual([
      ["pyright/reportAssignmentType", "medium", 5, 6],
      ["pyright/reportOptionalMemberAccess", "low", 5, 6],
    ]);
  });

  test("missing-dependency rules and rule-less syntax errors are dropped", () => {
    const findings = parsePyright(
      JSON.stringify({
        generalDiagnostics: [
          diag("reportMissingImports"),
          diag("reportMissingModuleSource", "warning"),
          diag(undefined),
        ],
      }),
      ROOT,
    );
    expect(findings).toEqual([]);
  });
});

describe("parseJscpd", () => {
  test("maps absolute paths and keeps statistics", () => {
    const report = parseJscpd(
      JSON.stringify({
        duplicates: [
          {
            lines: 12,
            firstFile: { name: `${ROOT}/src/a.ts`, start: 1, end: 12 },
            secondFile: { name: `${ROOT}/src/deep/a.ts`, start: 5, end: 16 },
          },
          {
            lines: 9,
            firstFile: { name: "/elsewhere/x.ts", start: 1, end: 9 },
            secondFile: { name: `${ROOT}/src/b.ts`, start: 1, end: 9 },
          },
        ],
        statistics: { total: { lines: 200, duplicatedLines: 24, percentage: 12 } },
      }),
      ROOT,
    );
    expect(report.blocks).toEqual([
      {
        lines: 12,
        original: { file: "src/a.ts", start: 1, end: 12 },
        copy: { file: "src/deep/a.ts", start: 5, end: 16 },
      },
    ]);
    expect(report).toMatchObject({ percentage: 12, duplicatedLines: 24, totalLines: 200 });
  });
});

describe("parseSemgrep", () => {
  const result = (checkId: string, severity = "ERROR") => ({
    check_id: checkId,
    path: "app/x.py",
    start: { line: 4 },
    end: { line: 4 },
    extra: {
      message: "Found shell=True. ",
      severity,
      metadata: {
        cwe: ["CWE-78: OS Command Injection"],
        "source-rule-url": "https://semgrep.dev/r/x",
      },
    },
  });

  test("severity, shortened rule id, CWE in the message, help URL", () => {
    const [f] = parseSemgrep(
      JSON.stringify({
        results: [result("python.lang.security.audit.shell-true.shell-true")],
        errors: [],
      }),
      ROOT,
    );
    expect(f).toMatchObject({
      severity: "high",
      ruleId: "semgrep/python.lang.security.audit.shell-true",
      message: "Found shell=True. (CWE-78)",
      startLine: 4,
      helpUrl: "https://semgrep.dev/r/x",
    });
  });

  test("secret rules are left to the secrets dimension", () => {
    const out = parseSemgrep(
      JSON.stringify({
        results: [result("generic.secrets.security.detected-aws-key.detected-aws-key")],
        errors: [],
      }),
      ROOT,
    );
    expect(out).toEqual([]);
  });

  test("WARNING is medium and INFO is low", () => {
    const out = parseSemgrep(
      JSON.stringify({ results: [result("a.b", "WARNING"), result("a.c", "INFO")], errors: [] }),
      ROOT,
    );
    expect(out.map((f) => f.severity)).toEqual(["medium", "low"]);
  });
});

describe("parseGitleaks", () => {
  const leak = (Match: string) => ({
    RuleID: "github-pat",
    Description: "Uncovered a GitHub Personal Access Token",
    StartLine: 2,
    EndLine: 2,
    Match,
    File: "app/config.py",
  });

  test("every leak is critical and keeps Gitleaks' redacted match as the snippet", () => {
    const [f] = parseGitleaks(JSON.stringify([leak('token = "REDACTED"')]), ROOT);
    expect(f).toMatchObject({
      severity: "critical",
      ruleId: "gitleaks/github-pat",
      startLine: 2,
      snippet: 'token = "REDACTED"',
    });
  });

  test("an unredacted match never reaches the snippet", () => {
    const [f] = parseGitleaks(JSON.stringify([leak("unredacted-secret-value")]), ROOT);
    expect(f?.snippet).toBe("[secret redacted]");
  });

  test("empty output means no leaks", () => {
    expect(parseGitleaks("", ROOT)).toEqual([]);
  });
});

describe("parseOsvScanner", () => {
  const output = {
    results: [
      {
        source: { path: `${ROOT}/requirements.txt`, type: "lockfile" },
        packages: [
          {
            package: { name: "flask", version: "0.12.0", ecosystem: "PyPI" },
            vulnerabilities: [
              {
                id: "PYSEC-2018-66",
                summary: "DoS via JSON",
                affected: [
                  {
                    package: { name: "flask", ecosystem: "PyPI" },
                    ranges: [{ events: [{ introduced: "0" }, { fixed: "0.12.3" }] }],
                  },
                ],
              },
            ],
            groups: [
              {
                ids: ["PYSEC-2018-66", "GHSA-562c"],
                aliases: ["CVE-2018-1000656"],
                max_severity: "8.7",
              },
            ],
          },
          {
            package: { name: "clean", version: "1.0.0", ecosystem: "PyPI" },
            vulnerabilities: [],
            groups: [],
          },
        ],
      },
      {
        source: { path: `${ROOT}/requirements.txt`, type: "unknown" },
        packages: [
          {
            package: { name: "urllib3", version: "1.23.0", ecosystem: "PyPI" },
            vulnerabilities: [{ id: "PYSEC-2019-133" }],
            groups: [{ ids: ["PYSEC-2019-133"], max_severity: "" }],
          },
        ],
      },
    ],
  };

  test("groups aliases, extracts fixed versions, marks resolved packages as transitive", () => {
    const pkgs = parseOsvScanner(JSON.stringify(output), ROOT);
    expect(pkgs).toHaveLength(2);
    expect(pkgs[0]).toMatchObject({ file: "requirements.txt", transitive: false, name: "flask" });
    expect(pkgs[0]?.vulnerabilities[0]).toEqual({
      id: "PYSEC-2018-66",
      aliases: ["GHSA-562c", "CVE-2018-1000656"],
      summary: "DoS via JSON",
      cvss: 8.7,
      fixedVersions: ["0.12.3"],
    });
    expect(pkgs[1]).toMatchObject({ name: "urllib3", transitive: true });
    expect(pkgs[1]?.vulnerabilities[0]?.cvss).toBeNull();
  });

  test("null results (nothing vulnerable) parse to nothing", () => {
    expect(parseOsvScanner(JSON.stringify({ results: null }), ROOT)).toEqual([]);
  });

  test.each([
    [9.8, "critical"],
    [9, "critical"],
    [7.5, "high"],
    [4, "medium"],
    [3.9, "low"],
    [null, "medium"],
  ] as const)("CVSS %p -> %p", (score, severity) => {
    expect(cvssSeverity(score)).toBe(severity);
  });
});
