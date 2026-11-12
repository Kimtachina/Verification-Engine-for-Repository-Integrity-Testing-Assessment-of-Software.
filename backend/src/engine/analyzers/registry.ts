import type { Dimension } from "@veritas/shared";
import type { Analyzer } from "./analyzer";
import { complexityAnalyzer } from "./complexity/complexity.analyzer";
import { correctnessAnalyzer } from "./correctness/correctness.analyzer";
import { dependenciesAnalyzer } from "./dependencies/dependencies.analyzer";
import { duplicationAnalyzer } from "./duplication/duplication.analyzer";
import { integrityAnalyzer } from "./integrity/integrity.analyzer";
import { lintAnalyzer } from "./lint/lint.analyzer";
import { maintainabilityAnalyzer } from "./maintainability/maintainability.analyzer";
import { secretsAnalyzer } from "./secrets/secrets.analyzer";
import { securityAnalyzer } from "./security/security.analyzer";
import { testingAnalyzer } from "./testing/testing.analyzer";

/** Every analyzer VERITAS ships, one per dimension. */
export const ANALYZERS: ReadonlyMap<Dimension, Analyzer> = new Map(
  [
    integrityAnalyzer,
    correctnessAnalyzer,
    lintAnalyzer,
    complexityAnalyzer,
    duplicationAnalyzer,
    securityAnalyzer,
    secretsAnalyzer,
    dependenciesAnalyzer,
    testingAnalyzer,
    maintainabilityAnalyzer,
  ].map((a) => [a.dimension, a]),
);
