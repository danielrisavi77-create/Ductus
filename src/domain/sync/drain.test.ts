// @vitest-environment node
import { describe, expect, it } from "vitest";

import { emptyDocument, type DocumentTransaction } from "@/domain/document";
import { COMMIT_STATUSES, type CommitOutcome } from "@/domain/serverSync/contract";

import {
  BACKOFF_JITTER,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
  ackedRevision,
  backoffBaseMs,
  fastForwardBase,
  isRetryable,
  nextAttemptDelayMs,
  outcomeToEvents,
  planDrain,
  serverSyncErrorToOutcome,
  type AnswerFlight,
  type CommitReceiptVerification,
  type DrainOutcome,
  type SignedCommitReceiptVerifier,
} from "./drain";
import type { PendingTransaction, SyncMeta } from "./journal-types";
import { syncReducer, type SyncState } from "./states";

const DOC = "11111111-1111-4111-8111-111111111111";

function uuidSeq(): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
}

function tx(localSeq: number, baseRevision = 0): DocumentTransaction {
  return {
    kind: "REPLACE_DOCUMENT",
    clientTransactionId: `tx-${localSeq}`,
    baseRevision,
    document: emptyDocument(uuidSeq()),
    createdAt: "2026-09-19T10:00:00.000Z",
  };
}

function row(localSeq: number, baseRevision = 0): PendingTransaction {
  return {
    documentId: DOC,
    localSeq,
    tx: tx(localSeq, baseRevision),
    queuedAt: "2026-09-19T10:00:00.000Z",
  };
}

function meta(state: SyncState, localSeq = 0): SyncMeta {
  return { documentId: DOC, state, localSeq };
}

function signedCommitOutcome(
  status: "committed" | "duplicate",
  revision = 3,
): DrainOutcome {
  return {
    status,
    revision,
    receipt: { status: "signed", signedReceipt: { testReceipt: true } },
  };
}

function receiptVerification(
  revision: number,
  verify: SignedCommitReceiptVerifier = async () => true,
): CommitReceiptVerification {
  return {
    expected: { documentId: DOC, clientTransactionId: "tx-1", revision },
    verify,
  };
}

/** The answer's flight: row 1 (tx-1) was sent and is still the only queued row. */
const SENT = row(1);
const ALONE: AnswerFlight = { sent: SENT, pending: [SENT] };

