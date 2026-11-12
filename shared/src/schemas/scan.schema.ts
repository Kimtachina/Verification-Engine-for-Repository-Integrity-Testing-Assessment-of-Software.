import { z } from "zod";
import { GRADES } from "../constants/grade";
import { SEVERITIES } from "../constants/severity";
import { dimensionSchema, languageSchema } from "./finding.schema";

export const gradeSchema = z.enum(GRADES);

export const scanStatusSchema = z.enum(["queued", "running", "completed", "failed"]);
export type ScanStatus = z.infer<typeof scanStatusSchema>;

/** Count of findings per severity, all severities always present. */
export const severityCountsSchema = z.object(
  Object.fromEntries(SEVERITIES.map((s) => [s, z.int().nonnegative()])) as Record<
    (typeof SEVERITIES)[number],
    z.ZodInt
  >,
);
export type SeverityCounts = z.infer<typeof severityCountsSchema>;

/**
 * Outcome of one analyzer. `skipped` means the dimension could not be measured
 * (tool missing, no applicable files); it is excluded from scoring rather than
 * counted as a perfect score.
 */
export const analyzerRunSchema = z
  .object({
    dimension: dimensionSchema,
    status: z.enum(["completed", "skipped", "failed"]),
    reason: z.string().optional(),
    durationMs: z.number().nonnegative(),
    findingCount: z.int().nonnegative(),
  })
  .refine((r) => r.status === "completed" || (r.reason !== undefined && r.reason.length > 0), {
    message: "skipped and failed runs must explain why",
    path: ["reason"],
  });
export type AnalyzerRun = z.infer<typeof analyzerRunSchema>;

export const dimensionScoreSchema = z.object({
  dimension: dimensionSchema,
  /** null when the dimension was skipped or failed. */
  score: z.number().min(0).max(100).nullable(),
  grade: gradeSchema.nullable(),
  counts: severityCountsSchema,
});
export type DimensionScore = z.infer<typeof dimensionScoreSchema>;

export const scanStatsSchema = z.object({
  files: z.int().nonnegative(),
  lines: z.int().nonnegative(),
  bytes: z.int().nonnegative(),
  byLanguage: z.partialRecord(
    languageSchema,
    z.object({ files: z.int().nonnegative(), lines: z.int().nonnegative() }),
  ),
});
export type ScanStats = z.infer<typeof scanStatsSchema>;

export const gateResultSchema = z.object({
  passed: z.boolean(),
  /** Human-readable reasons the gate failed. Empty when it passed. */
  reasons: z.array(z.string()),
});
export type GateResult = z.infer<typeof gateResultSchema>;

export const scanSchema = z.object({
  id: z.string().min(1),
  status: scanStatusSchema,
  /** Absolute path that was scanned. */
  root: z.string().min(1),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  /** Set when status is "failed". */
  error: z.string().nullable(),
  stats: scanStatsSchema.nullable(),
  analyzers: z.array(analyzerRunSchema),
  dimensions: z.array(dimensionScoreSchema),
  /** null until the scan completes, or when every dimension was skipped. */
  score: z.number().min(0).max(100).nullable(),
  grade: gradeSchema.nullable(),
  gate: gateResultSchema.nullable(),
  counts: severityCountsSchema,
});
export type Scan = z.infer<typeof scanSchema>;
