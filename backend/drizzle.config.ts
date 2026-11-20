import { defineConfig } from "drizzle-kit";

/** `bunx drizzle-kit generate` writes a new migration after a change to src/db/schema.ts. */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
});
