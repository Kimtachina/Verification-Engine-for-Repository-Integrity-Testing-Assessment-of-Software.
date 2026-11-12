import { z } from "zod";
import { dimensionSchema, findingSchema, severitySchema } from "./finding.schema";

/** Body of POST /api/scans. Every field is optional; the server's config fills the rest. */
export const startScanRequestSchema = z
  .object({
    /** Run only these dimensions. */
    dimensions: z.array(dimensionSchema).min(1).optional(),
    failOn: severitySchema.optional(),
    minScore: z.number().min(0).max(100).optional(),
  })
  .strict();
export type StartScanRequest = z.infer<typeof startScanRequestSchema>;

/** Accepts "a,b" from a query string as well as repeated values. */
const csv = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v),
    z.array(item).min(1),
  );

export const FINDING_SORTS = ["severity", "file", "dimension"] as const;

/** Query string of GET /api/scans/:id/findings. */
export const findingQuerySchema = z
  .object({
    severity: csv(severitySchema).optional(),
    dimension: csv(dimensionSchema).optional(),
    /** Exact file, or a folder prefix ending in "/". */
    file: z.string().min(1).max(1000).optional(),
    /** Case-insensitive text search in message, rule and file. */
    q: z.string().min(1).max(200).optional(),
    sort: z.enum(FINDING_SORTS).default("severity"),
    limit: z.coerce.number().int().min(1).max(500).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();
export type FindingQuery = z.infer<typeof findingQuerySchema>;
export type FindingQueryInput = z.input<typeof findingQuerySchema>;

export const findingPageSchema = z.object({
  items: z.array(findingSchema),
  /** Matches before limit/offset, for pagination. */
  total: z.int().nonnegative(),
  limit: z.int().positive(),
  offset: z.int().nonnegative(),
});
export type FindingPage = z.infer<typeof findingPageSchema>;

export const toolStatusSchema = z.object({
  name: z.string(),
  available: z.boolean(),
  /** Where it was found: bundled with VERITAS or from PATH. */
  source: z.enum(["bundled", "path"]).nullable(),
});

export const healthSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  /** Absolute path the server scans. */
  root: z.string(),
  tools: z.array(toolStatusSchema),
  /** Id of the scan currently running, if any. */
  runningScanId: z.string().nullable(),
});
export type Health = z.infer<typeof healthSchema>;

/** Every non-2xx response body. */
export const apiErrorSchema = z.object({
  error: z.string(),
  /** Field-level details for validation errors. */
  details: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** One row of GET /api/scans/:id/files: how many findings a file has, by severity. */
export const fileSummarySchema = z.object({
  /** Scan-relative path; "." for findings about the whole project. */
  file: z.string(),
  total: z.int().nonnegative(),
  critical: z.int().nonnegative(),
  high: z.int().nonnegative(),
  medium: z.int().nonnegative(),
  low: z.int().nonnegative(),
  info: z.int().nonnegative(),
});
export type FileSummary = z.infer<typeof fileSummarySchema>;