describe("planDrain — what the next attempt sends", () => {
  it("sends nothing when the queue is empty", () => {
    expect(planDrain([], meta("SYNCED"))).toEqual({ send: null, supersededUpTo: null });
  });

  it("sends nothing when meta is missing and the queue is empty", () => {
    expect(planDrain([], null)).toEqual({ send: null, supersededUpTo: null });
  });

  it("sends the only queued row and supersedes nothing", () => {
    const plan = planDrain([row(1)], meta("LOCAL_DURABLE"));
    expect(plan.send?.localSeq).toBe(1);
    expect(plan.supersededUpTo).toBeNull();
  });

  it("sends only the NEWEST row — older replacements are superseded", () => {
    const plan = planDrain([row(1), row(2), row(3)], meta("LOCAL_DURABLE"));
    expect(plan.send?.localSeq).toBe(3);
    expect(plan.supersededUpTo).toBe(2);
  });

  it("does not assume the queue is sorted", () => {
    const plan = planDrain([row(7), row(2), row(5)], meta("LOCAL_DURABLE"));
    expect(plan.send?.localSeq).toBe(7);
    expect(plan.supersededUpTo).toBe(5);
  });

  it("works without meta at all (a journal written before meta existed)", () => {
    const plan = planDrain([row(1), row(2)], null);
    expect(plan.send?.localSeq).toBe(2);
  });

  it("refuses to drain while the document is in CONFLICT", () => {
    // Pushing here would resolve a conflict by force: silent last-write-wins.
    expect(planDrain([row(1), row(2)], meta("CONFLICT"))).toEqual({
      send: null,
      supersededUpTo: null,
    });
  });

  it("refuses to drain while the document is in RECOVERY_REQUIRED", () => {
    expect(planDrain([row(3)], meta("RECOVERY_REQUIRED"))).toEqual({
      send: null,
      supersededUpTo: null,
    });
  });

  it("drains from ERROR — an error is retryable, not sticky", () => {
    expect(planDrain([row(4)], meta("ERROR")).send?.localSeq).toBe(4);
  });

  it("ignores a stored state that is not one of the eight", () => {
    const rogue = { documentId: DOC, state: "toString", localSeq: 1 } as unknown as SyncMeta;
    expect(planDrain([row(1)], rogue).send?.localSeq).toBe(1);
  });

  it("skips rows of a transaction kind this build cannot send", () => {
    const foreign: PendingTransaction = {
      ...row(9),
      tx: { ...tx(9), kind: "FUTURE_KIND" } as unknown as DocumentTransaction,
    };
    const plan = planDrain([row(1), foreign], meta("LOCAL_DURABLE"));
    expect(plan.send?.localSeq).toBe(1);
    // The unknown newer row is not claimed as superseded by the older one.
    expect(plan.supersededUpTo).toBeNull();
  });

  it("sends nothing when every row is unsendable", () => {
    const foreign: PendingTransaction = {
      ...row(1),
      tx: { ...tx(1), kind: "FUTURE_KIND" } as unknown as DocumentTransaction,
    };
    expect(planDrain([foreign], meta("LOCAL_DURABLE")).send).toBeNull();
  });

  it("skips a row whose idempotency key is missing", () => {
    const broken: PendingTransaction = {
      ...row(2),
      tx: { ...tx(2), clientTransactionId: "" },
    };
    expect(planDrain([row(1), broken], meta("LOCAL_DURABLE")).send?.localSeq).toBe(1);
  });

  it("skips a row whose local sequence is not a whole positive number", () => {
    const broken = { ...row(2), localSeq: 1.5 } as PendingTransaction;
    expect(planDrain([row(1), broken], meta("LOCAL_DURABLE")).send?.localSeq).toBe(1);
  });

  it("returns the row itself, so the caller can clear exactly what it sent", () => {
    const rows = [row(1), row(2)];
    expect(planDrain(rows, meta("LOCAL_DURABLE")).send).toBe(rows[1]);
  });
});

describe("nextAttemptDelayMs — backoff", () => {
  const exact = () => 0.5;

  it("waits one second before the first retry", () => {
    expect(backoffBaseMs(1)).toBe(BASE_BACKOFF_MS);
  });

  it("doubles: 1s, 2s, 4s, 8s, 16s", () => {
    expect([1, 2, 3, 4, 5].map(backoffBaseMs)).toEqual([1000, 2000, 4000, 8000, 16000]);
  });

  it("caps at 30 seconds and stays there", () => {
    expect(backoffBaseMs(6)).toBe(MAX_BACKOFF_MS);
    expect(backoffBaseMs(7)).toBe(MAX_BACKOFF_MS);
    expect(backoffBaseMs(50)).toBe(MAX_BACKOFF_MS);
    expect(backoffBaseMs(Number.MAX_SAFE_INTEGER)).toBe(MAX_BACKOFF_MS);
  });

  it("treats a nonsensical attempt number as the first attempt", () => {
    expect(backoffBaseMs(0)).toBe(BASE_BACKOFF_MS);
    expect(backoffBaseMs(-4)).toBe(BASE_BACKOFF_MS);
    expect(backoffBaseMs(Number.NaN)).toBe(BASE_BACKOFF_MS);
    expect(backoffBaseMs(Number.POSITIVE_INFINITY)).toBe(BASE_BACKOFF_MS);
  });

  it("a jitter of 0.5 is no jitter at all", () => {
    expect([1, 2, 3, 4].map((n) => nextAttemptDelayMs(n, exact))).toEqual([
      1000, 2000, 4000, 8000,
    ]);
  });

  it("jitter pulls the delay down by at most 20%", () => {
    expect(nextAttemptDelayMs(3, () => 0)).toBe(4000 * (1 - BACKOFF_JITTER));
  });

  it("jitter pushes the delay up by at most 20%", () => {
    expect(nextAttemptDelayMs(3, () => 1)).toBe(4000 * (1 + BACKOFF_JITTER));
  });

  it("every delay stays inside ±20% of its base, for every attempt", () => {
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const base = backoffBaseMs(attempt);
      for (const unit of [0, 0.01, 0.25, 0.5, 0.75, 0.99, 1]) {
        const delay = nextAttemptDelayMs(attempt, () => unit);
        expect(delay).toBeGreaterThanOrEqual(Math.round(base * 0.8));
        expect(delay).toBeLessThanOrEqual(Math.round(base * 1.2));
      }
    }
  });

  it("clamps a jitter source that leaves [0, 1) instead of trusting it", () => {
    // An unclamped -5 would produce a negative delay: a hot retry loop.
    expect(nextAttemptDelayMs(1, () => -5)).toBe(800);
    expect(nextAttemptDelayMs(1, () => 9)).toBe(1200);
    expect(nextAttemptDelayMs(1, () => Number.NaN)).toBe(1000);
  });

  it("survives a jitter source that throws", () => {
    expect(
      nextAttemptDelayMs(2, () => {
        throw new Error("no entropy");
      }),
    ).toBe(2000);
  });

  it("defaults to Math.random and still produces a sane delay", () => {
    const delay = nextAttemptDelayMs(2);
    expect(delay).toBeGreaterThanOrEqual(1600);
    expect(delay).toBeLessThanOrEqual(2400);
  });
});

