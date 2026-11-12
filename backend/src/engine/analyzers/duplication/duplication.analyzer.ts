import type { Severity } from "@veritas/shared";
import { runJscpd } from "../../adapters/jscpd.adapter";
import { findTool, missingToolReason } from "../../adapters/tools";
import { familyOf } from "../../discovery/classify";
import { type Analyzer, PROJECT_FILE, type RawFinding } from "../analyzer";

/** A duplicated block this long is a maintenance hazard on its own. */
const LARGE_BLOCK_LINES = 50;

export const duplicationAnalyzer: Analyzer = {
  dimension: "duplication",
  async run({ config, discovery, signal }) {
    const sources = discovery.files.filter(
      (f) => f.content !== null && familyOf(f.language) !== null,
    );
    if (sources.length < 2) {
      return { status: "skipped", reason: "Fewer than two TypeScript, JavaScript or Python files" };
    }
    const jscpd = findTool("jscpd");
    if (!jscpd) return { status: "skipped", reason: missingToolReason("jscpd") };

    const { maxDuplicatePercent, minDuplicateLines } = config.thresholds;
    const report = await runJscpd({
      jscpd,
      rootDir: config.rootDir,
      ignorePatterns: config.ignorePatterns,
      minLines: minDuplicateLines,
      signal,
    });

    const discovered = new Set(sources.map((f) => f.path));
    const findings: RawFinding[] = [];
    for (const block of report.blocks) {
      if (!discovered.has(block.copy.file) || !discovered.has(block.original.file)) continue;
      const same = block.copy.file === block.original.file;
      const where = same
        ? `lines ${block.original.start}–${block.original.end}`
        : `${block.original.file}:${block.original.start}–${block.original.end}`;
      findings.push({
        severity: block.lines >= LARGE_BLOCK_LINES ? "medium" : "low",
        ruleId: "duplication/duplicate-block",
        message: `${block.lines} lines duplicate ${where}.`,
        suggestion:
          "Extract the shared logic into one function or module and call it from both places.",
        file: block.copy.file,
        startLine: Math.max(1, block.copy.start),
        endLine: Math.max(1, block.copy.start, block.copy.end),
        source: "jscpd",
      });
    }

    if (report.percentage > maxDuplicatePercent) {
      findings.push({
        severity: overallSeverity(report.percentage, maxDuplicatePercent),
        ruleId: "duplication/overall",
        message: `${report.percentage.toFixed(1)}% of source lines are duplicated (${report.duplicatedLines} of ${report.totalLines}; limit ${maxDuplicatePercent}%).`,
        suggestion:
          "Start with the largest duplicated blocks; they remove the most repeated lines.",
        file: PROJECT_FILE,
        source: "jscpd",
      });
    }
    return { status: "completed", findings };
  },
};

function overallSeverity(percent: number, limit: number): Severity {
  if (percent > limit * 4) return "high";
  if (percent > limit * 2) return "medium";
  return "low";
}
