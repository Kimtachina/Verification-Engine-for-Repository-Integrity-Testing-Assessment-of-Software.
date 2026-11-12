import type { Grade, Scan } from "@veritas/shared";

/** A completed scan, which always has a score and grade. */
export type ScoredScan = Scan & { score: number; grade: Grade };

export interface TrendPoint {
  scan: ScoredScan;
  x: number;
  y: number;
}

/**
 * Positions completed scans on a score-over-time chart, oldest on the left. Points are
 * spaced evenly by scan rather than by date, so a burst of scans in one afternoon stays
 * readable next to a month-long gap. y is 0 at the top (score 100) as in SVG.
 */
export function trendPoints(
  scans: readonly Scan[],
  box: { width: number; height: number; padding: number },
): TrendPoint[] {
  const scored = scans
    .filter(
      (s): s is ScoredScan => s.status === "completed" && s.score !== null && s.grade !== null,
    )
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const innerW = box.width - box.padding * 2;
  const innerH = box.height - box.padding * 2;
  const step = scored.length > 1 ? innerW / (scored.length - 1) : 0;
  return scored.map((scan, i) => ({
    scan,
    x: box.padding + (scored.length > 1 ? i * step : innerW / 2),
    y: box.padding + ((100 - scan.score) / 100) * innerH,
  }));
}

/** SVG path through the points: "M x y L x y …". */
export function trendPath(points: readonly TrendPoint[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
}
