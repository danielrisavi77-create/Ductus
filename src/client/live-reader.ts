/**
 * The reading side of the live view (DAN-86 with D-142; route GET
 * /api/live/<documentId>, docs/BACKEND.md 4.12 t. 6 to t. 8, PR #496).
 *
 * The teacher of the assignment, and the student in the same view, read the
 * last state the student published: one canonical document, never a step,
 * a key or a time. A response is shown only when its bytes are the exact JCS
 * text of a valid document whose SHA-256 equals the ETag; anything else is
 * unavailable, never shown in part. The reader keeps the last document it
 * accepted, so a lost connection only marks the reader's own connection.
 *
 * Timing (4.12 t. 7): one request in flight, the next one second after the
 * last answer while the page is visible, and after a failure a back-off from
 * two seconds doubling up to thirty. These are client constants, not the
 * thresholds P-01 to P-04, and the page never shows them.
 */

import type { CanonicalDocument } from "@/domain/document";
import { verifyDocumentSnapshot } from "@/domain/document/snapshot";

export type LiveRead =
  | { kind: "state"; hash: string; document: CanonicalDocument }
  | { kind: "unchanged" }
  | { kind: "empty" }
  | { kind: "signedOut" | "notFound" | "unavailable" };

const ETAG = /^"([0-9a-f]{64})"$/;

export const LIVE_READ_INTERVAL_MS = 1000;
export const LIVE_RETRY_FIRST_MS = 2000;
export const LIVE_RETRY_MAX_MS = 30_000;

/** One read of the live state; `knownHash` is the hash of the document already shown. */
export async function readLiveState(
  documentId: string,
  knownHash: string | null,
  fetcher: typeof fetch = fetch,
): Promise<LiveRead> {
  let response: Response;
  try {
    response = await fetcher(`/api/live/${encodeURIComponent(documentId)}`, {
      method: "GET",
      headers: knownHash === null ? {} : { "if-none-match": `"${knownHash}"` },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { kind: "unavailable" };
  }
  const etag = ETAG.exec(response.headers.get("etag") ?? "")?.[1] ?? null;
  switch (response.status) {
    case 200: {
      if (etag === null) return { kind: "unavailable" };
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch {
        return { kind: "unavailable" };
      }
      const snapshot = await verifyDocumentSnapshot(bytes);
      if (!snapshot.ok || snapshot.sha256 !== etag) return { kind: "unavailable" };
      return { kind: "state", hash: snapshot.sha256, document: snapshot.document };
    }
    // A 304 means "the document you hold": only true when one was named and it is that one.
    case 304: return knownHash !== null && etag === knownHash ? { kind: "unchanged" } : { kind: "unavailable" };
    case 204: return { kind: "empty" };
    case 401: return { kind: "signedOut" };
    case 404: return { kind: "notFound" };
    default: return { kind: "unavailable" };
  }
}

export type LiveConnection = "loading" | "live" | "retrying" | "paused" | "signedOut" | "notFound";

export type LiveView = {
  /** The last document accepted from the route; kept through failures. */
  readonly document: CanonicalDocument | null;
  readonly hash: string | null;
  /** True once the route said the student has published nothing yet. */
  readonly empty: boolean;
  /** The state of this reader's own requests, never a statement about the student. */
  readonly connection: LiveConnection;
};

/** Page visibility as the reader needs it; a test passes its own. */
export type VisibilitySource = {
  isVisible(): boolean;
  subscribe(onChange: () => void): () => void;
};

export type LiveReaderOptions = {
  readonly documentId: string;
  readonly onChange: (view: LiveView) => void;
  /**
   * Asked before every request: a reader whose sign-in has since ended in
   * this browser stops instead of sending a cookie that may be another
   * person's (as comments, F-093).
   */
  readonly current?: () => boolean;
  readonly fetcher?: typeof fetch;
  readonly visibility?: VisibilitySource;
  readonly timers?: {
    set(run: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
};

const documentVisibility: VisibilitySource = {
  isVisible: () => document.visibilityState === "visible",
  subscribe(onChange) {
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  },
};

const windowTimers = {
  set: (run: () => void, ms: number): unknown => setTimeout(run, ms),
  clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Starts polling and returns the function that stops it for good. */
export function startLiveReader(options: LiveReaderOptions): () => void {
  const current = options.current ?? (() => true);
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const visibility = options.visibility ?? documentVisibility;
  const timers = options.timers ?? windowTimers;

  let view: LiveView = { document: null, hash: null, empty: false, connection: "loading" };
  let stopped = false;
  let inFlight = false;
  let timer: unknown = null;
  let retryMs = 0;

  const publish = (next: Partial<LiveView>) => {
    view = { ...view, ...next };
    options.onChange(view);
  };
  const terminal = () => view.connection === "signedOut" || view.connection === "notFound";

  const schedule = (ms: number) => {
    if (stopped || terminal()) return;
    if (timer !== null) timers.clear(timer);
    timer = timers.set(() => {
      timer = null;
      void tick();
    }, ms);
  };

  async function tick(): Promise<void> {
    if (stopped || terminal() || inFlight) return;
    if (!visibility.isVisible()) {
      publish({ connection: "paused" });
      return;
    }
    if (!current()) {
      publish({ connection: "signedOut" });
      return;
    }
    inFlight = true;
    const read = await readLiveState(options.documentId, view.hash, fetcher);
    inFlight = false;
    if (stopped) return;
    switch (read.kind) {
      case "state":
        retryMs = 0;
        publish({ document: read.document, hash: read.hash, empty: false, connection: "live" });
        break;
      case "unchanged":
        retryMs = 0;
        if (view.connection !== "live") publish({ connection: "live" });
        break;
      case "empty":
        retryMs = 0;
        publish({ document: null, hash: null, empty: true, connection: "live" });
        break;
      case "signedOut":
      case "notFound":
        publish({ connection: read.kind });
        return;
      case "unavailable":
        retryMs = retryMs === 0 ? LIVE_RETRY_FIRST_MS : Math.min(retryMs * 2, LIVE_RETRY_MAX_MS);
        publish({ connection: "retrying" });
        schedule(retryMs);
        return;
    }
    schedule(LIVE_READ_INTERVAL_MS);
  }

  const unsubscribe = visibility.subscribe(() => {
    // Back on screen: read now rather than wait out a timer set while hidden.
    if (visibility.isVisible() && !inFlight) schedule(0);
  });
  void tick();

  return () => {
    stopped = true;
    unsubscribe();
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
}
