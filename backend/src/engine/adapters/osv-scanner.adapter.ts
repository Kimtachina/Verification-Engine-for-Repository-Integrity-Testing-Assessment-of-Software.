import { z } from "zod";
import { runProcess } from "./run-process";
import { createScanPathMapper } from "./scan-path";

const vulnerabilitySchema = z
  .object({
    id: z.string(),
    summary: z.string().optional(),
    affected: z
      .array(
        z
          .object({
            package: z.object({ name: z.string(), ecosystem: z.string() }).loose().optional(),
            ranges: z
              .array(z.object({ events: z.array(z.record(z.string(), z.string())) }).loose())
              .optional(),
          })
          .loose(),
      )
      .optional(),
  })
  .loose();

const outputSchema = z.object({
  results: z
    .array(
      z.object({
        source: z.object({ path: z.string(), type: z.string() }),
        packages: z.array(
          z.object({
            package: z
              .object({ name: z.string(), version: z.string(), ecosystem: z.string() })
              .loose(),
            vulnerabilities: z.array(vulnerabilitySchema).optional(),
            groups: z
              .array(
                z.object({
                  ids: z.array(z.string()),
                  aliases: z.array(z.string()).optional(),
                  max_severity: z.string().optional(),
                }),
              )
              .optional(),
          }),
        ),
      }),
    )
    .nullable()
    .optional(),
});

export interface VulnerablePackage {
  /** Manifest or lockfile, relative to the scan root. */
  file: string;
  /** True when osv-scanner resolved this package as a dependency of a dependency. */
  transitive: boolean;
  name: string;
  version: string;
  ecosystem: string;
  /** One entry per distinct vulnerability (aliases grouped). */
  vulnerabilities: Array<{
    id: string;
    aliases: string[];
    summary: string | undefined;
    /** CVSS base score 0–10, or null when the database gives none. */
    cvss: number | null;
    fixedVersions: string[];
  }>;
}

/** osv-scanner exit codes: 0 clean, 1 vulnerabilities found, 128 nothing to scan. */
const EXIT_NO_PACKAGES = 128;

/**
 * Looks up every dependency in the project's manifests and lockfiles in the OSV
 * database. Package names and versions are sent to osv.dev; source code is not.
 */
export async function runOsvScanner(opts: {
  osvScanner: string;
  rootDir: string;
  signal: AbortSignal;
}): Promise<{ packagesFound: boolean; vulnerable: VulnerablePackage[] }> {
  const { exitCode, stdout, stderr } = await runProcess({
    cmd: [
      opts.osvScanner,
      "scan",
      "source",
      "--recursive",
      "--no-ignore",
      "--format=json",
      opts.rootDir,
    ],
    cwd: opts.rootDir,
    signal: opts.signal,
  });
  if (exitCode === EXIT_NO_PACKAGES) return { packagesFound: false, vulnerable: [] };
  if (exitCode > 1 || !stdout.trim()) {
    throw new Error(`osv-scanner failed (exit ${exitCode}): ${stderr.slice(-2000)}`);
  }
  return { packagesFound: true, vulnerable: parseOsvScanner(stdout, opts.rootDir) };
}

export function parseOsvScanner(stdout: string, rootDir: string): VulnerablePackage[] {
  const toScanPath = createScanPathMapper(rootDir);
  const out: VulnerablePackage[] = [];
  for (const result of outputSchema.parse(JSON.parse(stdout)).results ?? []) {
    const file = toScanPath(result.source.path);
    if (!file) continue;
    for (const pkg of result.packages) {
      const vulnerabilities = (pkg.groups ?? []).map((group) => {
        const details = (pkg.vulnerabilities ?? []).filter((v) => group.ids.includes(v.id));
        const score = Number.parseFloat(group.max_severity ?? "");
        return {
          id: group.ids[0] ?? "unknown",
          aliases: [...new Set([...group.ids.slice(1), ...(group.aliases ?? [])])].filter(
            (a) => a !== group.ids[0],
          ),
          summary: details.find((d) => d.summary)?.summary,
          cvss: Number.isFinite(score) ? score : null,
          fixedVersions: fixedVersions(details, pkg.package.name),
        };
      });
      if (vulnerabilities.length === 0) continue;
      out.push({
        file,
        // osv-scanner reports packages it resolved itself (not listed in the file) as "unknown".
        transitive: result.source.type !== "lockfile",
        name: pkg.package.name,
        version: pkg.package.version,
        ecosystem: pkg.package.ecosystem,
        vulnerabilities,
      });
    }
  }
  return out;
}

function fixedVersions(details: z.infer<typeof vulnerabilitySchema>[], name: string): string[] {
  const fixed = new Set<string>();
  for (const vuln of details) {
    for (const affected of vuln.affected ?? []) {
      if (affected.package && affected.package.name.toLowerCase() !== name.toLowerCase()) continue;
      for (const range of affected.ranges ?? []) {
        for (const event of range.events) if (event.fixed) fixed.add(event.fixed);
      }
    }
  }
  return [...fixed];
}
