import { z } from "zod";
import { dimensionSchema, severitySchema } from "./finding.schema";

/**
 * Paths always skipped, on top of user `ignore` patterns. Dependency folders, build
 * output and VCS metadata are not the author's code and would swamp every metric.
 */
export const DEFAULT_IGNORE = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/.next/**",
  "**/coverage/**",
  "**/__pycache__/**",
  "**/.venv/**",
  "**/venv/**",
  "**/*.min.js",
  "**/*.map",
  "**/*.lock",
  "**/package-lock.json",
  "**/pnpm-lock.yaml",
] as const;

export const thresholdsSchema = z.object({
  /** Functions above this cyclomatic complexity are reported. */
  maxCyclomatic: z.int().positive().default(10),
  /**
   * Functions above this cognitive complexity are reported. Unlike cyclomatic, it
   * penalises nesting, so it tracks how hard code is to read rather than to test.
   */
  maxCognitive: z.int().positive().default(15),
  /** Functions nested deeper than this are reported. */
  maxNesting: z.int().positive().default(4),
  maxFunctionLines: z.int().positive().default(60),
  maxFileLines: z.int().positive().default(500),
  /** Text files larger than this (KiB) are flagged by the integrity analyzer. */
  maxFileSizeKb: z.int().positive().default(512),
  /** Minimum duplicated block size (lines) the duplication analyzer reports. */
  minDuplicateLines: z.int().positive().default(8),
  /** Test files per source file below which the testing dimension reports a finding. */
  minTestRatio: z.number().min(0).max(1).default(0.2),
  /** Share of all source lines that may be duplicated before a project-level finding. */
  maxDuplicatePercent: z.number().min(0).max(100).default(5),
  /** Share of public functions and classes that should have a doc comment or docstring. */
  minDocCoverage: z.number().min(0).max(1).default(0.3),
});

export const gateSchema = z.object({
  /** Any finding at or above this severity fails the gate. */
  failOn: severitySchema.default("critical"),
  /** Overall score below this fails the gate. 0 disables the check. */
  minScore: z.number().min(0).max(100).default(0),
});

export const configSchema = z.object({
  /** Directory to scan, relative to the config file. */
  root: z.string().min(1).default("code"),
  /** Extra glob patterns to skip, added to DEFAULT_IGNORE. */
  ignore: z.array(z.string().min(1)).default([]),
  /** Dimensions to run. Defaults to all. */
  dimensions: z.array(dimensionSchema).min(1).optional(),
  /** Overrides for dimension weights in the overall score. Missing keys keep defaults. */
  weights: z.partialRecord(dimensionSchema, z.number().nonnegative()).default({}),
  thresholds: thresholdsSchema.prefault({}),
  /**
   * Semgrep rule sets for the security dimension. Registry rule sets ("p/...") are
   * downloaded from semgrep.dev; the scanned code itself is never uploaded.
   */
  semgrepRules: z.array(z.string().min(1)).min(1).default(["p/default"]),
  gate: gateSchema.prefault({}),
  /** Per-analyzer timeout. A timed-out analyzer is marked failed; the scan continues. */
  analyzerTimeoutMs: z.int().positive().default(120_000),
});

/** What a user writes in veritas.config.ts. Every field is optional. */
export type ConfigInput = z.input<typeof configSchema>;
/** Fully resolved config with every default applied. */
export type Config = z.output<typeof configSchema>;

/** Identity helper that gives `veritas.config.ts` type checking and autocompletion. */
export function defineConfig(config: ConfigInput): ConfigInput {
  return config;
}
