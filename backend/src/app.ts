import { cors } from "@elysiajs/cors";
import type { Health } from "@veritas/shared";
import { Elysia } from "elysia";
import { ConfigError } from "./config/load-config";
import type { ScanRepository } from "./db/scan-repository";
import { toolStatuses } from "./engine/adapters/tools";
import { scanRoutes } from "./routes/scans.route";
import { HttpError, notFound } from "./services/http-error";
import type { ScanRunner } from "./services/scan-runner";
import { VERITAS_VERSION } from "./version";

export interface AppDeps {
  repo: ScanRepository;
  runner: ScanRunner;
  /** Absolute path the server scans, reported by /api/health. */
  root: string;
  /** Origins allowed to call the API from a browser (the dashboard). */
  corsOrigins: string[];
}

/**
 * The HTTP API. Built as a factory so tests call `app.handle(request)` directly,
 * without opening a port.
 */
export function createApp({ repo, runner, root, corsOrigins }: AppDeps) {
  return new Elysia()
    .use(cors({ origin: corsOrigins, methods: ["GET", "POST"] }))
    .onError(({ code, error }) => {
      if (error instanceof HttpError) {
        return json(error.status, {
          error: error.message,
          ...(error.details && { details: error.details }),
        });
      }
      if (error instanceof ConfigError) return json(400, { error: error.message });
      if (code === "NOT_FOUND") return json(404, { error: "Not found" });
      if (code === "PARSE") return json(400, { error: "Request body is not valid JSON" });
      // Never leak internals (paths, stack traces) to the client; log them for the operator.
      console.error("Unhandled API error:", error);
      return json(500, { error: "Internal server error" });
    })
    .get(
      "/api/health",
      (): Health => ({
        status: "ok",
        version: VERITAS_VERSION,
        root,
        tools: toolStatuses(),
        runningScanId: runner.runningScanId,
      }),
    )
    .use(scanRoutes({ repo, runner }))
    .get("/api/findings/:id", ({ params }) => {
      const finding = repo.getFinding(params.id);
      if (!finding) throw notFound("Finding");
      return finding;
    });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