describe("outcomeToEvents — what the server's answer means", () => {
  it("committed is an ACK only after verifying the signed receipt", async () => {
    const verifier = receiptVerification(3, async (receipt, expected) => {
      expect(receipt).toEqual({ testReceipt: true });
      expect(expected).toEqual({
        documentId: DOC,
        clientTransactionId: "tx-1",
        revision: 3,
      });
      return true;
    });
    expect(await outcomeToEvents(signedCommitOutcome("committed"), verifier, ALONE)).toEqual([
      { type: "SYNC_ACK" },
    ]);
  });

  it("duplicate is an ACK only after verifying the same commit receipt", async () => {
    expect(
      await outcomeToEvents(signedCommitOutcome("duplicate"), receiptVerification(3), ALONE),
    ).toEqual([{ type: "SYNC_ACK" }]);
  });

  it("pending_signature remains retryable and never verifies or ACKs", async () => {
    let verifierCalled = false;
    const outcome: DrainOutcome = {
      status: "committed",
      revision: 3,
      receipt: { status: "pending_signature" },
    };
    expect(
      await outcomeToEvents(
        outcome,
        receiptVerification(3, async () => {
          verifierCalled = true;
          return true;
        }),
        ALONE,
      ),
    ).toEqual([]);
    expect(verifierCalled).toBe(false);
    expect(isRetryable(outcome)).toBe(true);
  });

  it("a missing receipt cannot ACK even when the CAS says committed", async () => {
    const outcome = { status: "committed", revision: 3 } as unknown as DrainOutcome;
    expect(await outcomeToEvents(outcome, receiptVerification(3), ALONE)).toEqual([
      { type: "SYNC_FAILED", retryable: false },
    ]);
  });

  it("a bad signature cannot ACK", async () => {
    expect(
      await outcomeToEvents(
        signedCommitOutcome("committed"),
        receiptVerification(3, async () => false),
        ALONE,
      ),
    ).toEqual([{ type: "SYNC_FAILED", retryable: false }]);
  });

  it("a verifier exception cannot ACK", async () => {
    expect(
      await outcomeToEvents(
        signedCommitOutcome("committed"),
        receiptVerification(3, async () => {
          throw new Error("key service unavailable");
        }),
        ALONE,
      ),
    ).toEqual([{ type: "SYNC_FAILED", retryable: false }]);
  });

  it("a verifier cannot check a different revision", async () => {
    expect(
      await outcomeToEvents(signedCommitOutcome("committed", 4), receiptVerification(3), ALONE),
    ).toEqual([{ type: "SYNC_FAILED", retryable: false }]);
  });

  it("stale_base is a conflict, never a retry", async () => {
    expect(
      await outcomeToEvents({ status: "stale_base", currentRevision: 9 }, receiptVerification(9), ALONE),
    ).toEqual([{ type: "SYNC_STALE_BASE" }]);
    expect(isRetryable({ status: "stale_base", currentRevision: 9 })).toBe(false);
  });

  it("too_large fails for good", async () => {
    expect(await outcomeToEvents({ status: "too_large" }, receiptVerification(1), ALONE)).toEqual([
      { type: "SYNC_FAILED", retryable: false },
    ]);
  });

  it("txid_reused is never retried: it asks the author to recover (DAN-135)", async () => {
    const events = await outcomeToEvents({ status: "txid_reused" }, receiptVerification(1), ALONE);
    expect(events).toEqual([{ type: "SYNC_KEY_DIVERGED" }]);
    expect(isRetryable({ status: "txid_reused" })).toBe(false);
    expect(events.some((e) => e.type === "SYNC_STALE_BASE" || e.type === "SYNC_ACK")).toBe(false);
  });

  it.each([
    "not_found",
    "unauthenticated",
    "invalid_document",
    "invalid_client_transaction_id",
    "invalid",
  ] as const)("%s fails for good", async (status) => {
    expect(await outcomeToEvents({ status } as DrainOutcome, receiptVerification(1), ALONE)).toEqual([
      { type: "SYNC_FAILED", retryable: false },
    ]);
  });

  it("a transport error is retryable", async () => {
    expect(
      await outcomeToEvents({ status: "transport_error" }, receiptVerification(1), ALONE),
    ).toEqual([{ type: "SYNC_FAILED", retryable: true }]);
    expect(isRetryable({ status: "transport_error" })).toBe(true);
  });

  it("covers every status the commit contract declares", async () => {
    for (const status of COMMIT_STATUSES) {
      const outcome = (
        status === "committed" || status === "duplicate"
          ? {
              status,
              revision: 1,
              receipt: { status: "signed", signedReceipt: { testReceipt: true } },
            }
          : status === "stale_base"
            ? { status, currentRevision: 1 }
            : { status }
      ) as CommitOutcome | DrainOutcome;
      expect(await outcomeToEvents(outcome as DrainOutcome, receiptVerification(1), ALONE)).toHaveLength(1);
    }
  });

  it("an unrecognised answer is fatal, not retryable — a loop is worse", async () => {
    expect(
      await outcomeToEvents(
        { status: "who knows" } as unknown as DrainOutcome,
        receiptVerification(1),
        ALONE,
      ),
    ).toEqual([{ type: "SYNC_FAILED", retryable: false }]);
    expect(isRetryable(undefined as unknown as DrainOutcome)).toBe(false);
  });

  it("every emitted event is one the reducer already understands", async () => {
    const outcomes: DrainOutcome[] = [
      signedCommitOutcome("committed", 1),
      signedCommitOutcome("duplicate", 1),
      { status: "stale_base", currentRevision: 1 },
      { status: "too_large" },
      { status: "transport_error" },
    ];
    for (const outcome of outcomes) {
      for (const event of await outcomeToEvents(outcome, receiptVerification(1), ALONE)) {
        expect(syncReducer("SYNCING", event)).not.toBe("SYNCING");
      }
    }
  });

  it("SYNCED requires a verified receipt; a pending signature leaves the sync unresolved", async () => {
    const signedEvents = await outcomeToEvents(
      signedCommitOutcome("committed", 2),
      receiptVerification(2),
      ALONE,
    );
    const pendingEvents = await outcomeToEvents(
      { status: "committed", revision: 2, receipt: { status: "pending_signature" } },
      receiptVerification(2),
      ALONE,
    );
    expect(syncReducer("SYNCING", signedEvents[0])).toBe("SYNCED");
    expect(pendingEvents).toEqual([]);
    let pendingState: SyncState = "SYNCING";
    for (const event of pendingEvents) {
      pendingState = syncReducer(pendingState, event);
    }
    expect(pendingState).toBe("SYNCING");
    expect(
      syncReducer(
        "SYNCING",
        (await outcomeToEvents(
          { status: "stale_base", currentRevision: 2 },
          receiptVerification(2),
          ALONE,
        ))[0],
      ),
    ).toBe("CONFLICT");
  });
});

