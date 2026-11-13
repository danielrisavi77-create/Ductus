// Public status (DAN-429, F-10): the readiness report of DAN-585 told as the
// three parts of the service a person uses, with closed words only. Nothing
// here reads or returns anything about a person.

import type { ComponentName, ComponentState, PublicStatus } from "@/lib/status/public-status";

import type { CapabilityName, CapabilityReport } from "./ready";

/** How long one check answers every caller. */
export const PUBLIC_STATUS_TTL_MS = 15_000;

// What each part needs. With synchronous signing the queue runs only
// background work no part shown here waits on. With asynchronous signing
// (DAN-518, protocol 2) the worker signs every receipt, so writing and
// submission also need it: without it nothing reaches a signed receipt.
const SYNC_NEEDS: Readonly<Record<ComponentName, readonly CapabilityName[]>> = Object.freeze({
  writing: ["database", "storage", "signing"],
  submission: ["database", "storage", "signing"],
  mentorView: ["database"],
});
const ASYNC_NEEDS: Readonly<Record<ComponentName, readonly CapabilityName[]>> = Object.freeze({
  writing: ["database", "storage", "signing", "queue"],
  submission: ["database", "storage", "signing", "queue"],
  mentorView: ["database"],
});

function partState(report: CapabilityReport, needs: readonly CapabilityName[]): ComponentState {
  const states = needs.map((name) => report.capabilities[name]);
  // Not reported means not checked: never "radi".
  if (states.some((s) => s !== "ok" && s !== "nije_konfigurirano")) return "ne_radi";
  if (states.some((s) => s === "nije_konfigurirano")) return "nije_ukljuceno";
  return "radi";
}

/** Each part is as good as the worst capability it needs. */
export function publicComponents(report: CapabilityReport, asyncSigning = false): PublicStatus["components"] {
  const needs = asyncSigning ? ASYNC_NEEDS : SYNC_NEEDS;
  return {
    writing: partState(report, needs.writing),
    submission: partState(report, needs.submission),
    mentorView: partState(report, needs.mentorView),
  };
}

/**
 * One check answers every caller for PUBLIC_STATUS_TTL_MS, and callers that
 * arrive while it runs wait on the same one, so public traffic never adds
 * probes or database connections per request. A failed check is not kept.
 */
export function publicStatusCache(
  check: () => Promise<CapabilityReport>,
  now: () => number = Date.now,
  asyncSigning = false,
): () => Promise<PublicStatus> {
  let kept: { at: number; body: PublicStatus } | undefined;
  let pending: Promise<PublicStatus> | undefined;
  return () => {
    if (kept && now() - kept.at < PUBLIC_STATUS_TTL_MS && now() >= kept.at) return Promise.resolve(kept.body);
    pending ??= Promise.resolve()
      .then(() => {
        const at = now();
        return check().then((report) => {
          const body: PublicStatus = { checkedAt: new Date(at).toISOString(), components: publicComponents(report, asyncSigning) };
          kept = { at, body };
          return body;
        });
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}

const HEADERS = { "Cache-Control": "no-store" };

/**
 * The /api/status answer: 200 with the closed body, or 503 without a body
 * while the process shuts down or when the check fails, so the page keeps its
 * last answer and marks it stale. Never a message, code or host.
 */
export async function publicStatusResponse(get: () => Promise<PublicStatus>, running: boolean): Promise<Response> {
  if (!running) return new Response(null, { status: 503, headers: HEADERS });
  try {
    return Response.json(await get(), { status: 200, headers: HEADERS });
  } catch {
    return new Response(null, { status: 503, headers: HEADERS });
  }
}
