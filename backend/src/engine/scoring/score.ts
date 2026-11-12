import {
  type Dimension,
  type Finding,
  SEVERITIES,
  SEVERITY_META,
  type SeverityCounts,
} from "@veritas/shared";
import { PROJECT_FILE } from "../analyzers/analyzer";

/**
 * Penalty at which a dimension's score falls to 100/e ≈ 37. With the severity
 * weights (critical 10, high 5, medium 2, low 0.5) one critical per 1,000 lines
 * scores ≈ 61, one high ≈ 78, one medium ≈ 90, one low ≈ 98.
 */
export const PENALTY_SCALE = 20;

/**
 * Dimension score, 0–100.
 *
 * File-level findings are divided by size in thousands of lines (minimum 1), so a
 * large codebase is not punished for being large. Project-level findings such as
 * "no tests" describe the whole codebase and count in full regardless of size.
 */
export function scoreDimension(findings: readonly Finding[], totalLines: number): number {
  const kloc = Math.max(totalLines / 1000, 1);
  let filePenalty = 0;
  let projectPenalty = 0;
  for (const f of findings) {
    const weight = SEVERITY_META[f.severity].weight;
    if (f.file === PROJECT_FILE) projectPenalty += weight;
    else filePenalty += weight;
  }
  const penalty = filePenalty / kloc + projectPenalty;
  return round1(100 * Math.exp(-penalty / PENALTY_SCALE));
}

/** Weighted mean of the dimensions that produced a score; null if none did. */
export function overallScore(
  scores: ReadonlyArray<{ dimension: Dimension; score: number | null }>,
  weights: Readonly<Record<Dimension, number>>,
): number | null {
  let total = 0;
  let weightSum = 0;
  for (const { dimension, score } of scores) {
    if (score === null) continue;
    total += score * weights[dimension];
    weightSum += weights[dimension];
  }
  return weightSum > 0 ? round1(total / weightSum) : null;
}

export function countSeverities(findings: readonly Finding[]): SeverityCounts {
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as SeverityCounts;
  for (const f of findings) counts[f.severity]++;
  return counts;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
