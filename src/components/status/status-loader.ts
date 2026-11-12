import { parsePublicStatus, type PublicStatus } from "@/lib/status/public-status";

export type StatusLoaderEvents = {
  ok(status: PublicStatus): void;
  fail(): void;
  settled(): void;
};

/**
 * One loader per mounted board (DAN-429). It holds the signal of its own
 * mount, so a remount (StrictMode, Fast Refresh) gets a fresh loader: the
 * aborted request of the earlier mount reports nothing and does not keep the
 * new mount from asking. Only one request of a loader runs at a time.
 */
export function statusLoader(
  signal: AbortSignal,
  events: StatusLoaderEvents,
  request: (signal: AbortSignal) => Promise<Response> = (s) => fetch("/api/status", { cache: "no-store", signal: s }),
): () => Promise<void> {
  let inFlight = false;
  return async () => {
    if (inFlight || signal.aborted) return;
    inFlight = true;
    try {
      const response = await request(signal);
      const parsed = response.ok ? parsePublicStatus(await response.json()) : null;
      if (signal.aborted) return;
      if (parsed) events.ok(parsed);
      else events.fail();
    } catch {
      if (!signal.aborted) events.fail();
    } finally {
      inFlight = false;
      if (!signal.aborted) events.settled();
    }
  };
}
