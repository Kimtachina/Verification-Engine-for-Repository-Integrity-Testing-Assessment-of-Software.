import { describe, expect, test } from "bun:test";
import type { RawFinding } from "../../src/engine/analyzers/analyzer";
import { integrityAnalyzer } from "../../src/engine/analyzers/integrity/integrity.analyzer";
import type { SourceFile } from "../../src/engine/discovery/source-file";
import { contextFor, ruleIds, textFile } from "../helpers";

async function run(
  files: SourceFile[],
  skipped: NonNullable<Parameters<typeof contextFor>[1]>["skipped"] = [],
) {
  const result = await integrityAnalyzer.run(contextFor(files, { skipped }));
  if (result.status !== "completed") throw new Error(`expected completed, got ${result.status}`);
  return result.findings;
}

const find = (findings: RawFinding[], ruleId: string) =>
  findings.filter((f) => f.ruleId === ruleId);

describe("integrity analyzer", () => {
  test("clean files produce no findings", async () => {
    expect(await run([textFile("src/a.ts", "export const a = 1;\n")])).toEqual([]);
  });

  test("skips when there is nothing to inspect", async () => {
    const result = await integrityAnalyzer.run(contextFor([]));
    expect(result.status).toBe("skipped");
  });

  test("reports each unresolved merge conflict block at its start line", async () => {
    const content = [
      "a",
      "<<<<<<< HEAD",
      "x",
      "=======",
      "y",
      ">>>>>>> main",
      "b",
      "<<<<<<< ours",
      "=======",
      ">>>>>>> theirs",
    ].join("\n");
    const conflicts = find(await run([textFile("src/a.ts", content)]), "integrity/merge-conflict");
    expect(conflicts.map((f) => [f.severity, f.startLine])).toEqual([
      ["high", 2],
      ["high", 8],
    ]);
  });

  test("a Markdown underline or a lone marker is not a conflict", async () => {
    const md = textFile("README.md", "Title\n=======\n");
    const lone = textFile("src/a.ts", 'const s = "x";\n<<<<<<< not closed\n');
    expect(find(await run([md, lone]), "integrity/merge-conflict")).toEqual([]);
  });

  test("mixed line endings", async () => {
    const findings = await run([textFile("src/a.ts", "a\r\nb\nc\r\n")]);
    expect(find(findings, "integrity/mixed-line-endings")[0]?.message).toContain(
      "CRLF (2) and LF (1)",
    );
  });

  test("minified or generated source, reported once at the first long line", async () => {
    const long = "x".repeat(1200);
    const findings = find(
      await run([textFile("src/a.js", `ok\n${long}\n${long}`)]),
      "integrity/minified-or-generated",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.startLine).toBe(2);
    expect(findings[0]?.snippet?.length).toBeLessThan(300);
  });

  test("long lines in non-source files are fine", async () => {
    expect(await run([textFile("data.csv", "x".repeat(5000))])).toEqual([]);
  });

  test("empty source file", async () => {
    const findings = await run([textFile("src/empty.py", "  \n"), textFile("notes.txt", "")]);
    expect(ruleIds(findings)).toEqual(["integrity/empty-source-file"]);
    expect(findings[0]?.file).toBe("src/empty.py");
  });

  test("binary data: high in a source file, ignored for small assets, low for large ones", async () => {
    const binary = (path: string, size: number): SourceFile => ({
      ...textFile(path, ""),
      encoding: "binary",
      content: null,
      lines: 0,
      size,
    });
    const findings = await run([
      binary("src/a.ts", 10),
      binary("logo.png", 100),
      binary("video.mp4", 5_000_000),
    ]);
    expect(findings.map((f) => [f.ruleId, f.severity, f.file])).toEqual([
      ["integrity/binary-in-source", "high", "src/a.ts"],
      ["integrity/large-binary", "low", "video.mp4"],
    ]);
  });

  test("invalid UTF-8 is high for source, medium otherwise", async () => {
    const invalid = (path: string): SourceFile => ({
      ...textFile(path, ""),
      encoding: "invalid",
      content: null,
    });
    const findings = await run([invalid("src/a.py"), invalid("notes.txt")]);
    expect(findings.map((f) => f.severity)).toEqual(["high", "medium"]);
  });

  test("oversized text and unread files", async () => {
    const big: SourceFile = { ...textFile("big.json", "{}"), size: 600 * 1024 };
    const huge: SourceFile = {
      ...textFile("huge.sql", ""),
      encoding: "unread",
      content: null,
      size: 9e6,
    };
    expect(ruleIds(await run([big, huge]))).toEqual([
      "integrity/large-text-file",
      "integrity/oversized-file",
    ]);
  });

  test("paths differing only by case collide", async () => {
    const findings = find(
      await run([textFile("src/User.ts", "x"), textFile("src/user.ts", "x")]),
      "integrity/case-collision",
    );
    expect(findings.map((f) => f.file)).toEqual(["src/User.ts", "src/user.ts"]);
  });

  test("non-portable file names", async () => {
    const findings = await run([
      textFile("src/a:b.ts", "x"),
      textFile("trailing. ", "x"),
      textFile("ok-name.ts", "x"),
    ]);
    expect(find(findings, "integrity/non-portable-filename").map((f) => f.file)).toEqual([
      "src/a:b.ts",
      "trailing. ",
    ]);
  });

  test("BOM is info only", async () => {
    const findings = await run([{ ...textFile("a.ts", "x"), encoding: "utf-8-bom" }]);
    expect(findings.map((f) => [f.ruleId, f.severity])).toEqual([["integrity/utf8-bom", "info"]]);
  });

  test("symlinks and unreadable entries from discovery are reported", async () => {
    const findings = await run(
      [],
      [
        { path: "link", reason: "symlink" },
        { path: "locked", reason: "unreadable", detail: "EACCES" },
      ],
    );
    expect(findings.map((f) => [f.ruleId, f.severity])).toEqual([
      ["integrity/symlink-not-followed", "info"],
      ["integrity/unreadable", "medium"],
    ]);
    expect(findings[1]?.message).toContain("EACCES");
  });
});
