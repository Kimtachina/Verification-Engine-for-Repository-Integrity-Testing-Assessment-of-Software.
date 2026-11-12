import { z } from "zod";
import { DIMENSIONS } from "../constants/dimension";
import { LANGUAGES } from "../constants/language";
import { SEVERITIES } from "../constants/severity";

export const severitySchema = z.enum(SEVERITIES);
export const dimensionSchema = z.enum(DIMENSIONS);
export const languageSchema = z.enum(LANGUAGES);

/** One problem found in the code under inspection. */
export const findingSchema = z
  .object({
    id: z.string().min(1),
    /**
     * Stable identity across scans: derived from rule, file and normalised line content,
     * never from line numbers, so a finding keeps its fingerprint when code above it moves.
     */
    fingerprint: z.string().regex(/^[a-f0-9]{16,64}$/, "fingerprint must be lowercase hex"),
    dimension: dimensionSchema,
    severity: severitySchema,
    ruleId: z.string().min(1),
    message: z.string().min(1),
    /** Path relative to the scanned root, always with forward slashes. */
    file: z
      .string()
      .min(1)
      .refine((p) => !p.startsWith("/") && !p.includes("\\") && !p.split("/").includes(".."), {
        message: "file must be a relative forward-slash path inside the scan root",
      }),
    language: languageSchema,
    /** 1-based. Absent for whole-file or project-level findings (e.g. "no tests"). */
    startLine: z.int().positive().optional(),
    endLine: z.int().positive().optional(),
    snippet: z.string().max(4000).optional(),
    suggestion: z.string().optional(),
    /** Tool or built-in analyzer that produced it, e.g. "semgrep" or "veritas". */
    source: z.string().min(1),
    /** Link to the rule's documentation, when the tool provides one. */
    helpUrl: z.url().optional(),
  })
  .refine((f) => f.endLine === undefined || f.startLine !== undefined, {
    message: "endLine requires startLine",
    path: ["endLine"],
  })
  .refine((f) => f.startLine === undefined || f.endLine === undefined || f.endLine >= f.startLine, {
    message: "endLine must not be before startLine",
    path: ["endLine"],
  });

export type Finding = z.infer<typeof findingSchema>;
