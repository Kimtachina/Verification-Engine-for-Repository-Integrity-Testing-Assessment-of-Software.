import type { AnalyzerRun, Dimension, Scan, ScanEvent } from "@veritas/shared";

export type DimensionProgress = { state: "running" } | { state: "done"; run: AnalyzerRun };

export interface ScanProgress {
  phase: "connecting" | "discovering" | "analyzing" | "finished";
  files: number | null;
  lines: number | null;
  /** Insertion order is the order analyzers started. */
  dimensions: Partial<Record<Dimension, DimensionProgress>>;
  /** Set once the scan has finished (completed or failed). */
  scan: Scan | null;
}

export const initialProgress: ScanProgress = {
  phase: "connecting",
  files: null,
  lines: null,
  dimensions: {},
  scan: null,
};

/**
 * Folds the server's progress events into display state. Pure, so it is tested without
 * a browser. `discovery-started` resets everything: after an EventSource reconnect the
 * server replays the whole scan from the beginning.
 */
export function reduceProgress(state: ScanProgress, event: ScanEvent): ScanProgress {
  switch (event.type) {
    case "discovery-started":
      return { ...initialProgress, phase: "discovering" };
    case "discovery-finished":
      return { ...state, phase: "analyzing", files: event.files, lines: event.lines };
    case "analyzer-started":
      return {
        ...state,
        phase: "analyzing",
        dimensions: { ...state.dimensions, [event.dimension]: { state: "running" } },
      };
    case "analyzer-finished":
      return {
        ...state,
        dimensions: {
          ...state.dimensions,
          [event.run.dimension]: { state: "done", run: event.run },
        },
      };
    case "scan-finished":
      return { ...state, phase: "finished", scan: event.scan };
  }
}

/** Share of started analyzers that have finished, 0–100. */
export function percentDone(state: ScanProgress): number {
  if (state.phase === "finished") return 100;
  const all = Object.values(state.dimensions);
  if (all.length === 0) return state.phase === "analyzing" ? 5 : 0;
  const done = all.filter((d) => d.state === "done").length;
  return Math.round((done / all.length) * 100);
}
