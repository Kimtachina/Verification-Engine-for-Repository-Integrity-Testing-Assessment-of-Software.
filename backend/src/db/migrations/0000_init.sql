CREATE SCHEMA "veritas";
--> statement-breakpoint
CREATE TABLE "veritas"."findings" (
	"id" text PRIMARY KEY NOT NULL,
	"scan_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"dimension" text NOT NULL,
	"severity" text NOT NULL,
	"severity_rank" smallint NOT NULL,
	"rule_id" text NOT NULL,
	"file" text NOT NULL,
	"start_line" integer,
	"message" text NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "veritas"."findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "veritas"."scans" (
	"id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"root" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"score" double precision,
	"grade" text,
	"gate_passed" boolean,
	"error" text,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "veritas"."scans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "veritas"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "veritas"."settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "veritas"."findings" ADD CONSTRAINT "findings_scan_id_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "veritas"."scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "findings_scan_order_idx" ON "veritas"."findings" USING btree ("scan_id","severity_rank","file","start_line" NULLS FIRST);--> statement-breakpoint
CREATE INDEX "findings_scan_fingerprint_idx" ON "veritas"."findings" USING btree ("scan_id","fingerprint");--> statement-breakpoint
CREATE INDEX "findings_scan_dimension_idx" ON "veritas"."findings" USING btree ("scan_id","dimension");--> statement-breakpoint
CREATE INDEX "scans_started_at_idx" ON "veritas"."scans" USING btree ("started_at");