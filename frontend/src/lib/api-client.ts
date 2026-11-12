import { type Finding, findingSchema, type Scan, scanSchema } from "@veritas/shared";
import { type ZodType, z } from "zod";

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const DEFAULT_BASE_URL = "http://localhost:4000";

/**
 * Typed client for the VERITAS API. Every response is validated against the shared
 * schema, so a backend/frontend mismatch fails loudly here instead of rendering bad data.
 */
export function createApiClient(baseUrl: string = DEFAULT_BASE_URL) {
  async function request<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ApiError(body || response.statusText, response.status);
    }
    const parsed = schema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ApiError(`Unexpected response from ${path}: ${z.prettifyError(parsed.error)}`, 502);
    }
    return parsed.data;
  }

  return {
    listScans: (): Promise<Scan[]> => request("/api/scans", z.array(scanSchema)),
    getScan: (id: string): Promise<Scan> =>
      request(`/api/scans/${encodeURIComponent(id)}`, scanSchema),
    startScan: (): Promise<Scan> => request("/api/scans", scanSchema, { method: "POST" }),
    getFinding: (id: string): Promise<Finding> =>
      request(`/api/findings/${encodeURIComponent(id)}`, findingSchema),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
