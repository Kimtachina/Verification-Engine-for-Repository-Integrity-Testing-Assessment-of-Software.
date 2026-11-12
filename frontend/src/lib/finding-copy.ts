import {
  type Finding,
  type FindingPage,
  type FindingQueryInput,
  SEVERITIES,
} from "@veritas/shared";
import { formatLocation, severityLabel } from "./format";

/** The API returns at most 500 findings per request. */
const BATCH = 500;

/** Fetches every finding that matches `query`, page by page. */
export async function fetchAllFindings(
  fetchPage: (query: FindingQueryInput) => Promise<FindingPage>,
  query: Omit<FindingQueryInput, "limit" | "offset">,
): Promise<{ items: Finding[]; total: number }> {
  const items: Finding[] = [];
  let total = 0;
  do {
    const page = await fetchPage({ ...query, limit: BATCH, offset: items.length });
    total = page.total;
    items.push(...page.items);
    if (page.items.length === 0) break;
  } while (items.length < total);
  return { items, total };
}

/**
 * Plain Markdown that reads well in an issue, a chat or an AI prompt: a heading, then the
 * findings grouped from most to least severe, each with location, rule, suggestion and
 * snippet. Snippets are already redacted by the scanner where a secret was found.
 */
export function formatFindingsForCopy(
  findings: readonly Finding[],
  { title, project, total = findings.length }: { title: string; project: string; total?: number },
): string {
  const lines: string[] = [`# ${title}`, "", `โปรเจกต์: ${project}`, `จำนวน: ${total} ปัญหา`];
  if (total > findings.length) lines.push(`(คัดลอก ${findings.length} รายการแรก)`);

  let n = 0;
  for (const severity of SEVERITIES) {
    const group = findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    lines.push("", `## ${severityLabel(severity)} (${group.length})`);
    for (const f of group) {
      n++;
      lines.push("", `### ${n}. ${f.message}`, `- ตำแหน่ง: \`${formatLocation(f)}\``);
      lines.push(`- กฎ: \`${f.ruleId}\` (${f.source})`);
      if (f.suggestion) lines.push(`- วิธีแก้: ${f.suggestion}`);
      if (f.helpUrl) lines.push(`- อ้างอิง: ${f.helpUrl}`);
      if (f.snippet) {
        // A fence longer than any backtick run in the snippet, so the snippet cannot close it.
        const longest = Math.max(2, ...(f.snippet.match(/`+/g) ?? []).map((m) => m.length));
        const fence = "`".repeat(longest + 1);
        const lang = f.language === "other" ? "" : f.language;
        lines.push("", `${fence}${lang}`, f.snippet.replace(/\n+$/, ""), fence);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/** Clipboard API where available (localhost is a secure context), textarea fallback otherwise. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("คัดลอกไม่สำเร็จ");
}
