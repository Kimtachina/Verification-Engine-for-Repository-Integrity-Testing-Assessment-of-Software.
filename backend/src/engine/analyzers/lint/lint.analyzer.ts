import { runBiome } from "../../adapters/biome.adapter";
import { runRuff } from "../../adapters/ruff.adapter";
import { findTool, missingToolReason } from "../../adapters/tools";
import { familyOf } from "../../discovery/classify";
import type { Analyzer, RawFinding } from "../analyzer";

/** Biome for TypeScript/JavaScript, Ruff for Python. Either may be missing; both may not. */
export const lintAnalyzer: Analyzer = {
  dimension: "lint",
  async run({ config, discovery, signal }) {
    const readable = discovery.files.filter((f) => f.content !== null);
    const js = readable.filter((f) => familyOf(f.language) === "js").map((f) => f.path);
    const py = readable.filter((f) => familyOf(f.language) === "python").map((f) => f.path);
    if (js.length === 0 && py.length === 0) {
      return { status: "skipped", reason: "No TypeScript, JavaScript or Python files" };
    }

    const biome = js.length > 0 ? findTool("biome") : null;
    const ruff = py.length > 0 ? findTool("ruff") : null;
    const notes: string[] = [];
    if (js.length > 0 && !biome) notes.push(`TS/JS not linted: ${missingToolReason("biome")}`);
    if (py.length > 0 && !ruff) notes.push(`Python not linted: ${missingToolReason("ruff")}`);
    if (!biome && !ruff) return { status: "skipped", reason: notes.join(". ") };

    const [jsFindings, pyFindings] = await Promise.all([
      biome ? runBiome({ biome, rootDir: config.rootDir, files: js, signal }) : [],
      ruff ? runRuff({ ruff, rootDir: config.rootDir, files: py, signal }) : [],
    ]);
    const discovered = new Set([...js, ...py]);
    const findings: RawFinding[] = [...jsFindings, ...pyFindings].filter((f) =>
      discovered.has(f.file),
    );
    return notes.length > 0
      ? { status: "completed", findings, note: notes.join(". ") }
      : { status: "completed", findings };
  },
};
