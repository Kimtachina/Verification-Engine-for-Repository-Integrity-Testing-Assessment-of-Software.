export const GRADES = ["A", "B", "C", "D", "F"] as const;

export type Grade = (typeof GRADES)[number];

/** Minimum score (inclusive) for each grade, checked top to bottom. */
const GRADE_FLOORS: ReadonlyArray<readonly [Grade, number]> = [
  ["A", 90],
  ["B", 80],
  ["C", 70],
  ["D", 60],
  ["F", 0],
];

export function gradeFor(score: number): Grade {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new RangeError(`Score must be between 0 and 100, got ${score}`);
  }
  for (const [grade, floor] of GRADE_FLOORS) {
    if (score >= floor) return grade;
  }
  return "F";
}
