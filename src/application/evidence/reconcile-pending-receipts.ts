import type {
  PendingReceiptQueue,
  PendingReceiptRow,
} from "@/application/ports/pending-receipt-signing";
import { isPlainObject } from "@/domain/json";

import type { SignPendingReceiptOutcome } from "./sign-pending-receipt";

export const MAX_RECONCILE_GRACE_MS = 86_400_000;
export const MAX_RECONCILE_BATCH = 100;
export const MAX_RECONCILE_DOMAINS = 1000;

export type ReconcileDeps = {
  queue: PendingReceiptQueue;
  /** `createSignPendingReceipt`: the only way a receipt is signed here. */
  signPendingReceipt: (row: PendingReceiptRow) => Promise<SignPendingReceiptOutcome>;
  now: () => number;
  /** A domain whose oldest pending receipt is younger is left to the worker's own job. */
  graceMs: number;
  batchLimit: number;
  maxDomains: number;
};

type SweepStop = "signing" | "hash" | "verification" | "signer_rejected";

/** Counts only: no id and no receipt text, so the summary may be logged. */
export type ReconcileSummary = {
  status: "completed" | "stopped" | "unavailable";
  stoppedAt?: SweepStop;
  domains: { swept: number; fresh: number; deferred: number; malformed: number; unavailable: number };
  receipts: {
    signed: number;
    alreadySigned: number;
    refused: number;
    held: number;
    signerRejected: number;
    unavailable: number;
    malformed: number;
  };
  pendingTotal: number;
  /** Age of the oldest pending receipt in any valid backlog row; null when unknown. */
  oldestPendingAgeMs: number | null;
};

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

/** A strict ISO instant with a zone and real calendar fields, or NaN. */
function parseInstant(value: unknown): number {
  if (typeof value !== "string") return Number.NaN;
  const m = ISO_INSTANT.exec(value);
  if (!m) return Number.NaN;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCMonth() !== mo - 1 || day.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) {
    return Number.NaN;
  }
  return Date.parse(value);
}

type Domain = { id: string; count: number; oldest: number };

function parseBacklogRow(value: unknown): Domain | null {
  if (!isPlainObject(value)) return null;
  const { evidenceDomainId: id, pendingCount: count, oldestCreatedAt } = value;
  if (typeof id !== "string" || !CANONICAL_UUID.test(id)) return null;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 1) return null;
  const oldest = parseInstant(oldestCreatedAt);
  return Number.isFinite(oldest) ? { id, count, oldest } : null;
}

function isReceiptRow(value: unknown): value is PendingReceiptRow {
  return (
    isPlainObject(value) && typeof value.receiptId === "string" && CANONICAL_UUID.test(value.receiptId)
  );
}

function inRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

type Step = "continue" | "domain" | SweepStop;
const SWEEP_STAGES: ReadonlySet<unknown> = new Set(["signing", "hash", "verification"]);

/**
 * At most `limit` due domains, returned oldest first. Without a cursor the
 * window is the oldest `limit`; with one it is the next `limit` ids after the
 * cursor, wrapping around. A domain that never drains (only v1 receipts,
 * always held, always unavailable) would otherwise hold the same oldest slots
 * on every pass and starve the rest; the moving cursor reaches every due
 * domain within ceil(due / limit) passes after the first.
 */
function pickWindow(due: Domain[], limit: number, cursor: string | null): { window: Domain[]; last: string | null } {
  if (due.length <= limit) return { window: due, last: null };
  if (cursor === null) {
    const window = due.slice(0, limit);
    return { window, last: window.map((d) => d.id).sort().at(-1) ?? null };
  }
  const ids = due.map((d) => d.id).sort();
  const after = ids.findIndex((id) => id > cursor);
  const start = after < 0 ? 0 : after;
  const taken = new Set(Array.from({ length: limit }, (_, i) => ids[(start + i) % ids.length]));
  return { window: due.filter((d) => taken.has(d.id)), last: ids[(start + limit - 1) % ids.length] ?? null };
}

/**
 * Signs v2 receipts left in `pending_signature` after the worker's own job
 * was lost (DAN-593, plan #1021 P-10). Every signature goes through
 * `signPendingReceipt`, so the object check (P-13), the registry check and
 * the store's row lock apply exactly as for the worker. If the worker and
 * the reconciler sign the same receipt at once, the store keeps the first
 * signature and the second call answers `already_signed` with it; nothing
 * here writes a receipt directly. A failure of the signer or of hashing
 * stops the whole sweep; a failure of one domain stops that domain only.
 */
