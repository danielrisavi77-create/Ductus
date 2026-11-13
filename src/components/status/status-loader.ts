import { parsePublicStatus, type PublicStatus } from "@/lib/status/public-status";

/** Longest wait for one answer; a request that hangs counts as failed, so polling and retry go on. */
export const REQUEST_TIMEOUT_MS = 10_000;

export type StatusLoaderEvents = {
  ok(status: PublicStatus): void;
  fail(): void;
  settled(): void;
};

/**
 * One loader per mounted board (DAN-429). It holds the signal of its own
 * mount, so a remount (StrictMode, Fast Refresh) gets a fresh loader: the
 * aborted request of the earlier mount reports nothing and does not keep the
 * new mount from asking. Only one request of a loader runs at a time, and
 * none longer than REQUEST_TIMEOUT_MS.
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
    const limit = new AbortController();
    const stop = () => limit.abort();
    signal.addEventListener("abort", stop);
    const timer = setTimeout(stop, REQUEST_TIMEOUT_MS);
    try {
      const response = await request(limit.signal);
      const parsed = response.ok ? parsePublicStatus(await response.json()) : null;
      if (signal.aborted) return;
      if (parsed) events.ok(parsed);
      else events.fail();
    } catch {
      if (!signal.aborted) events.fail();
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      inFlight = false;
      if (!signal.aborted) events.settled();
    }
  };
}

/**
 * Calls onWake when the page may have been away: it became visible again, was
 * restored from the back-forward cache, or the network came back. Timers stop
 * while a device sleeps, so the board asks at once instead of showing an old
 * answer until the next poll. Returns the function that stops listening.
 */
export function onWake(win: EventTarget, doc: EventTarget & { visibilityState: string }, wake: () => void): () => void {
  const visible = () => {
    if (doc.visibilityState === "visible") wake();
  };
  win.addEventListener("pageshow", wake);
  win.addEventListener("online", wake);
  doc.addEventListener("visibilitychange", visible);
  return () => {
    win.removeEventListener("pageshow", wake);
    win.removeEventListener("online", wake);
    doc.removeEventListener("visibilitychange", visible);
  };
}
