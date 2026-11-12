import { runGitleaks } from "../../adapters/gitleaks.adapter";
import { findTool, missingToolReason } from "../../adapters/tools";
import { createIgnoreMatcher } from "../../discovery/ignore";
import type { Analyzer } from "../analyzer";

/**
 * Gitleaks over the scan root. Every leak is critical: a committed credential is
 * compromised whatever the rest of the code looks like, and fails the default gate.
 */
export const secretsAnalyzer: Analyzer = {
  dimension: "secrets",
  async run({ config, discovery, signal }) {
    if (discovery.files.length === 0) return { status: "skipped", reason: "No files to scan" };
    const gitleaks = findTool("gitleaks");
    if (!gitleaks) return { status: "skipped", reason: missingToolReason("gitleaks") };

    const findings = await runGitleaks({ gitleaks, rootDir: config.rootDir, signal });
    // Lockfiles are ignored for analysis but can still hold tokens (e.g. private registry URLs),
    // so only files inside ignored folders such as node_modules are dropped here.
    const { isInIgnoredDir } = createIgnoreMatcher(config.ignorePatterns);
    return { status: "completed", findings: findings.filter((f) => !isInIgnoredDir(f.file)) };
  },
};
