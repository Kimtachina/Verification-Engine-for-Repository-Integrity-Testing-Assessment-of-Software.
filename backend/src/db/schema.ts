import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * Everything lives in its own schema. On Supabase only `public` is served by the REST
 * API, so these tables are reachable only through the VERITAS backend; RLS without
 * policies is a second lock in case the schema is ever exposed.
 */
export const veritas = pgSchema("veritas");

const isoTime = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

/**
 * One row per scan. Columns hold what is listed and sorted on; `data` holds the full
 * validated `Scan` as JSON, so the API returns exactly what the engine produced.
 */
export const scans = veritas
  .table(
    "scans",
    {
      id: text("id").primaryKey(),
      status: text("status", { enum: ["queued", "running", "completed", "failed"] }).notNull(),
      root: text("root").notNull(),
      startedAt: isoTime("started_at").notNull(),
      finishedAt: isoTime("finished_at"),
      score: doublePrecision("score"),
      grade: text("grade"),
      gatePassed: boolean("gate_passed"),
      error: text("error"),
      data: jsonb("data").notNull(),
    },
    (t) => [index("scans_started_at_idx").on(t.startedAt)],
  )
  .enableRLS();

/**
 * One row per finding. Filter and sort columns are real columns with indexes; `data`
 * holds the full validated `Finding`.
 */
export const findings = veritas
  .table(
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
      severityRank: smallint("severity_rank").notNull(),
      ruleId: text("rule_id").notNull(),
      file: text("file").notNull(),
      startLine: integer("start_line"),
      message: text("message").notNull(),
      data: jsonb("data").notNull(),
    },
    (t) => [
      index("findings_scan_order_idx").on(
        t.scanId,
        t.severityRank,
        t.file,
        t.startLine.asc().nullsFirst(),
      ),
      index("findings_scan_fingerprint_idx").on(t.scanId, t.fingerprint),
      index("findings_scan_dimension_idx").on(t.scanId, t.dimension),
    ],
  )
  .enableRLS();

/** Key/value store for small server-side state; "overrides" holds the dashboard settings. */
export const settings = veritas
  .table("settings", {
    key: text("key").primaryKey(),
    value: jsonb("value").notNull(),
    updatedAt: isoTime("updated_at").notNull(),
  })
  .enableRLS();
