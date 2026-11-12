import { defineConfig } from "@veritas/shared";

/**
 * VERITAS settings. Every field is optional; delete a line to use its default.
 * Full list: shared/src/schemas/config.schema.ts
 */
export default defineConfig({
  root: "code",
  ignore: [],
  thresholds: {
    maxCyclomatic: 10,
    maxNesting: 4,
    maxFunctionLines: 60,
    maxFileLines: 500,
  },
  gate: {
    failOn: "critical",
    minScore: 0,
  },
});
