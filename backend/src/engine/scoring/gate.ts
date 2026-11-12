import { type Config, type Finding, type GateResult, isAtLeast } from "@veritas/shared";

/**
 * Pass/fail decision for CI. A blocking finding fails the gate whatever the score:
 * a single leaked key or unresolved merge conflict matters more than any average.
 */
export function evaluateGate(
  findings: readonly Finding[],
  score: number | null,
  gate: Config["gate"],
): GateResult {
  const reasons: string[] = [];

  const blocking = findings.filter((f) => isAtLeast(f.severity, gate.failOn)).length;
  if (blocking > 0) {
    reasons.push(`${blocking} finding(s) at or above "${gate.failOn}" severity`);
  }

  if (gate.minScore > 0) {
    if (score === null) {
      reasons.push(
        `No dimension could be scored, so the minimum score ${gate.minScore} cannot be met`,
      );
    } else if (score < gate.minScore) {
      reasons.push(`Overall score ${score} is below the minimum ${gate.minScore}`);
    }
  }

  return { passed: reasons.length === 0, reasons };
}