export function createReconcilePendingReceipts(deps: ReconcileDeps) {
  const { queue, signPendingReceipt, now, graceMs, batchLimit, maxDomains } = deps;
  if (
    typeof queue !== "object" ||
    queue === null ||
    typeof queue.backlog !== "function" ||
    typeof queue.pendingReceipts !== "function"
  ) {
    throw new TypeError("reconcilePendingReceipts: queue is required");
  }
  if (typeof signPendingReceipt !== "function" || typeof now !== "function") {
    throw new TypeError("reconcilePendingReceipts: signPendingReceipt and now are required");
  }
  if (
    !inRange(graceMs, 0, MAX_RECONCILE_GRACE_MS) ||
    !inRange(batchLimit, 1, MAX_RECONCILE_BATCH) ||
    !inRange(maxDomains, 1, MAX_RECONCILE_DOMAINS)
  ) {
    throw new RangeError("reconcilePendingReceipts: invalid limits");
  }

  async function readBacklog(): Promise<unknown[] | null> {
    try {
      const read: unknown = await queue.backlog();
      return isPlainObject(read) && read.status === "ok" && Array.isArray(read.rows) ? read.rows : null;
    } catch {
      return null;
    }
  }

  async function readReceipts(domainId: string): Promise<unknown[] | null> {
    try {
      const read: unknown = await queue.pendingReceipts(domainId, batchLimit);
      return isPlainObject(read) && read.status === "ok" && Array.isArray(read.rows) ? read.rows : null;
    } catch {
      return null;
    }
  }

  async function signOne(row: PendingReceiptRow, summary: ReconcileSummary): Promise<Step> {
    let out: unknown;
    try {
      out = await signPendingReceipt(row);
    } catch {
      out = undefined;
    }
    const status = isPlainObject(out) ? out.status : undefined;
    const r = summary.receipts;
    switch (status) {
      case "signed": r.signed += 1; return "continue";
      case "already_signed": r.alreadySigned += 1; return "continue";
      case "refused": r.refused += 1; return "continue";
      case "held": r.held += 1; return "continue";
      case "signer_rejected": r.signerRejected += 1; return "signer_rejected";
    }
    r.unavailable += 1;
    const stage = isPlainObject(out) && status === "unavailable" ? out.stage : undefined;
    // keys, object, store, an unknown stage or an unknown reply: this domain only.
    return SWEEP_STAGES.has(stage) ? (stage as SweepStop) : "domain";
  }

  // Where the next pass's window starts when more domains are due than fit.
  let cursor: string | null = null;

  return async function reconcilePendingReceipts(): Promise<ReconcileSummary> {
    const summary: ReconcileSummary = {
      status: "completed",
      domains: { swept: 0, fresh: 0, deferred: 0, malformed: 0, unavailable: 0 },
      receipts: {
        signed: 0, alreadySigned: 0, refused: 0, held: 0, signerRejected: 0, unavailable: 0, malformed: 0,
      },
      pendingTotal: 0,
      oldestPendingAgeMs: null,
    };
    const rows = await readBacklog();
    if (rows === null) return { ...summary, status: "unavailable" };

    const byId = new Map<string, Domain>();
    for (const value of rows) {
      const domain = parseBacklogRow(value);
      if (!domain) {
        summary.domains.malformed += 1;
        continue;
      }
      const seen = byId.get(domain.id);
      byId.set(domain.id, seen
        ? { id: domain.id, count: Math.max(seen.count, domain.count), oldest: Math.min(seen.oldest, domain.oldest) }
        : domain);
    }

    let clock: unknown;
    try {
      clock = now();
    } catch {
      clock = Number.NaN;
    }
    const at = typeof clock === "number" && Number.isFinite(clock) ? clock : null;
    const domains = [...byId.values()].sort((a, b) => a.oldest - b.oldest || (a.id < b.id ? -1 : 1));
    const due: Domain[] = [];
    for (const domain of domains) {
      summary.pendingTotal = Math.min(summary.pendingTotal + domain.count, Number.MAX_SAFE_INTEGER);
      const age = at === null ? null : at - domain.oldest;
      if (age !== null) {
        summary.oldestPendingAgeMs = Math.max(summary.oldestPendingAgeMs ?? 0, age);
        // A time in the future is swept, so a skewed clock never hides a receipt for good.
        if (age >= 0 && age < graceMs) {
          summary.domains.fresh += 1;
          continue;
        }
      }
      due.push(domain);
    }
    summary.domains.deferred = Math.max(due.length - maxDomains, 0);
    const { window, last } = pickWindow(due, maxDomains, cursor);

    for (const domain of window) {
      const read = await readReceipts(domain.id);
      if (read === null) {
        summary.domains.unavailable += 1;
        continue;
      }
      const seen = new Set<string>();
      let step: Step = "continue";
      for (const value of read.slice(0, batchLimit)) {
        if (!isReceiptRow(value)) {
          summary.receipts.malformed += 1;
          continue;
        }
        if (seen.has(value.receiptId)) continue;
        seen.add(value.receiptId);
        step = await signOne(value, summary);
        if (step !== "continue") break;
      }
      if (step === "continue") {
        summary.domains.swept += 1;
        continue;
      }
      summary.domains.unavailable += 1;
      // A stopped sweep keeps the cursor, so the next pass retries this window.
      if (step !== "domain") return { ...summary, status: "stopped", stoppedAt: step };
    }
    cursor = last;
    return summary;
  };
}
