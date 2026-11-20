import type { ScanEvent } from "@veritas/shared";
import type { ScanRepository } from "../db/scan-repository";
import type { ScanRunner } from "../services/scan-runner";

/** Proxies and browsers drop idle connections; a comment line every 15 s keeps it open. */
const HEARTBEAT_MS = 15_000;

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  // Stops nginx-style proxies from buffering the stream.
  "x-accel-buffering": "no",
};

/**
 * Server-Sent Events for one scan. A running scan replays its events so far, then streams
 * live ones and closes after `scan-finished`. A finished scan sends one `scan-finished`
 * with its stored result and closes, so clients need no special case for late arrival.
 *
 * Callers must check the scan exists first.
 */
export function scanEventStream(
  scanId: string,
  runner: ScanRunner,
  repo: ScanRepository,
  signal: AbortSignal,
): Response {
  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text));
      };
      const send = (event: ScanEvent) =>
        write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup();
        controller.close();
      };

      const subscription = runner.subscribe(scanId, (event) => {
        send(event);
        if (event.type === "scan-finished") close();
      });

      if (!subscription) {
        const scan = await repo.getScan(scanId);
        if (scan) send({ type: "scan-finished", scan });
        close();
        return;
      }

      for (const event of subscription.replay) send(event);
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
      };
      signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
