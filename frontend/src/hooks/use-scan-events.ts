"use client";

import { useQueryClient } from "@tanstack/react-query";
import { scanEventSchema } from "@veritas/shared";
import { useEffect, useReducer } from "react";
import { api } from "@/lib/api-client";
import { initialProgress, reduceProgress } from "@/lib/scan-progress";
import { keys } from "./queries";

const EVENT_TYPES = [
  "discovery-started",
  "discovery-finished",
  "analyzer-started",
  "analyzer-finished",
  "scan-finished",
] as const;

/**
 * Live progress of one scan over Server-Sent Events. When the scan finishes, every cached
 * query that depends on it is refreshed, so the page shows the stored result at once.
 * Pass null to stay idle.
 */
export function useScanEvents(scanId: string | null) {
  const [progress, dispatch] = useReducer(reduceProgress, initialProgress);
  const client = useQueryClient();

  useEffect(() => {
    if (!scanId) return;
    const source = new EventSource(api.eventsUrl(scanId));
    const onMessage = (message: MessageEvent<string>) => {
      const parsed = scanEventSchema.safeParse(JSON.parse(message.data));
      if (!parsed.success) return;
      dispatch(parsed.data);
      if (parsed.data.type === "scan-finished") {
        // The server closes the stream after this; stop the browser from reconnecting.
        source.close();
        void client.invalidateQueries({ queryKey: keys.scan(scanId) });
        void client.invalidateQueries({ queryKey: keys.scans });
        void client.invalidateQueries({ queryKey: keys.history });
        void client.invalidateQueries({ queryKey: keys.health });
        void client.invalidateQueries({ queryKey: ["findings", scanId] });
        void client.invalidateQueries({ queryKey: keys.files(scanId) });
      }
    };
    for (const type of EVENT_TYPES) source.addEventListener(type, onMessage);
    return () => source.close();
  }, [scanId, client]);

  return progress;
}
