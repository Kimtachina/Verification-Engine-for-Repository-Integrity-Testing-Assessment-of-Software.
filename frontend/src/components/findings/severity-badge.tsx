import { SEVERITIES, type Severity, type SeverityCounts } from "@veritas/shared";
import { severityLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Tailwind classes per severity. Literal strings so Tailwind can see them at build time. */
export const SEVERITY_CLASSES: Record<Severity, { text: string; bg: string; dot: string }> = {
  critical: { text: "text-sev-critical", bg: "bg-sev-critical/12", dot: "bg-sev-critical" },
  high: { text: "text-sev-high", bg: "bg-sev-high/12", dot: "bg-sev-high" },
  medium: { text: "text-sev-medium", bg: "bg-sev-medium/15", dot: "bg-sev-medium" },
  low: { text: "text-sev-low", bg: "bg-sev-low/12", dot: "bg-sev-low" },
  info: { text: "text-sev-info", bg: "bg-sev-info/12", dot: "bg-sev-info" },
};

export function SeverityBadge({ severity, className }: { severity: Severity; className?: string }) {
  const c = SEVERITY_CLASSES[severity];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        c.bg,
        c.text,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", c.dot)} aria-hidden />
      {severityLabel(severity)}
    </span>
  );
}

/** Compact "2 สูง · 5 ปานกลาง" row; zero counts are omitted. Info is hidden unless asked. */
export function SeverityCountsRow({
  counts,
  includeInfo = false,
  className,
}: {
  counts: SeverityCounts;
  includeInfo?: boolean;
  className?: string;
}) {
  const shown = SEVERITIES.filter((s) => counts[s] > 0 && (includeInfo || s !== "info"));
  if (shown.length === 0) {
    return <span className={cn("text-sm text-muted-foreground", className)}>ไม่พบปัญหา</span>;
  }
  return (
    <span className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-sm", className)}>
      {shown.map((s) => (
        <span key={s} className={cn("inline-flex items-center gap-1.5", SEVERITY_CLASSES[s].text)}>
          <span className={cn("size-2 rounded-full", SEVERITY_CLASSES[s].dot)} aria-hidden />
          <span className="font-semibold tabular-nums">{counts[s]}</span>
          <span>{severityLabel(s)}</span>
        </span>
      ))}
    </span>
  );
}
