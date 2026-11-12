import { z } from "zod";
import { findingSchema } from "./finding.schema";
import { scanSchema } from "./scan.schema";

export const REPORT_FORMATS = ["json", "markdown", "html", "sarif"] as const;
export const reportFormatSchema = z.enum(REPORT_FORMATS);
export type ReportFormat = z.infer<typeof reportFormatSchema>;

/** The complete, self-contained result of one scan. This is the JSON report format. */
export const reportSchema = z.object({
  schemaVersion: z.literal(1),
  veritasVersion: z.string().min(1),
  generatedAt: z.iso.datetime(),
  scan: scanSchema,
  findings: z.array(findingSchema),
});
export type Report = z.infer<typeof reportSchema>;

/** Result of comparing two scans of the same code, matched by finding fingerprint. */
export const scanComparisonSchema = z.object({
  baseScanId: z.string().min(1),
  headScanId: z.string().min(1),
  scoreDelta: z.number().nullable(),
  /** In head but not base. */
  introduced: z.array(findingSchema),
  /** In base but not head. */
  resolved: z.array(findingSchema),
  /** Present in both. Counted, not listed, to keep the payload small. */
  persistingCount: z.int().nonnegative(),
});
export type ScanComparison = z.infer<typeof scanComparisonSchema>;
