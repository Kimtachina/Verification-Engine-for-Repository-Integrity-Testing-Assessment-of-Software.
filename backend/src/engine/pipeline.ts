import {
  type AnalyzerRun,
  type Dimension,
  type DimensionScore,
  type Finding,
  gradeFor,
  type Scan,
  type ScanEvent,
  type ScanStats,
  scanSchema,
} from "@veritas/shared";
import { z } from "zod";
import type { ResolvedConfig } from "../config/load-config";
import { enabledDimensions, resolveWeights } from "../config/weights";
import type { Analyzer, AnalyzerResult } from "./analyzers/analyzer";
import { ANALYZERS } from "./analyzers/registry";
import { discoverFiles } from "./discovery/discover-files";
import type { DiscoveryResult, SourceFile } from "./discovery/source-file";
import { normalizeFindings, sortFindings } from "./normalize/normalize-findings";
import { evaluateGate } from "./scoring/gate";
import { countSeverities, overallScore, scoreDimension } from "./scoring/score";

export interface ScanOutcome {
  scan: Scan;
  /** Sorted worst first. */
  findings: Finding[];
}

export interface RunScanOptions {
  scanId?: string;
  onEvent?: (event: ScanEvent) => void;
  /** Replaces the built-in analyzers; used by tests. */
  analyzers?: ReadonlyMap<Dimension, Analyzer>;
}

interface DimensionOutcome {
  run: AnalyzerRun;
  findings: Finding[];
}

/** discover → analyze (in parallel) → normalize → score → gate. */
export async function runScan(
  config: ResolvedConfig,
  { scanId = crypto.randomUUID(), onEvent = () => {}, analyzers = ANALYZERS }: RunScanOptions = {},
): Promise<ScanOutcome> {
  const startedAt = new Date().toISOString();

  onEvent({ type: "discovery-started" });
  const discovery = await discoverFiles(config);
  const stats = computeStats(discovery);
  onEvent({ type: "discovery-finished", files: stats.files, lines: stats.lines });

  const filesByPath = new Map(discovery.files.map((f) => [f.path, f]));
  const dimensions = enabledDimensions(config);
  const outcomes = await Promise.all(
    dimensions.map(async (dimension) => {
      onEvent({ type: "analyzer-started", dimension });
      const outcome = await runOne(dimension, analyzers.get(dimension), {
        config,
        discovery,
        filesByPath,
        scanId,
      });
      onEvent({ type: "analyzer-finished", run: outcome.run });
      return outcome;
    }),
  );

  const findings = sortFindings(outcomes.flatMap((o) => o.findings));
  const dimensionScores: DimensionScore[] = outcomes.map(({ run, findings: dimFindings }) => {
    const score = run.status === "completed" ? scoreDimension(dimFindings, stats.lines) : null;
    return {
      dimension: run.dimension,
      score,
      grade: score === null ? null : gradeFor(score),
      counts: countSeverities(dimFindings),
    };
  });
  const score = overallScore(dimensionScores, resolveWeights(config));

  const scan = scanSchema.parse({
    id: scanId,
    status: "completed",
    root: config.rootDir,
    startedAt,
    finishedAt: new Date().toISOString(),
    error: null,
    stats,
    analyzers: outcomes.map((o) => o.run),
    dimensions: dimensionScores,
    score,
    grade: score === null ? null : gradeFor(score),
    gate: evaluateGate(findings, score, config.gate),
    counts: countSeverities(findings),
  } satisfies Scan);

  onEvent({ type: "scan-finished", scan });
  return { scan, findings };
}

async function runOne(
  dimension: Dimension,
  analyzer: Analyzer | undefined,
  ctx: {
    config: ResolvedConfig;
    discovery: DiscoveryResult;
    filesByPath: ReadonlyMap<string, SourceFile>;
    scanId: string;
  },
): Promise<DimensionOutcome> {
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const empty = (status: "skipped" | "failed", reason: string): DimensionOutcome => ({
    run: { dimension, status, reason, durationMs: elapsed(), findingCount: 0 },
    findings: [],
  });

  if (!analyzer) return empty("skipped", "No analyzer for this dimension in this version yet");

  const controller = new AbortController();
  const timeoutMs = ctx.config.analyzerTimeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });

  let result: AnalyzerResult;
  try {
    result = await Promise.race([
      analyzer.run({ config: ctx.config, discovery: ctx.discovery, signal: controller.signal }),
      timeout,
    ]);
  } catch (error) {
    return empty("failed", describeError(error));
  } finally {
    clearTimeout(timer);
  }

  if (result.status === "skipped") return empty("skipped", result.reason);

  let findings: Finding[];
  try {
    findings = normalizeFindings(dimension, result.findings, ctx.filesByPath, ctx.scanId);
  } catch (error) {
    return empty("failed", `Analyzer produced an invalid finding: ${describeError(error)}`);
  }

  const run: AnalyzerRun = {
    dimension,
    status: "completed",
    durationMs: elapsed(),
    findingCount: findings.length,
  };
  if (result.note) run.reason = result.note;
  return { run, findings };
}

function computeStats(discovery: DiscoveryResult): ScanStats {
  const byLanguage: ScanStats["byLanguage"] = {};
  let lines = 0;
  let bytes = 0;
  for (const file of discovery.files) {
    lines += file.lines;
    bytes += file.size;
    const entry = byLanguage[file.language] ?? { files: 0, lines: 0 };
    entry.files++;
    entry.lines += file.lines;
    byLanguage[file.language] = entry;
  }
  return { files: discovery.files.length, lines, bytes, byLanguage };
}

function describeError(error: unknown): string {
  if (error instanceof z.ZodError) return z.prettifyError(error);
  return error instanceof Error ? error.message : String(error);
}
