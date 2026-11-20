-- Move the tables from the "veritas" schema to "public", keeping every row, index,
-- constraint and RLS setting, so they appear first in Supabase's Table Editor.
ALTER TABLE "veritas"."scans" SET SCHEMA "public";
--> statement-breakpoint
ALTER TABLE "veritas"."findings" SET SCHEMA "public";
--> statement-breakpoint
ALTER TABLE "veritas"."settings" SET SCHEMA "public";
--> statement-breakpoint
DROP SCHEMA "veritas";
--> statement-breakpoint
-- Supabase serves "public" through its REST API and grants its API roles access to new
-- tables. RLS with no policies already denies them every row; revoking the grants too
-- means a policy added by mistake still opens nothing. Skipped where the roles do not
-- exist (plain Postgres, the embedded database).
DO $$
DECLARE api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.scans, public.findings, public.settings FROM %I', api_role);
    END IF;
  END LOOP;
END $$;
