import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/*
 * Tables live in `public`, so they show up first in Supabase's Table Editor. Supabase
 * serves `public` through its REST API, so every table has row level security on with no
 * policies (the API keys can read and write nothing), and migration 0001 also revokes the
 * API roles' grants. Only the VERITAS backend, connecting as the database owner, uses them.
 * Never add RLS policies to these tables.
 */

const isoTime = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });

/**
 * One row per scan. Columns hold what is listed and sorted on; `data` holds the full
 * validated `Scan` as JSON, so the API returns exactly what the engine produced.
 */
export const scans = pgTable(
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
).enableRLS();

/**
 * One row per finding. Filter and sort columns are real columns with indexes; `data`
 * holds the full validated `Finding`.
 */
export const findings = pgTable(
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
).enableRLS();

/** Key/value store for small server-side state; "overrides" holds the dashboard settings. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: isoTime("updated_at").notNull(),
}).enableRLS();
