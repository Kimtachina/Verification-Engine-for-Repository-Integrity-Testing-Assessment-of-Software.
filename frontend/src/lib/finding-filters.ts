import {
  DIMENSIONS,
  type Dimension,
  FINDING_SORTS,
  type FindingQueryInput,
  SEVERITIES,
  type Severity,
} from "@veritas/shared";

export const PAGE_SIZE = 50;

export interface FindingFilters {
  severity: Severity[];
  dimension: Dimension[];
  file: string;
  q: string;
  sort: (typeof FINDING_SORTS)[number];
  page: number;
}

const list = <T extends string>(raw: string | null, allowed: readonly T[]): T[] =>
  (raw ?? "").split(",").filter((v): v is T => (allowed as readonly string[]).includes(v));

/**
 * Filters live in the URL, so a filtered view can be linked, bookmarked and restored with
 * the back button. Unknown values are dropped rather than sent to the API.
 */
export function filtersFromParams(params: URLSearchParams): FindingFilters {
  const sort = params.get("sort");
  const page = Number(params.get("page"));
  return {
    severity: list(params.get("severity"), SEVERITIES),
    dimension: list(params.get("dimension"), DIMENSIONS),
    file: params.get("file") ?? "",
    q: params.get("q") ?? "",
    sort: (FINDING_SORTS as readonly string[]).includes(sort ?? "")
      ? (sort as FindingFilters["sort"])
      : "severity",
    page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

export function filtersToParams(filters: FindingFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.severity.length) params.set("severity", filters.severity.join(","));
  if (filters.dimension.length) params.set("dimension", filters.dimension.join(","));
  if (filters.file) params.set("file", filters.file);
  if (filters.q) params.set("q", filters.q);
  if (filters.sort !== "severity") params.set("sort", filters.sort);
  if (filters.page > 1) params.set("page", String(filters.page));
  return params;
}

export function filtersToQuery(filters: FindingFilters): FindingQueryInput {
  const query: FindingQueryInput = {
    sort: filters.sort,
    limit: PAGE_SIZE,
    offset: (filters.page - 1) * PAGE_SIZE,
  };
  if (filters.severity.length) query.severity = filters.severity;
  if (filters.dimension.length) query.dimension = filters.dimension;
  if (filters.file) query.file = filters.file;
  if (filters.q.trim()) query.q = filters.q.trim();
  return query;
}

/** Link to a scan's findings filtered by one field, e.g. from a file or dimension card. */
export function findingsHref(scanId: string, filter: Partial<FindingFilters>): string {
  const params = filtersToParams({
    severity: [],
    dimension: [],
    file: "",
    q: "",
    sort: "severity",
    page: 1,
    ...filter,
  });
  const qs = params.toString();
  return `/scans/${scanId}${qs ? `?${qs}` : ""}`;
}
