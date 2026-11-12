import { findingQuerySchema, reportFormatSchema, startScanRequestSchema } from "@veritas/shared";
import { Elysia } from "elysia";
import { z } from "zod";
import type { ScanRepository } from "../db/scan-repository";
import { compareScans } from "../engine/compare";
import { buildReport } from "../reports/json-report";
import { renderReport } from "../reports/render-report";
import { HttpError, notFound } from "../services/http-error";
import type { ScanRunner } from "../services/scan-runner";
import { scanEventStream } from "./events";
import { parseInput } from "./validate";

const listQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

const reportQuerySchema = z.object({ format: reportFormatSchema.default("json") }).strict();

export function scanRoutes({ repo, runner }: { repo: ScanRepository; runner: ScanRunner }) {
  const requireScan = (id: string) => repo.getScan(id) ?? throwError(notFound("Scan"));
  const requireCompleted = (id: string) => {
    const scan = requireScan(id);
    if (scan.status !== "completed") {
      throw new HttpError(
        409,
        `Scan ${id} is ${scan.status}; results are available once it completes.`,
      );
    }
    return scan;
  };

  return (
    new Elysia({ prefix: "/api/scans" })
      /** Starts a scan of the configured root. 202: it continues in the background. */
      .post("/", async ({ body, set }) => {
        const request = parseInput(startScanRequestSchema, body ?? {}, "scan request");
        const scan = await runner.start(request);
        set.status = 202;
        return scan;
      })
      /** Newest first. */
      .get("/", ({ query }) => {
        const { limit, offset } = parseInput(listQuerySchema, query, "query");
        return repo.listScans(limit, offset);
      })
      .get("/:id", ({ params }) => requireScan(params.id))
      .get("/:id/findings", ({ params, query }) => {
        requireScan(params.id);
        return repo.queryFindings(params.id, parseInput(findingQuerySchema, query, "query"));
      })
      /** Findings per file, the most severe first. */
      .get("/:id/files", ({ params }) => {
        requireScan(params.id);
        return repo.fileSummaries(params.id);
      })
      .get("/:id/events", ({ params, request }) => {
        requireScan(params.id);
        return scanEventStream(params.id, runner, repo, request.signal);
      })
      /** :id is the newer scan (head), :baseId the one it is compared against. */
      .get("/:id/compare/:baseId", ({ params }) => {
        const head = requireCompleted(params.id);
        const base = requireCompleted(params.baseId);
        return compareScans(
          { scan: base, findings: repo.allFindings(base.id) },
          { scan: head, findings: repo.allFindings(head.id) },
        );
      })
      .get("/:id/report", ({ params, query }) => {
        const { format } = parseInput(reportQuerySchema, query, "query");
        const scan = requireCompleted(params.id);
        const report = buildReport({ scan, findings: repo.allFindings(scan.id) });
        const { body, contentType, extension } = renderReport(report, format);
        return new Response(body, {
          headers: {
            "content-type": contentType,
            "content-disposition": `attachment; filename="veritas-report-${scan.id}.${extension}"`,
            // The HTML report is self-contained; forbid it from loading or running anything.
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
            "x-content-type-options": "nosniff",
          },
        });
      })
  );
}

function throwError(error: Error): never {
  throw error;
}
