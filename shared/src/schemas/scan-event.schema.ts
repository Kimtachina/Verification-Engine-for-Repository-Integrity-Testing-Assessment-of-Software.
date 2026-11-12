import { z } from "zod";
import { dimensionSchema } from "./finding.schema";
import { analyzerRunSchema, scanSchema } from "./scan.schema";

/** Progress events emitted while a scan runs. Streamed to the dashboard over SSE. */
export const scanEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("discovery-started") }),
  z.object({
    type: z.literal("discovery-finished"),
    files: z.int().nonnegative(),
    lines: z.int().nonnegative(),
  }),
  z.object({ type: z.literal("analyzer-started"), dimension: dimensionSchema }),
  z.object({ type: z.literal("analyzer-finished"), run: analyzerRunSchema }),
  z.object({ type: z.literal("scan-finished"), scan: scanSchema }),
]);

export type ScanEvent = z.infer<typeof scanEventSchema>;
