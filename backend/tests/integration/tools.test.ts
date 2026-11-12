import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findTool } from "../../src/engine/adapters/tools";
import { SECRET_LINE_PLACEHOLDER } from "../../src/engine/normalize/normalize-findings";
import { runScan } from "../../src/engine/pipeline";
import { buildReport } from "../../src/reports/json-report";
import { configFor, tempTree } from "../helpers";

/**
 * End-to-end runs of the real external tools. Each block is skipped when its tool is
 * not installed. Secrets are generated at test time: committing realistic tokens would
 * trip GitHub push protection and teach scanners to ignore this repository.
 */

function randomToken(
  length: number,
  alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

describe.skipIf(!findTool("gitleaks"))("secrets (gitleaks)", () => {
  const githubToken = `ghp_${randomToken(36)}`;
  let tree: ReturnType<typeof tempTree>;

  beforeAll(() => {
    tree = tempTree({
      "README.md": "# app",
      // The token line also trips a lint rule (unused variable), so another analyzer
      // reports on the same line and would copy it into a snippet without redaction.
      "src/config.ts": `export const ok = 1;\nconst githubToken = "${githubToken}";\n`,
      "node_modules/pkg/leak.js": `const t = "ghp_${randomToken(36)}";\n`,
    });
  });
  afterAll(() => tree.cleanup());

  test("finds the leak as critical, fails the gate, and never prints the secret", async () => {
    const outcome = await runScan(configFor(tree.dir, { dimensions: ["secrets", "lint"] }));
    const leaks = outcome.findings.filter((f) => f.dimension === "secrets");

    expect(leaks.map((f) => [f.ruleId, f.file, f.startLine, f.severity])).toEqual([
      ["gitleaks/github-pat", "src/config.ts", 2, "critical"],
    ]);
    expect(outcome.scan.gate?.passed).toBe(false);

    const lintOnSecretLine = outcome.findings.find(
      (f) => f.dimension === "lint" && f.startLine === 2,
    );
    expect(lintOnSecretLine?.snippet).toBe(SECRET_LINE_PLACEHOLDER);

    const report = JSON.stringify(buildReport(outcome));
    expect(report).not.toContain(githubToken);
    expect(report).not.toContain(githubToken.slice(4, 20));
  }, 60_000);

  test("leaks inside ignored folders such as node_modules are not reported", async () => {
    const { findings } = await runScan(configFor(tree.dir, { dimensions: ["secrets"] }));
    expect(findings.some((f) => f.file.startsWith("node_modules/"))).toBe(false);
  }, 60_000);
});

describe.skipIf(!findTool("ruff"))("lint (ruff)", () => {
  test("Python lint uses the default rule set without a project config", async () => {
    const tree = tempTree({ "app.py": "import os\n\ndef f(x=[]):\n    return undefined\n" });
    try {
      const { findings } = await runScan(configFor(tree.dir, { dimensions: ["lint"] }));
      expect(findings.map((f) => f.ruleId).sort()).toEqual(["ruff/B006", "ruff/F401", "ruff/F821"]);
    } finally {
      tree.cleanup();
    }
  }, 60_000);
});

describe("duplication (jscpd, bundled)", () => {
  test("a copied block is reported in the copy, pointing at the original", async () => {
    const block = Array.from(
      { length: 12 },
      (_, i) => `  total += values[${i}] * weights[${i}] + offsets[${i}];`,
    ).join("\n");
    const fn = (name: string) =>
      `export function ${name}(values: number[], weights: number[], offsets: number[]) {\n  let total = 0;\n${block}\n  return total;\n}\n`;
    const tree = tempTree({ "src/a.ts": fn("first"), "src/b.ts": fn("second") });
    try {
      const { findings } = await runScan(configFor(tree.dir, { dimensions: ["duplication"] }));
      const blocks = findings.filter((f) => f.ruleId === "duplication/duplicate-block");
      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.file).toBe("src/b.ts");
      expect(blocks[0]?.message).toContain("src/a.ts");
      expect(findings.some((f) => f.ruleId === "duplication/overall")).toBe(true);
    } finally {
      tree.cleanup();
    }
  }, 60_000);
});

/** Semgrep downloads rules and osv-scanner queries osv.dev: opt in with VERITAS_NETWORK_TESTS=1. */
const network = process.env.VERITAS_NETWORK_TESTS === "1";

describe.skipIf(!network || !findTool("semgrep"))("security (semgrep, network)", () => {
  test("finds shell injection", async () => {
    const tree = tempTree({
      "app.py": "import subprocess\n\ndef run(cmd):\n    subprocess.call(cmd, shell=True)\n",
    });
    try {
      const { findings } = await runScan(configFor(tree.dir, { dimensions: ["security"] }));
      expect(
        findings.some((f) => f.ruleId.includes("subprocess-shell-true") && f.startLine === 4),
      ).toBe(true);
    } finally {
      tree.cleanup();
    }
  }, 180_000);
});

describe.skipIf(!network || !findTool("osv-scanner"))("dependencies (osv-scanner, network)", () => {
  test("finds a known vulnerability in a pinned requirement, at its line", async () => {
    const tree = tempTree({ "requirements.txt": "flask==0.12\n" });
    try {
      const { findings } = await runScan(configFor(tree.dir, { dimensions: ["dependencies"] }));
      const flask = findings.filter(
        (f) => f.ruleId === "dependencies/known-vulnerability" && f.message.startsWith("flask@"),
      );
      expect(flask.length).toBeGreaterThan(0);
      expect(flask[0]).toMatchObject({ file: "requirements.txt", startLine: 1 });
      expect(readFileSync(join(tree.dir, "requirements.txt"), "utf-8")).toBe("flask==0.12\n");
    } finally {
      tree.cleanup();
    }
  }, 180_000);
});
