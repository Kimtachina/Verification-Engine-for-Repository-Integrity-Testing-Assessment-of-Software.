import {
  type ConfigInput,
  type Scan,
  type ScanEvent,
  SEVERITIES,
  type SeverityCounts,
  type StartScanRequest,
} from "@veritas/shared";
import type { ResolvedConfig } from "../config/load-config";
import type { ScanRepository } from "../db/scan-repository";
import {
  runScan as defaultRunScan,
  type RunScanOptions,
  type ScanOutcome,
} from "../engine/pipeline";
import { HttpError } from "./http-error";

type Listener = (event: ScanEvent) => void;

interface ActiveScan {
  id: string;
  /** Every event so far, replayed to late subscribers so they see the progress made. */
  events: ScanEvent[];
  listeners: Set<Listener>;
  done: Promise<void>;
}

export interface ScanRunnerDeps {
  repo: ScanRepository;
  /** Loads veritas.config.ts fresh for each scan, so edits apply without a restart. */
  loadConfig: (overrides: ConfigInput) => Promise<ResolvedConfig>;
  runScan?: (config: ResolvedConfig, opts: RunScanOptions) => Promise<ScanOutcome>;
  /** Folder of an uploaded project, or null if the id is unknown. */
  uploadRoot?: (uploadId: string) => Promise<string | null>;
  now?: () => Date;
}

/**
 * Runs one scan at a time in the background, stores the result, and fans progress events
 * out to subscribers (the SSE endpoint). Scans read the whole tree and spawn heavy tools,
 * so running two at once would only make both slower.
 */
export class ScanRunner {
  private active: ActiveScan | null = null;
  private readonly runScan: NonNullable<ScanRunnerDeps["runScan"]>;
  private readonly now: () => Date;

  constructor(private readonly deps: ScanRunnerDeps) {
    this.runScan = deps.runScan ?? defaultRunScan;
    this.now = deps.now ?? (() => new Date());
  }

  get runningScanId(): string | null {
    return this.active?.id ?? null;
  }

  /** Validates config, records the scan as running and returns it; the scan continues in the background. */
  async start(request: StartScanRequest): Promise<Scan> {
    if (this.active) {
      throw new HttpError(
        409,
        `A scan is already running (${this.active.id}); wait for it to finish.`,
      );
    }
    const overrides = toOverrides(request);
    if (request.uploadId) {
      const root = await this.deps.uploadRoot?.(request.uploadId);
      if (!root)
        throw new HttpError(404, "Upload not found; it may have been replaced by newer uploads.");
      overrides.root = root;
    }
    const config = await this.deps.loadConfig(overrides);
    // Re-check: another request may have started a scan while the config was loading.
    if (this.active) throw new HttpError(409, "A scan is already running; wait for it to finish.");

    const initial = runningScan(crypto.randomUUID(), config.rootDir, this.now());
    await this.deps.repo.insertScan(initial);
    const active: ActiveScan = {
      id: initial.id,
      events: [],
      listeners: new Set(),
      done: Promise.resolve(),
    };
    this.active = active;
    active.done = this.execute(active, config, initial);
    return initial;
  }

  /**
   * Subscribes to a running scan. Returns the events so far plus an unsubscribe function,
   * or null when that scan is not running (the caller should read it from the database).
   */
  subscribe(
    scanId: string,
    listener: Listener,
  ): { replay: ScanEvent[]; unsubscribe: () => void } | null {
    const active = this.active;
    if (!active || active.id !== scanId) return null;
    active.listeners.add(listener);
    return { replay: [...active.events], unsubscribe: () => active.listeners.delete(listener) };
  }

  /** Resolves when the current scan (if any) has finished and been stored. For tests and shutdown. */
  async idle(): Promise<void> {
    await this.active?.done;
  }

  private async execute(active: ActiveScan, config: ResolvedConfig, initial: Scan): Promise<void> {
    const emit = (event: ScanEvent) => {
      active.events.push(event);
      for (const listener of active.listeners) listener(event);
    };
    let final: Scan;
    try {
      const outcome = await this.runScan(config, {
        scanId: active.id,
        // The pipeline's own scan-finished fires before anything is stored; we send ours
        // after the commit, so a client reacting to it always finds the findings.
        onEvent: (e) => {
          if (e.type !== "scan-finished") emit(e);
        },
      });
      await this.deps.repo.completeScan(outcome.scan, outcome.findings);
      final = outcome.scan;
    } catch (error) {
      final = {
        ...initial,
        status: "failed",
        finishedAt: this.now().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      };
      // If the database is unreachable too, the scan stays "running" until the next start.
      await this.deps.repo
        .updateScan(final)
        .catch((e) => console.error("Could not record failed scan:", e));
    }
    // Clear before announcing, so a client that starts a new scan on "finished" is not refused.
    this.active = null;
    emit({ type: "scan-finished", scan: final });
    active.listeners.clear();
  }
}

function toOverrides(request: StartScanRequest): ConfigInput {
  const overrides: ConfigInput = {};
  if (request.dimensions) overrides.dimensions = request.dimensions;
  const gate: NonNullable<ConfigInput["gate"]> = {};
  if (request.failOn) gate.failOn = request.failOn;
  if (request.minScore !== undefined) gate.minScore = request.minScore;
  if (Object.keys(gate).length > 0) overrides.gate = gate;
  return overrides;
}

function runningScan(id: string, root: string, now: Date): Scan {
  return {
    id,
    status: "running",
    root,
    startedAt: now.toISOString(),
    finishedAt: null,
    error: null,
    stats: null,
    analyzers: [],
    dimensions: [],
    score: null,
    grade: null,
    gate: null,
    counts: Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as SeverityCounts,
  };
}
