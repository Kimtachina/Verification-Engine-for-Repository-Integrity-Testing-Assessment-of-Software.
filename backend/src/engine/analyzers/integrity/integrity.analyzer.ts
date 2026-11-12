import { LANGUAGE_EXTENSIONS } from "@veritas/shared";
import { type SourceFile, splitLines } from "../../discovery/source-file";
import type { Analyzer, RawFinding } from "../analyzer";

const SOURCE = "veritas";
/** A line this long in source code almost always means minified or generated output. */
const MINIFIED_LINE_CHARS = 1000;
const LARGE_BINARY_BYTES = 1024 * 1024;
const SOURCE_EXTENSIONS = new Set(Object.values(LANGUAGE_EXTENSIONS).flat());
/** Characters Windows forbids in file names; such files break checkouts there. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what this rule detects
const NON_PORTABLE_CHARS = /[<>:"|?*\u0000-\u001f]/;

/**
 * Checks that files are intact and portable: readable encoding, no unresolved merge
 * conflicts, no binary data where source should be, nothing that breaks on another OS.
 */
export const integrityAnalyzer: Analyzer = {
  dimension: "integrity",
  async run({ config, discovery }) {
    if (discovery.files.length === 0 && discovery.skipped.length === 0) {
      return { status: "skipped", reason: "No files found under the scan root" };
    }
    const maxTextBytes = config.thresholds.maxFileSizeKb * 1024;
    const findings: RawFinding[] = [];

    for (const file of discovery.files) {
      findings.push(...checkEncoding(file, maxTextBytes));
      findings.push(...checkFileName(file.path));
      if (file.content !== null) findings.push(...checkContent(file, file.content));
    }
    findings.push(...checkCaseCollisions(discovery.files.map((f) => f.path)));

    for (const entry of discovery.skipped) {
      if (entry.reason === "symlink") {
        findings.push({
          severity: "info",
          ruleId: "integrity/symlink-not-followed",
          message: "Symbolic link was not followed; its target is not analysed.",
          file: entry.path,
          source: SOURCE,
        });
      } else if (entry.reason === "unreadable") {
        findings.push({
          severity: "medium",
          ruleId: "integrity/unreadable",
          message: `Could not be read${entry.detail ? `: ${entry.detail}` : ""}.`,
          file: entry.path,
          source: SOURCE,
        });
      }
    }
    return { status: "completed", findings };
  },
};

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

function checkEncoding(file: SourceFile, maxTextBytes: number): RawFinding[] {
  const base = { file: file.path, source: SOURCE } as const;
  const looksLikeSource = SOURCE_EXTENSIONS.has(extensionOf(file.path));

  switch (file.encoding) {
    case "binary":
      if (looksLikeSource) {
        return [
          {
            ...base,
            severity: "high",
            ruleId: "integrity/binary-in-source",
            message: "Source file contains NUL bytes; it is corrupt or not really source.",
          },
        ];
      }
      return file.size > LARGE_BINARY_BYTES
        ? [
            {
              ...base,
              severity: "low",
              ruleId: "integrity/large-binary",
              message: `Binary file of ${formatBytes(file.size)} is stored in the repository.`,
              suggestion: "Store large binaries with Git LFS or outside the repository.",
            },
          ]
        : [];
    case "invalid":
      return [
        {
          ...base,
          severity: looksLikeSource ? "high" : "medium",
          ruleId: "integrity/invalid-utf8",
          message: "File is not valid UTF-8, so tools may misread or corrupt it.",
          suggestion: "Re-save the file as UTF-8.",
        },
      ];
    case "unread":
      return [
        {
          ...base,
          severity: "medium",
          ruleId: "integrity/oversized-file",
          message: `File is ${formatBytes(file.size)}, too large to analyse.`,
        },
      ];
    case "utf-8-bom":
      return [
        {
          ...base,
          severity: "info",
          ruleId: "integrity/utf8-bom",
          message: "File starts with a UTF-8 byte order mark, which some tools mishandle.",
          suggestion: "Save as UTF-8 without BOM.",
        },
        ...checkTextSize(file, maxTextBytes),
      ];
    case "utf-8":
      return checkTextSize(file, maxTextBytes);
  }
}

