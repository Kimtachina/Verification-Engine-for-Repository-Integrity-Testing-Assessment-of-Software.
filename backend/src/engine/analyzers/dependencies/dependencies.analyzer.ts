import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Severity } from "@veritas/shared";
import { runOsvScanner, type VulnerablePackage } from "../../adapters/osv-scanner.adapter";
import { findTool, missingToolReason } from "../../adapters/tools";
import { createIgnoreMatcher } from "../../discovery/ignore";
import { tsImportsFor } from "../../languages/typescript/ts-imports";
import type { Analyzer, RawFinding } from "../analyzer";
import { checkNpmManifests } from "./npm-manifest";

/** Files that declare dependencies; their presence decides whether this dimension applies. */
const MANIFEST =
  /(?:^|\/)(?:package\.json|requirements[^/]*\.txt|pyproject\.toml|Pipfile|setup\.py|setup\.cfg|poetry\.lock|uv\.lock|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock)$/;

export const dependenciesAnalyzer: Analyzer = {
  dimension: "dependencies",
  async run(ctx) {
    const { config, discovery, signal } = ctx;
    const { isInIgnoredDir } = createIgnoreMatcher(config.ignorePatterns);
    const hasManifest =
      discovery.files.some((f) => MANIFEST.test(f.path)) ||
      // Lockfiles are excluded from discovery, so look for them on disk at the root too.
      [
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
        "bun.lock",
        "poetry.lock",
        "uv.lock",
      ].some((l) => existsSync(join(config.rootDir, l)));
    if (!hasManifest) {
      return {
        status: "skipped",
        reason: "No dependency manifest (package.json, requirements.txt, pyproject.toml…)",
      };
    }

    const findings: RawFinding[] = checkNpmManifests(
      config.rootDir,
      discovery.files,
      await tsImportsFor(ctx),
    );
    const notes: string[] = [];

    const osv = findTool("osv-scanner");
    if (osv) {
      const result = await runOsvScanner({ osvScanner: osv, rootDir: config.rootDir, signal });
      for (const pkg of result.vulnerable) {
        // Lockfiles inside node_modules belong to dependencies, not to this project.
        if (isInIgnoredDir(pkg.file)) continue;
        findings.push(...vulnerabilityFindings(config.rootDir, pkg));
      }
    } else {
      notes.push(`Known vulnerabilities not checked: ${missingToolReason("osv-scanner")}`);
    }

    return notes.length > 0
      ? { status: "completed", findings, note: notes.join(". ") }
      : { status: "completed", findings };
  },
};

function vulnerabilityFindings(rootDir: string, pkg: VulnerablePackage): RawFinding[] {
  const line = pkg.transitive ? undefined : lineOf(rootDir, pkg.file, pkg.name);
  return pkg.vulnerabilities.map((v) => {
    const cve = v.aliases.find((a) => a.startsWith("CVE-"));
    const label = cve ? `${v.id} / ${cve}` : v.id;
    const score = v.cvss === null ? "severity unknown" : `CVSS ${v.cvss}`;
    const via = pkg.transitive ? " (pulled in by another dependency)" : "";
    const finding: RawFinding = {
      severity: cvssSeverity(v.cvss),
      ruleId: "dependencies/known-vulnerability",
      message: `${pkg.name}@${pkg.version}${via} has ${label} (${score})${v.summary ? `: ${v.summary}` : ""}.`,
      suggestion:
        v.fixedVersions.length > 0
          ? `Upgrade ${pkg.name} to ${v.fixedVersions.join(" or ")} or later.`
          : `No fixed version is published yet; check ${pkg.name}'s advisory for a workaround or replacement.`,
      file: pkg.file,
      source: "osv-scanner",
      helpUrl: `https://osv.dev/vulnerability/${encodeURIComponent(v.id)}`,
    };
    if (line !== undefined) finding.startLine = line;
    return finding;
  });
}

/** CVSS bands from the CVSS v3/v4 specification; unknown scores are treated as medium. */
export function cvssSeverity(score: number | null): Severity {
  if (score === null) return "medium";
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

/** First line of the manifest naming the package, so the finding points at the declaration. */
function lineOf(rootDir: string, file: string, name: string): number | undefined {
  try {
    const lines = readFileSync(join(rootDir, file), "utf-8").split(/\r?\n/);
    const pattern = new RegExp(
      `(?:^|["'\\s/])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:["'\\s=<>~!@;\\[]|$)`,
      "i",
    );
    const index = lines.findIndex((l) => pattern.test(l));
    return index === -1 ? undefined : index + 1;
  } catch {
    return undefined;
  }
}
