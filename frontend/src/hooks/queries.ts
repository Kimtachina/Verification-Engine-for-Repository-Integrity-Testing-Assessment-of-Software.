"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FindingQueryInput, StartScanRequest } from "@veritas/shared";
import { api } from "@/lib/api-client";

/** Query keys in one place, so invalidation after a scan cannot miss one. */
export const keys = {
  health: ["health"] as const,
  scans: ["scans"] as const,
  scan: (id: string) => ["scan", id] as const,
  findings: (id: string, query: FindingQueryInput) => ["findings", id, query] as const,
  files: (id: string) => ["files", id] as const,
  finding: (id: string) => ["finding", id] as const,
};

export const useHealth = () =>
  useQuery({ queryKey: keys.health, queryFn: api.health, refetchInterval: 10_000, retry: false });

export const useScans = () => useQuery({ queryKey: keys.scans, queryFn: () => api.listScans(20) });

export const useScan = (id: string) =>
  useQuery({
    queryKey: keys.scan(id),
    queryFn: () => api.getScan(id),
    // A running scan is refreshed by its event stream; this is only a safety net.
    refetchInterval: (q) => (q.state.data?.status === "running" ? 5_000 : false),
  });

export const useFindings = (id: string, query: FindingQueryInput) =>
  useQuery({
    queryKey: keys.findings(id, query),
    queryFn: () => api.findings(id, query),
    // Keep the old page on screen while the next one loads, so the table does not jump.
    placeholderData: keepPreviousData,
  });

export const useFiles = (id: string) =>
  useQuery({ queryKey: keys.files(id), queryFn: () => api.files(id) });

export const useFinding = (id: string) =>
  useQuery({ queryKey: keys.finding(id), queryFn: () => api.getFinding(id) });

export function useStartScan() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: StartScanRequest) => api.startScan(body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.health });
      void client.invalidateQueries({ queryKey: keys.scans });
    },
  });
}
