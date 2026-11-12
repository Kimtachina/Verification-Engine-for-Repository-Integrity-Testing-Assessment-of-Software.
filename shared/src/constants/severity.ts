/** Ordered from most to least severe. Order matters: see `compareSeverity`. */
export const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_META: Record<Severity, { label: string; labelTh: string; weight: number }> = {
  critical: { label: "Critical", labelTh: "วิกฤต", weight: 10 },
  high: { label: "High", labelTh: "สูง", weight: 5 },
  medium: { label: "Medium", labelTh: "ปานกลาง", weight: 2 },
  low: { label: "Low", labelTh: "ต่ำ", weight: 0.5 },
  info: { label: "Info", labelTh: "ข้อมูล", weight: 0 },
};

/** Negative when `a` is more severe than `b`, so `findings.sort(compareSeverity)` puts worst first. */
export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITIES.indexOf(a) - SEVERITIES.indexOf(b);
}

/** True when `severity` is at least as severe as `threshold`. */
export function isAtLeast(severity: Severity, threshold: Severity): boolean {
  return compareSeverity(severity, threshold) <= 0;
}
