import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * One row per scan. Columns hold what is listed and sorted on; `data` holds the full
 * validated `Scan` as JSON, so the API returns exactly what the engine produced.
 */
export const scans = sqliteTable(
  "scans",
  {
    id: text("id").primaryKey(),
    status: text("status", { enum: ["queued", "running", "completed", "failed"] }).notNull(),
    root: text("root").notNull(),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    score: real("score"),
    grade: text("grade"),
    gatePassed: integer("gate_passed", { mode: "boolean" }),
    error: text("error"),
    data: text("data", { mode: "json" }).notNull(),
  },
  (t) => [index("scans_started_at_idx").on(t.startedAt)],
);

/**
 * One row per finding. Filter and sort columns are real columns with indexes; `data`
 * holds the full validated `Finding`.
 */
export const findings = sqliteTable(
  "findings",
  {
    id: text("id").primaryKey(),
    scanId: text("scan_id")
      .notNull()
      .references(() => scans.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    dimension: text("dimension").notNull(),
    severity: text("severity").notNull(),
    /** 0 = critical … 4 = info, so ORDER BY gives worst first. */
    severityRank: integer("severity_rank").notNull(),
    ruleId: text("rule_id").notNull(),
    file: text("file").notNull(),
    startLine: integer("start_line"),
    message: text("message").notNull(),
    data: text("data", { mode: "json" }).notNull(),
  },
  (t) => [
    index("findings_scan_order_idx").on(t.scanId, t.severityRank, t.file, t.startLine),
    index("findings_scan_fingerprint_idx").on(t.scanId, t.fingerprint),
    index("findings_scan_dimension_idx").on(t.scanId, t.dimension),
  ],
);

/** Key/value store for small server-side state; "overrides" holds the dashboard settings. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: text("updated_at").notNull(),
});
