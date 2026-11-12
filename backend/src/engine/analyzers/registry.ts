import type { Dimension } from "@veritas/shared";
import type { Analyzer } from "./analyzer";
import { complexityAnalyzer } from "./complexity/complexity.analyzer";
import { integrityAnalyzer } from "./integrity/integrity.analyzer";
import { testingAnalyzer } from "./testing/testing.analyzer";

/** Every analyzer VERITAS ships. Dimensions without one are reported as skipped. */
export const ANALYZERS: ReadonlyMap<Dimension, Analyzer> = new Map(
  [integrityAnalyzer, complexityAnalyzer, testingAnalyzer].map((a) => [a.dimension, a]),
);
