import type { Dimension, Finding } from "@veritas/shared";
import type { ResolvedConfig } from "../../config/load-config";
import type { DiscoveryResult } from "../discovery/source-file";

/**
 * What an analyzer reports. The pipeline fills in id, fingerprint, dimension,
 * language and snippet, so analyzers only describe the problem itself.
 */
export type RawFinding = Omit<
  Finding,
  "id" | "fingerprint" | "dimension" | "language" | "snippet"
> & {
  /** Overrides the snippet the pipeline would cut from the file. */
  snippet?: string;
};

/** `file` value for findings about the project as a whole rather than one file. */
export const PROJECT_FILE = ".";

export interface AnalyzerContext {
  config: ResolvedConfig;
  discovery: DiscoveryResult;
  /** Aborted on timeout. Analyzers that spawn processes must pass it on. */
  signal: AbortSignal;
  /**
   * Computes `compute()` once per scan and shares the result between analyzers, e.g.
   * parsing every Python file once for complexity, correctness and maintainability.
   * The first caller's `signal` governs the shared computation.
   */
  memo<T>(key: string, compute: () => Promise<T>): Promise<T>;
}

export type Memo = AnalyzerContext["memo"];

/** A memo whose cache lives as long as the returned function. One per scan. */
export function createMemo(): Memo {
  const cache = new Map<string, Promise<unknown>>();
  return <T>(key: string, compute: () => Promise<T>): Promise<T> => {
    let promise = cache.get(key) as Promise<T> | undefined;
    if (!promise) {
      promise = compute();
      cache.set(key, promise);
    }
    return promise;
  };
}

export type AnalyzerResult =
  | {
      status: "completed";
      findings: RawFinding[];
      /** Caveat about partial coverage, e.g. "Python files not measured: python3 not found". */
      note?: string;
    }
  | { status: "skipped"; reason: string };

export interface Analyzer {
  dimension: Dimension;
  run(context: AnalyzerContext): Promise<AnalyzerResult>;
}
