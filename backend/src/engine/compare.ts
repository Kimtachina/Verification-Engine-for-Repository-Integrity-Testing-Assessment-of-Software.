import type { Finding, Scan, ScanComparison } from "@veritas/shared";

/**
 * What changed between two scans, matched by fingerprint. Fingerprints come from rule,
 * file and line content, so a finding that merely moved lines counts as persisting.
 */
export function compareScans(
  base: { scan: Scan; findings: readonly Finding[] },
  head: { scan: Scan; findings: readonly Finding[] },
): ScanComparison {
  const baseSet = new Set(base.findings.map((f) => f.fingerprint));
  const headSet = new Set(head.findings.map((f) => f.fingerprint));
  const introduced = head.findings.filter((f) => !baseSet.has(f.fingerprint));
  const resolved = base.findings.filter((f) => !headSet.has(f.fingerprint));
  const scoreDelta =
    base.scan.score === null || head.scan.score === null
      ? null
      : Math.round((head.scan.score - base.scan.score) * 10) / 10;
  return {
    baseScanId: base.scan.id,
    headScanId: head.scan.id,
    scoreDelta,
    introduced,
    resolved,
    persistingCount: head.findings.length - introduced.length,
  };
}