function checkTextSize(file: SourceFile, maxTextBytes: number): RawFinding[] {
  if (file.size <= maxTextBytes) return [];
  return [
    {
      severity: "low",
      ruleId: "integrity/large-text-file",
      message: `Text file is ${formatBytes(file.size)}, above the ${formatBytes(maxTextBytes)} limit.`,
      suggestion: "Check whether it is generated output or data that belongs elsewhere.",
      file: file.path,
      source: SOURCE,
    },
  ];
}

function checkFileName(path: string): RawFinding[] {
  const name = path.split("/").at(-1) ?? path;
  if (!NON_PORTABLE_CHARS.test(name) && !/[ .]$/.test(name)) return [];
  return [
    {
      severity: "low",
      ruleId: "integrity/non-portable-filename",
      message: "File name contains characters, or ends with a space or dot, that Windows rejects.",
      file: path,
      source: SOURCE,
    },
  ];
}

function checkContent(file: SourceFile, content: string): RawFinding[] {
  const findings: RawFinding[] = [];
  const lines = splitLines(content);
  const isSource = file.language !== "other";

  if (isSource && content.trim().length === 0) {
    findings.push({
      severity: "low",
      ruleId: "integrity/empty-source-file",
      message: "Source file is empty.",
      file: file.path,
      source: SOURCE,
    });
  }

  // Conflict markers only count when a file has both ends of a block, so a Markdown
  // heading underline ("=======") or a lone "<<<<<<<" in a string is not reported.
  const conflictStarts: number[] = [];
  let hasConflictEnd = false;
  let longLine = 0;
  lines.forEach((line, i) => {
    if (/^<{7}(?: |$)/.test(line)) conflictStarts.push(i + 1);
    else if (/^>{7}(?: |$)/.test(line)) hasConflictEnd = true;
    if (longLine === 0 && isSource && line.length > MINIFIED_LINE_CHARS) longLine = i + 1;
  });
  if (hasConflictEnd) {
    for (const line of conflictStarts) {
      findings.push({
        severity: "high",
        ruleId: "integrity/merge-conflict",
        message: "Unresolved merge conflict marker.",
        suggestion: "Resolve the conflict and remove the <<<<<<<, ======= and >>>>>>> lines.",
        file: file.path,
        startLine: line,
        source: SOURCE,
      });
    }
  }

  if (longLine > 0) {
    findings.push({
      severity: "low",
      ruleId: "integrity/minified-or-generated",
      message: `Line longer than ${MINIFIED_LINE_CHARS} characters suggests minified or generated code.`,
      suggestion: "Commit the source instead, or add the file to `ignore` in veritas.config.ts.",
      file: file.path,
      startLine: longLine,
      snippet: `${lines[longLine - 1]?.slice(0, 200)}…`,
      source: SOURCE,
    });
  }

  const crlf = (content.match(/\r\n/g) ?? []).length;
  const lf = (content.match(/(?<!\r)\n/g) ?? []).length;
  if (crlf > 0 && lf > 0) {
    findings.push({
      severity: "low",
      ruleId: "integrity/mixed-line-endings",
      message: `File mixes CRLF (${crlf}) and LF (${lf}) line endings.`,
      suggestion: "Normalise line endings, e.g. with a .gitattributes `* text=auto` rule.",
      file: file.path,
      source: SOURCE,
    });
  }
  return findings;
}

/** Paths that differ only by case collide on macOS and Windows, which are case-insensitive. */
function checkCaseCollisions(paths: string[]): RawFinding[] {
  const byLower = new Map<string, string[]>();
  for (const path of paths) {
    const key = path.toLowerCase();
    byLower.set(key, [...(byLower.get(key) ?? []), path]);
  }
  const findings: RawFinding[] = [];
  for (const group of byLower.values()) {
    if (group.length < 2) continue;
    for (const path of group) {
      findings.push({
        severity: "medium",
        ruleId: "integrity/case-collision",
        message: `Path differs only by letter case from ${group.filter((p) => p !== path).join(", ")}; one will overwrite the other on macOS and Windows.`,
        file: path,
        source: SOURCE,
      });
    }
  }
  return findings;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
