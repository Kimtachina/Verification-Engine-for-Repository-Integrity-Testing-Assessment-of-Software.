import { runSemgrep } from "../../adapters/semgrep.adapter";
import { findTool, missingToolReason } from "../../adapters/tools";
import type { Analyzer } from "../analyzer";

/**
 * Semgrep rule sets over every readable text file (Semgrep picks rules by language,
 * including Dockerfiles, YAML and shell). Rule sets are downloaded from semgrep.dev;
 * the scanned code itself stays on this machine.
 */
export const securityAnalyzer: Analyzer = {
  dimension: "security",
  async run({ config, discovery, signal }) {
    const files = discovery.files.filter((f) => f.content !== null).map((f) => f.path);
    if (files.length === 0) return { status: "skipped", reason: "No readable text files" };
    const semgrep = findTool("semgrep");
    if (!semgrep) return { status: "skipped", reason: missingToolReason("semgrep") };

    const findings = await runSemgrep({
      semgrep,
      rootDir: config.rootDir,
      files,
      rules: config.semgrepRules,
      signal,
    });
    const discovered = new Set(files);
    return { status: "completed", findings: findings.filter((f) => discovered.has(f.file)) };
  },
};
