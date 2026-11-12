import { runPyright } from "../../adapters/pyright.adapter";
import { findTool, missingToolReason } from "../../adapters/tools";
import { familyOf } from "../../discovery/classify";
import type { SourceFile } from "../../discovery/source-file";
import { pythonFactsFor } from "../../languages/python/python-facts";
import { collectTsDiagnostics } from "../../languages/typescript/ts-diagnostics";
import type { Analyzer, AnalyzerContext, RawFinding } from "../analyzer";

type TextFile = SourceFile & { content: string };

/**
 * Code that cannot parse cannot run (high); code that does not type-check probably
 * misbehaves at runtime (medium). Imports of third-party packages are never flagged,
 * because VERITAS does not install the project's dependencies.
 */
export const correctnessAnalyzer: Analyzer = {
  dimension: "correctness",
  async run(ctx) {
    const files = ctx.discovery.files.filter(
      (f): f is TextFile => f.content !== null && familyOf(f.language) !== null,
    );
    if (files.length === 0) {
      return { status: "skipped", reason: "No TypeScript, JavaScript or Python files" };
    }
    const js = files.filter((f) => familyOf(f.language) === "js");
    const py = files.filter((f) => familyOf(f.language) === "python");

    const notes: string[] = [];
    const findings = [...checkJs(ctx, js, notes), ...(await checkPython(ctx, py, notes))];
    return notes.length > 0
      ? { status: "completed", findings, note: notes.join(". ") }
      : { status: "completed", findings };
  },
};

function checkJs(ctx: AnalyzerContext, files: TextFile[], notes: string[]): RawFinding[] {
  if (files.length === 0) return [];
  const result = collectTsDiagnostics(ctx.config.rootDir, files);
  notes.push(...result.notes);
  return result.diagnostics.map((d) => ({
    severity: d.kind === "syntax" ? "high" : "medium",
    ruleId: d.kind === "syntax" ? "correctness/syntax-error" : `correctness/ts${d.code}`,
    message: d.kind === "syntax" ? `Syntax error: ${d.message}` : d.message,
    file: d.path,
    startLine: d.line,
    source: "typescript",
    helpUrl: `https://typescript.tv/errors/#ts${d.code}`,
  }));
}

async function checkPython(
  ctx: AnalyzerContext,
  files: TextFile[],
  notes: string[],
): Promise<RawFinding[]> {
  if (files.length === 0) return [];
  const findings: RawFinding[] = [];

  const facts = await pythonFactsFor(ctx);
  if (!facts.available) {
    notes.push(`Python syntax not checked: ${facts.reason}`);
  } else {
    for (const file of files) {
      const f = facts.byPath.get(file.path);
      if (!f?.parseError) continue;
      const finding: RawFinding = {
        severity: "high",
        ruleId: "correctness/syntax-error",
        message: `Syntax error: ${f.parseError}`,
        file: file.path,
        source: "python",
      };
      if (f.parseErrorLine !== undefined) finding.startLine = f.parseErrorLine;
      findings.push(finding);
    }
  }

  const pyright = findTool("pyright");
  if (!pyright) {
    notes.push(`Python types not checked: ${missingToolReason("pyright")}`);
    return findings;
  }
  const typeFindings = await runPyright({
    pyright,
    rootDir: ctx.config.rootDir,
    files: files.map((f) => f.path),
    signal: ctx.signal,
  });
  const discovered = new Set(files.map((f) => f.path));
  findings.push(...typeFindings.filter((f) => discovered.has(f.file)));
  return findings;
}
