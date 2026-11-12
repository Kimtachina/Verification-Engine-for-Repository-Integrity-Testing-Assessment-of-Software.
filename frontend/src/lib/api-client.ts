import {
  apiErrorSchema,
  type FileSummary,
  type Finding,
  type FindingPage,
  type FindingQueryInput,
  fileSummarySchema,
  findingPageSchema,
  findingSchema,
  type Health,
  healthSchema,
  type ReportFormat,
  type Scan,
  type ScanComparison,
  type Settings,
  type SettingsOverrides,
  type StartScanRequest,
  scanComparisonSchema,
  scanSchema,
  settingsSchema,
} from "@veritas/shared";
import { type ZodType, z } from "zod";

/** Where the VERITAS API runs. Set NEXT_PUBLIC_VERITAS_API to point elsewhere. */
export const API_BASE = process.env.NEXT_PUBLIC_VERITAS_API ?? "http://127.0.0.1:4000";

export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    message: string,
    /** HTTP status, or 0 when the API could not be reached at all. */
    readonly status: number,
    readonly details?: string,
  ) {
    super(message);
  }
}

/**
 * Typed client for the VERITAS API. Every response is validated against the shared
 * schema, so a backend/frontend mismatch fails loudly here instead of rendering bad data.
 */
export function createApiClient(baseUrl: string = API_BASE) {
  async function request<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL(path, baseUrl), {
        ...init,
        headers: { "content-type": "application/json", ...init?.headers },
      });
    } catch {
      throw new ApiError(`Cannot reach the VERITAS API at ${baseUrl}`, 0);
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(body);
      throw new ApiError(
        parsed.success ? parsed.data.error : response.statusText,
        response.status,
        parsed.success ? parsed.data.details : undefined,
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(`Unexpected response from ${path}: ${z.prettifyError(parsed.error)}`, 502);
    }
    return parsed.data;
  }

  return {
    health: (): Promise<Health> => request("/api/health", healthSchema),
    listScans: (limit = 50): Promise<Scan[]> =>
      request(`/api/scans?limit=${limit}`, z.array(scanSchema)),
    getScan: (id: string): Promise<Scan> =>
      request(`/api/scans/${encodeURIComponent(id)}`, scanSchema),
    startScan: (body: StartScanRequest = {}): Promise<Scan> =>
      request("/api/scans", scanSchema, { method: "POST", body: JSON.stringify(body) }),
    findings: (id: string, query: FindingQueryInput = {}): Promise<FindingPage> =>
      request(
        `/api/scans/${encodeURIComponent(id)}/findings${toQueryString(query)}`,
        findingPageSchema,
      ),
    files: (id: string): Promise<FileSummary[]> =>
      request(`/api/scans/${encodeURIComponent(id)}/files`, z.array(fileSummarySchema)),
    compare: (headId: string, baseId: string): Promise<ScanComparison> =>
      request(
        `/api/scans/${encodeURIComponent(headId)}/compare/${encodeURIComponent(baseId)}`,
        scanComparisonSchema,
      ),
    getFinding: (id: string): Promise<Finding> =>
      request(`/api/findings/${encodeURIComponent(id)}`, findingSchema),
    settings: (): Promise<Settings> => request("/api/settings", settingsSchema),
    saveSettings: (overrides: SettingsOverrides): Promise<Settings> =>
      request("/api/settings", settingsSchema, { method: "PUT", body: JSON.stringify(overrides) }),
    /** For <a download> and EventSource, which need a URL rather than a fetch. */
    reportUrl: (id: string, format: ReportFormat = "json") =>
      new URL(`/api/scans/${encodeURIComponent(id)}/report?format=${format}`, baseUrl).toString(),
    eventsUrl: (id: string) =>
      new URL(`/api/scans/${encodeURIComponent(id)}/events`, baseUrl).toString(),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** `{ severity: ["high", "low"], limit: 50 }` → `?severity=high,low&limit=50`. Skips empty values. */
export function toQueryString(query: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length > 0) params.set(key, value.join(","));
    } else {
      params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export const api = createApiClient();
