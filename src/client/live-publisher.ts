/**
 * The publishing side of the live view (B-LIVE step 4, DAN-216; route PUT
 * /api/live/<documentId>, docs/BACKEND.md 4.12 t. 6 to t. 8, PR #496).
 *
 * The student's tab that holds the document publishes the last state of the
 * work: the whole canonical document as RFC 8785 JCS bytes, never a step, a
 * key, a range or a time (4.12 t. 1, PRODUCT §5 rule 4). This is not the
 * evidence: it touches neither the journal nor the drain, and SYNCED still
 * means only a signed evidence receipt.
 *
 * Timing (4.12 t. 7 and t. 8): one request in flight; changes meanwhile
 * merge into the last state; a new request starts at the earliest one second
 * after the start of the previous one, and only when the bytes differ from
 * what the route holds (known only while nothing is in flight, so a return
 * to the accepted state during a request still goes). Without a network only
 * the last state waits, and it goes when the network is back. A conflict
 * takes the returned token and sends the last state once more, never twice
 * for the same state. 401 and 404 (no session, notice not
 * confirmed, no right to publish) stop publishing until the page loads again.
 * These are client constants, not the thresholds P-01 to P-04.
 */

import type { CanonicalDocument } from "@/domain/document";
import { canonicalizeJcs } from "@/domain/forensics/jcs";

export const LIVE_PUBLISH_GAP_MS = 1000;
export const LIVE_PUBLISH_RETRY_FIRST_MS = 2000;
export const LIVE_PUBLISH_RETRY_MAX_MS = 30_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The network as the publisher needs it; a test passes its own. */
export type NetworkSource = {
  isOnline(): boolean;
  subscribe(onChange: () => void): () => void;
};

export type LivePublisherOptions = {
  readonly documentId: string;
  /**
   * Asked before every request: once the sign-in of this tab has ended, the
   * publisher stops for good rather than send a cookie that may be another
   * person's (as the reader and comments, F-093).
   */
  readonly current?: () => boolean;
  readonly fetcher?: typeof fetch;
  readonly network?: NetworkSource;
  readonly now?: () => number;
  readonly timers?: {
    set(run: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  };
};

export type LivePublisher = {
  /** The document as it is now; only the last one offered is ever sent. */
  offer(document: CanonicalDocument): void;
  /** Lets requests go out; may be called again after `stop`. */
  start(): void;
  /** No request starts after this, and one in flight is aborted. */
  stop(): void;
  /** Why publishing has ended for this page, if it has. */
  halted(): "signedOut" | "notFound" | null;
};

const browserNetwork: NetworkSource = {
  isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
  subscribe(onChange) {
    window.addEventListener("online", onChange);
    return () => window.removeEventListener("online", onChange);
  },
};

const windowTimers = {
  set: (run: () => void, ms: number): unknown => setTimeout(run, ms),
  clear: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

async function tokenOf(response: Response): Promise<string | null | undefined> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null || !("token" in body)) return undefined;
    const { token } = body as { token: unknown };
    if (token === null) return null;
    return typeof token === "string" && UUID.test(token) ? token : undefined;
  } catch {
    return undefined;
  }
}

/** A stopped publisher; `start` lets it send. */
export function createLivePublisher(options: LivePublisherOptions): LivePublisher {
  const current = options.current ?? (() => true);
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
  const network = options.network ?? browserNetwork;
  const now = options.now ?? (() => Date.now());
  const timers = options.timers ?? windowTimers;
  const url = `/api/live/${encodeURIComponent(options.documentId)}`;

  let running = false;
  let halt: "signedOut" | "notFound" | null = null;
  let pending: string | null = null;
  let accepted: string | null = null;
  let refused: string | null = null;
  let token: string | null = null;
  let inFlight: AbortController | null = null;
  let timer: unknown = null;
  let lastStart = Number.NEGATIVE_INFINITY;
  let retryMs = 0;
  let conflicts = 0;
  let unsubscribe: (() => void) | null = null;

  const clearTimer = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };

  const schedule = (delay = 0) => {
    if (!running || halt !== null || inFlight !== null || timer !== null || pending === null) return;
    const wait = Math.max(delay, lastStart + LIVE_PUBLISH_GAP_MS - now(), 0);
    timer = timers.set(() => {
      timer = null;
      void send();
    }, wait);
  };

  async function send(): Promise<void> {
    if (!running || halt !== null || inFlight !== null || pending === null) return;
    if (!current()) {
      halt = "signedOut";
      pending = null;
      return;
    }
    // Back online, the `online` event schedules the last state again.
    if (!network.isOnline()) return;
    const text = pending;
    const controller = new AbortController();
    inFlight = controller;
    lastStart = now();
    let response: Response | null = null;
    try {
      response = await fetcher(url, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...(token === null ? { "if-none-match": "*" } : { "if-match": `"${token}"` }),
        },
        body: text,
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      response = null;
    }
    const answer = response === null ? null : { status: response.status, token: await tokenOf(response) };
    if (inFlight !== controller) return;
    inFlight = null;
    // Stopped meanwhile: nothing is read from the answer and nothing goes out.
    if (controller.signal.aborted || !running) return;
    const status = answer?.status ?? 0;
    if (status === 200 && typeof answer?.token === "string") {
      token = answer.token;
      accepted = text;
      if (pending === text) pending = null;
      retryMs = 0;
      conflicts = 0;
      settle();
      schedule();
      return;
    }
    if (status === 409 && answer?.token !== undefined) {
      // A late or second writer moved the token, so the route may hold
      // anything: take the token and send the last state once more, but only
      // once per state; a later change is tried afresh (no loop).
      token = answer.token;
      accepted = null;
      retryMs = 0;
      conflicts += 1;
      if (conflicts > 1 && pending === text) pending = null;
      schedule();
      return;
    }
    if (status === 401 || status === 404) {
      halt = status === 401 ? "signedOut" : "notFound";
      pending = null;
      return;
    }
    if (status === 413 || status === 422) {
      // The same bytes would be refused again; a later change is tried afresh.
      refused = text;
      if (pending === text) pending = null;
      settle();
      schedule();
      return;
    }
    if (status === 409) accepted = null;
    settle();
    retryMs = retryMs === 0 ? LIVE_PUBLISH_RETRY_FIRST_MS : Math.min(retryMs * 2, LIVE_PUBLISH_RETRY_MAX_MS);
    schedule(retryMs);
  }

  /**
   * With nothing in flight the route holds `accepted`, so a waiting state equal
   * to it (or to bytes already refused) need not go. While a request is in
   * flight this is not known, which is why `offer` keeps every state then and
   * the answer decides here.
   */
  function settle(): void {
    if (pending !== null && (pending === accepted || pending === refused)) pending = null;
  }

  return {
    offer(document) {
      let text: string;
      try {
        text = canonicalizeJcs(document);
      } catch {
        return;
      }
      if (text !== pending) conflicts = 0;
      pending = text;
      // A return to the accepted state while another one is in flight must
      // still go: once that answer comes, the route holds the other state.
      if (inFlight === null) settle();
      schedule();
    },
    start() {
      if (running || halt !== null) return;
      running = true;
      unsubscribe = network.subscribe(() => {
        if (network.isOnline()) schedule();
      });
      schedule();
    },
    stop() {
      running = false;
      clearTimer();
      unsubscribe?.();
      unsubscribe = null;
      const flight = inFlight;
      inFlight = null;
      flight?.abort();
    },
    halted: () => halt,
  };
}