describe("ackedRevision", () => {
  it("returns a commit revision only after outcomeToEvents verified its receipt", async () => {
    const outcome = signedCommitOutcome("committed", 12);
    expect(ackedRevision(outcome)).toBeNull();
    await outcomeToEvents(outcome, receiptVerification(12), ALONE);
    expect(ackedRevision(outcome)).toBe(12);
  });

  it("returns a replay revision only after outcomeToEvents verified its receipt", async () => {
    const outcome = signedCommitOutcome("duplicate", 12);
    await outcomeToEvents(outcome, receiptVerification(12), ALONE);
    expect(ackedRevision(outcome)).toBe(12);
  });

  it("keeps a pending signature from advancing the local base", () => {
    expect(
      ackedRevision({
        status: "committed",
        revision: 12,
        receipt: { status: "pending_signature" },
      }),
    ).toBeNull();
  });

  it("is null for anything that is not a verified ACK", () => {
    expect(ackedRevision({ status: "stale_base", currentRevision: 12 })).toBeNull();
    expect(ackedRevision({ status: "transport_error" })).toBeNull();
    expect(ackedRevision({ status: "too_large" })).toBeNull();
  });
});

describe("fastForwardBase — only ever onto our own ACK", () => {
  it("leaves the transaction alone when nothing has been acknowledged", () => {
    const original = tx(1, 0);
    expect(fastForwardBase(original, null)).toBe(original);
  });

  it("moves a stale base onto the revision our own commit produced", () => {
    const moved = fastForwardBase(tx(2, 0), 4);
    expect(moved.baseRevision).toBe(4);
  });

  it("keeps the idempotency key, so a replay is still recognised", () => {
    const original = tx(2, 0);
    expect(fastForwardBase(original, 4).clientTransactionId).toBe(
      original.clientTransactionId,
    );
  });

  it("never moves a base backwards", () => {
    const original = tx(2, 7);
    expect(fastForwardBase(original, 4)).toBe(original);
  });

  it("refuses a revision that is not a whole, safe number", () => {
    const original = tx(2, 0);
    expect(fastForwardBase(original, 1.5)).toBe(original);
  });
});

