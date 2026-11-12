import { familyOf, isProgramSource } from "../../discovery/classify";
import { type SourceFile, splitLines } from "../../discovery/source-file";
import { pythonFactsFor } from "../../languages/python/python-facts";
import { measureTsDocs } from "../../languages/typescript/ts-docs";
import { tsImportsFor } from "../../languages/typescript/ts-imports";
import { type Analyzer, type AnalyzerContext, PROJECT_FILE, type RawFinding } from "../analyzer";
import { buildJsGraph, buildPythonGraph, findCycles } from "./import-graph";

const SOURCE = "veritas";
/** Below this many public definitions, a coverage percentage says little. */
const MIN_DOCUMENTABLE = 5;
/** A cycle this large usually means layering has broken down, not a local slip. */
const LARGE_CYCLE = 10;
const MAX_LISTED = 8;
/** Comment markers. FIXME/HACK/XXX admit known-broken code; TODO is just a plan. */
const MARKER = /(?:\/\/|#|\/\*|^\s*\*)\s*(TODO|FIXME|HACK|XXX)\b:?\s*(.*)/;

type TextFile = SourceFile & { content: string };

export const maintainabilityAnalyzer: Analyzer = {
  dimension: "maintainability",
  async run(ctx) {
    const sources = ctx.discovery.files.filter(
      (f): f is TextFile => isProgramSource(f) && f.content !== null,
    );
    if (sources.length === 0) {
      return { status: "skipped", reason: "No TypeScript, JavaScript or Python source files" };
    }
    const notes: string[] = [];
    const findings = [
      ...(await checkCycles(ctx, notes)),
      ...(await checkDocs(ctx, sources, notes)),
      ...checkReadme(ctx),
      ...checkMarkers(ctx),
    ];
    return notes.length > 0
      ? { status: "completed", findings, note: notes.join(". ") }
      : { status: "completed", findings };
  },
};

async function checkCycles(ctx: AnalyzerContext, notes: string[]): Promise<RawFinding[]> {
  const cycles = findCycles(buildJsGraph(await tsImportsFor(ctx)));
  const python = await pythonFactsFor(ctx);
  if (python.available) {
    const imports = new Map([...python.byPath].map(([path, facts]) => [path, facts.imports]));
    cycles.push(...findCycles(buildPythonGraph(imports)));
  } else if (ctx.discovery.files.some((f) => f.language === "python")) {
    notes.push(`Python import cycles not checked: ${python.reason}`);
  }

  return cycles.map((members) => {
    const [first = PROJECT_FILE, ...rest] = members;
    const listed = rest.slice(0, MAX_LISTED).join(", ");
    const more = rest.length > MAX_LISTED ? ` and ${rest.length - MAX_LISTED} more` : "";
    return {
      severity: members.length >= LARGE_CYCLE ? "high" : "medium",
      ruleId: "maintainability/circular-import",
      message: `Circular import between ${members.length} files: ${first} ↔ ${listed}${more}.`,
      suggestion:
        "Move the shared code both sides need into a separate module, or invert one dependency. Cycles cause undefined-at-load-time bugs and make modules impossible to change alone.",
      file: first,
      source: SOURCE,
    } satisfies RawFinding;
  });
}

async function checkDocs(
  ctx: AnalyzerContext,
  sources: TextFile[],
  notes: string[],
): Promise<RawFinding[]> {
  let total = 0;
  let documented = 0;
  for (const file of sources) {
    if (familyOf(file.language) !== "js") continue;
    const docs = measureTsDocs(file.path, file.content);
    total += docs.total;
    documented += docs.documented;
  }
  const python = await pythonFactsFor(ctx);
  if (python.available) {
    for (const file of sources) {
      const docs = python.byPath.get(file.path)?.docs;
      if (!docs) continue;
      total += docs.total;
      documented += docs.documented;
    }
  } else if (sources.some((f) => f.language === "python")) {
    notes.push(`Python docstrings not measured: ${python.reason}`);
  }

  const min = ctx.config.thresholds.minDocCoverage;
  if (total < MIN_DOCUMENTABLE || documented / total >= min) return [];
  const pct = Math.round((documented / total) * 100);
  return [
    {
      severity: documented / total < min / 2 ? "medium" : "low",
      ruleId: "maintainability/doc-coverage",
      message: `${documented} of ${total} public functions, classes and types are documented (${pct}%; target ${Math.round(min * 100)}%).`,
      suggestion:
        "Document the why, contracts and edge cases of exported APIs first; skip what the name already says.",
      file: PROJECT_FILE,
      source: SOURCE,
    },
  ];
}

function checkReadme(ctx: AnalyzerContext): RawFinding[] {
  const hasReadme = ctx.discovery.files.some((f) => /^readme(?:\.[a-z]+)?$/i.test(f.path));
  if (hasReadme) return [];
  return [
    {
      severity: "low",
      ruleId: "maintainability/missing-readme",
      message: "No README at the project root, so newcomers have no starting point.",
      suggestion:
        "Add a README.md covering what the project does, how to run it and how to test it.",
      file: PROJECT_FILE,
      source: SOURCE,
    },
  ];
}

function checkMarkers(ctx: AnalyzerContext): RawFinding[] {
  const findings: RawFinding[] = [];
  for (const file of ctx.discovery.files) {
    if (file.content === null || familyOf(file.language) === null) continue;
    splitLines(file.content).forEach((line, i) => {
      const match = MARKER.exec(line);
      if (!match) return;
      const [, tag = "TODO", text = ""] = match;
      const note = text
        .trim()
        .replace(/\*\/\s*$/, "")
        .trim();
      findings.push({
        severity: tag === "TODO" ? "info" : "low",
        ruleId: `maintainability/${tag.toLowerCase()}`,
        message: note ? `${tag}: ${note.slice(0, 200)}` : `${tag} comment without a description.`,
        suggestion: "Fix it, or move it to the issue tracker where it can be prioritised.",
        file: file.path,
        startLine: i + 1,
        source: SOURCE,
      });
    });
  }
  return findings;
}
