import type { Config, Severity } from "@veritas/shared";
import { familyOf, isProgramSource } from "../../discovery/classify";
import type { SourceFile } from "../../discovery/source-file";
import type { Analyzer, RawFinding } from "../analyzer";
import type { FileMetrics, FunctionMetrics } from "./function-metrics";
import { findPython, measurePythonFiles } from "./python-metrics";
import { measureTsFile } from "./ts-metrics";

const SOURCE = "veritas";
type Thresholds = Config["thresholds"];

/** Over the limit is medium; over twice the limit is high. */
function overLimitSeverity(value: number, limit: number): Severity {
  return value > limit * 2 ? "high" : "medium";
}

export const complexityAnalyzer: Analyzer = {
  dimension: "complexity",
  async run({ config, discovery, signal }) {
    const sources = discovery.files.filter(
      (f): f is SourceFile & { content: string } => isProgramSource(f) && f.content !== null,
    );
    if (sources.length === 0) {
      return { status: "skipped", reason: "No TypeScript, JavaScript or Python source files" };
    }

    const jsFiles = sources.filter((f) => familyOf(f.language) === "js");
    const pyFiles = sources.filter((f) => familyOf(f.language) === "python");

    const metrics: FileMetrics[] = jsFiles.map((f) => measureTsFile(f.path, f.content));
    let note: string | undefined;
    if (pyFiles.length > 0) {
      const python = findPython();
      if (python) {
        metrics.push(...(await measurePythonFiles(python, pyFiles, signal)));
      } else {
        note = `${pyFiles.length} Python file(s) not measured: python3 not found on PATH`;
      }
    }

    const findings: RawFinding[] = [];
    for (const file of metrics) {
      for (const fn of file.functions) {
        findings.push(...checkFunction(file.path, fn, config.thresholds));
      }
    }
    // File length needs no parser, so it is checked even when Python could not be measured.
    for (const file of sources) findings.push(...checkFileLength(file, config.thresholds));

    const unparsable = metrics.filter((m) => m.parseError).length;
    if (unparsable > 0) {
      const parseNote = `${unparsable} file(s) had syntax errors; their metrics may be incomplete`;
      note = note ? `${note}. ${parseNote}` : parseNote;
    }
    return note ? { status: "completed", findings, note } : { status: "completed", findings };
  },
};

function checkFunction(path: string, fn: FunctionMetrics, t: Thresholds): RawFinding[] {
  const base = {
    file: path,
    startLine: fn.startLine,
    endLine: fn.endLine,
    source: SOURCE,
  } as const;
  const findings: RawFinding[] = [];

  if (fn.cyclomatic > t.maxCyclomatic) {
    findings.push({
      ...base,
      severity: overLimitSeverity(fn.cyclomatic, t.maxCyclomatic),
      ruleId: "complexity/cyclomatic",
      message: `\`${fn.name}\` has cyclomatic complexity ${fn.cyclomatic} (limit ${t.maxCyclomatic}).`,
      suggestion:
        "Split independent branches into smaller functions, or replace condition chains with a lookup table.",
    });
  }
  if (fn.cognitive > t.maxCognitive) {
    findings.push({
      ...base,
      severity: overLimitSeverity(fn.cognitive, t.maxCognitive),
      ruleId: "complexity/cognitive",
      message: `\`${fn.name}\` has cognitive complexity ${fn.cognitive} (limit ${t.maxCognitive}).`,
      suggestion:
        "Flatten nesting with early returns and extract nested blocks into named functions.",
    });
  }
  if (fn.maxNesting > t.maxNesting) {
    findings.push({
      ...base,
      severity: fn.maxNesting > t.maxNesting + 2 ? "high" : "medium",
      ruleId: "complexity/nesting",
      message: `\`${fn.name}\` nests control structures ${fn.maxNesting} deep (limit ${t.maxNesting}).`,
      suggestion: "Use guard clauses and early returns to reduce nesting.",
    });
  }
  const length = fn.endLine - fn.startLine + 1;
  if (length > t.maxFunctionLines) {
    findings.push({
      ...base,
      severity: length > t.maxFunctionLines * 2 ? "medium" : "low",
      ruleId: "complexity/function-length",
      message: `\`${fn.name}\` is ${length} lines long (limit ${t.maxFunctionLines}).`,
      suggestion: "Extract cohesive steps into helper functions.",
    });
  }
  return findings;
}

function checkFileLength(file: SourceFile, t: Thresholds): RawFinding[] {
  if (file.lines <= t.maxFileLines) return [];
  return [
    {
      severity: file.lines > t.maxFileLines * 2 ? "medium" : "low",
      ruleId: "complexity/file-length",
      message: `File is ${file.lines} lines long (limit ${t.maxFileLines}).`,
      suggestion: "Split the file by responsibility into smaller modules.",
      file: file.path,
      source: SOURCE,
    },
  ];
}