describe("serverSyncErrorToOutcome", () => {
  it("maps the round-trip failures and an unreadable answer to a retryable transport error", () => {
    expect(serverSyncErrorToOutcome("slanje")).toEqual({ status: "transport_error" });
    expect(serverSyncErrorToOutcome("citanje")).toEqual({ status: "transport_error" });
    expect(serverSyncErrorToOutcome("odgovor-neispravan")).toEqual({
      status: "transport_error",
    });
  });

  it("maps the payload and row failures to their non-retryable outcomes", () => {
    expect(serverSyncErrorToOutcome("prevelik")).toEqual({ status: "too_large" });
    expect(serverSyncErrorToOutcome("rad-nepoznat")).toEqual({ status: "not_found" });
    expect(serverSyncErrorToOutcome("zapis-neispravan")).toEqual({
      status: "invalid_document",
    });
  });

  it("only 'slanje', 'citanje' and 'odgovor-neispravan' are ever retried", () => {
    const codes = [
      "slanje",
      "citanje",
      "prevelik",
      "rad-nepoznat",
      "zapis-neispravan",
      "odgovor-neispravan",
    ] as const;
    const retryable = codes.filter((code) => isRetryable(serverSyncErrorToOutcome(code)));
    expect(retryable).toEqual(["slanje", "citanje", "odgovor-neispravan"]);
  });
});
