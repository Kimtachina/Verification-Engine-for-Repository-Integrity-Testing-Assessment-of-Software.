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
  type Upload,
  uploadSchema,
} from "@veritas/shared";
import { type ZodType, z } from "zod";

/**
 * Where the VERITAS API runs. Set NEXT_PUBLIC_VERITAS_API to point elsewhere; "/" means the
 * same origin as the dashboard (the Docker image serves both on one port).
 */
export const API_BASE = process.env.NEXT_PUBLIC_VERITAS_API || "http://127.0.0.1:4000";

/** A path base ("/") resolves against the page's own origin, in the browser. */
function absoluteBase(base: string): string {
  return base.startsWith("/") && typeof window !== "undefined"
    ? new URL(base, window.location.origin).toString()
    : base;
}

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
  const base = () => absoluteBase(baseUrl);
  async function request<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL(path, base()), {
        ...init,
        headers: { "content-type": "application/json", ...init?.headers },
      });
    } catch {
      throw new ApiError(`Cannot reach the VERITAS API at ${baseUrl}`, 0);
    }
    // The session ran out on a password-protected server: back to its login page.
    if (response.status === 401 && typeof window !== "undefined" && baseUrl.startsWith("/")) {
      window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
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
    /**
     * Uploads a chosen folder. XMLHttpRequest rather than fetch, because only XHR reports
     * upload progress. Each file's multipart filename is its path inside the folder.
     */
    uploadFolder: (
      name: string,
      files: ReadonlyArray<{ file: Blob; path: string }>,
      onProgress: (fraction: number) => void,
    ): Promise<Upload> =>
      new Promise((resolve, reject) => {
        const form = new FormData();
        form.append("name", name);
        for (const f of files) form.append("files", f.file, f.path);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", new URL("/api/uploads", base()));
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(e.loaded / e.total);
        };
        xhr.onerror = () => reject(new ApiError(`Cannot reach the VERITAS API at ${baseUrl}`, 0));
        xhr.onload = () => {
          let body: unknown = null;
          try {
            body = JSON.parse(xhr.responseText);
          } catch {}
          if (xhr.status >= 200 && xhr.status < 300) {
            const parsed = uploadSchema.safeParse(body);
            if (parsed.success) resolve(parsed.data);
            else reject(new ApiError("Unexpected response from /api/uploads", 502));
          } else {
            const parsed = apiErrorSchema.safeParse(body);
            reject(new ApiError(parsed.success ? parsed.data.error : xhr.statusText, xhr.status));
          }
        };
        xhr.send(form);
      }),
    /** For <a download> and EventSource, which need a URL rather than a fetch. */
    reportUrl: (id: string, format: ReportFormat = "json") =>
      new URL(`/api/scans/${encodeURIComponent(id)}/report?format=${format}`, base()).toString(),
    eventsUrl: (id: string) =>
      new URL(`/api/scans/${encodeURIComponent(id)}/events`, base()).toString(),
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
