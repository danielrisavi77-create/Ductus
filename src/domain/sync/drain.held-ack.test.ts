// @vitest-environment node
/**
 * Regressions for the QA findings on PR #97 (head b525c7f8, STATE.md F-3/F-8):
 *
 *   1. A verified receipt for a row that is NOT the newest queued row must not
 *      emit SYNC_ACK: the receipt vouches for older content than the author is
 *      looking at, and SYNCED has no legal way back to SYNCING.
 *   2. A verified outcome is bound to the transaction it was verified for, so
 *      it cannot release another row's hold.
 *   3. Rows and the hold marker are bound to one document.
 */
import { describe, expect, it } from "vitest";

import { emptyDocument, type DocumentTransaction } from "@/domain/document";

import {
  ackedRevision,
  fastForwardBase,
  newerRowsQueued,
  nextAwaitingReceipt,
  outcomeToEvents,
  planDrain,
  type AwaitingReceipt,
  type CommitReceiptVerification,
  type DrainOutcome,
} from "./drain";
import type { PendingTransaction, SyncMeta } from "./journal-types";
import { syncReducer, type SyncEvent, type SyncState } from "./states";

const DOC = "11111111-1111-4111-8111-111111111111";
const OTHER_DOC = "22222222-2222-4222-8222-222222222222";

function tx(localSeq: number, baseRevision: number): DocumentTransaction {
  let n = 0;
  return {
    kind: "REPLACE_DOCUMENT",
    clientTransactionId: `tx-${localSeq}`,
    baseRevision,
    document: emptyDocument(() => {
      n += 1;
      return `aaaaaaaa-0000-4000-8000-${String(localSeq * 100 + n).padStart(12, "0")}`;
    }),
    createdAt: "2026-09-19T10:00:00.000Z",
  };
}

function row(localSeq: number, baseRevision: number, documentId = DOC): PendingTransaction {
  return {
    documentId,
    localSeq,
    tx: tx(localSeq, baseRevision),
    queuedAt: "2026-09-19T10:00:00.000Z",
  };
}

function meta(state: SyncState, documentId = DOC): SyncMeta {
  return { documentId, state, localSeq: 0 };
}

function verification(
  clientTransactionId: string,
  revision: number,
  documentId = DOC,
): CommitReceiptVerification {
  return {
    expected: { documentId, clientTransactionId, revision },
    verify: async () => true,
  };
}

function signed(status: "committed" | "duplicate", revision: number): DrainOutcome {
  return { status, revision, receipt: { status: "signed", signedReceipt: { testReceipt: true } } };
}

function pendingSignature(status: "committed" | "duplicate", revision: number): DrainOutcome {
  return { status, revision, receipt: { status: "pending_signature" } };
}

function reduce(state: SyncState, events: readonly SyncEvent[]): SyncState {
  return events.reduce(syncReducer, state);
}

describe("verified receipt for a held older row (QA finding 1)", () => {
  it("never reaches SYNCED while a newer row is still queued, and the newer row then goes out", async () => {
    // Server on revision 1. EDIT "a" → seq 1 (base 1) → committed rev 2,
    // signature pending.
    const first = row(1, 1);
    const plan1 = planDrain([first], meta("SYNCING"));
    expect(newerRowsQueued([first], plan1.send)).toBe(false);
    const landed = pendingSignature("committed", 2);
    let state = reduce("SYNCING", await outcomeToEvents(landed, verification("tx-1", 2), newerRowsQueued([first], plan1.send)));
    expect(state).toBe("SYNCING");
    let awaiting = nextAwaitingReceipt(first, landed, null);

    // EDIT "b" → seq 2 (base 1); the editor walks back round to SYNCING.
    const second = row(2, 1);
    state = reduce(state, [
      { type: "EDIT" },
      { type: "LOCAL_SAVE_STARTED" },
      { type: "LOCAL_SAVE_OK" },
      { type: "SYNC_STARTED" },
    ]);
    expect(state).toBe("SYNCING");

    // The signer publishes; the replay of tx-1 comes back signed.
    const plan2 = planDrain([first, second], meta("SYNCING"), awaiting);
    expect(plan2.send).toBe(first);
    expect(newerRowsQueued([first, second], plan2.send)).toBe(true);
    const replay = signed("duplicate", 2);
    const events = await outcomeToEvents(replay, verification("tx-1", 2), newerRowsQueued([first, second], plan2.send));

    // The receipt is for "a"; the author is looking at "b". Not SYNCED.
    expect(events).toEqual([]);
    state = reduce(state, events);
    expect(state).toBe("SYNCING");

    // The revision is still verified: the hold is released and the base moves.
    const acked = ackedRevision(replay);
    expect(acked).toBe(2);
    awaiting = nextAwaitingReceipt(plan2.send!, replay, awaiting);
    expect(awaiting).toBeNull();

    // The runner clears seq ≤ 1; seq 2 goes next, on base 2.
    const plan3 = planDrain([second], meta("SYNCING"), awaiting);
    expect(plan3.send).toBe(second);
    expect(newerRowsQueued([second], plan3.send)).toBe(false);
    expect(fastForwardBase(plan3.send!.tx, acked).baseRevision).toBe(2);

    // Its own commit with a pending signature is still not SYNCED …
    const landed2 = pendingSignature("committed", 3);
    state = reduce(state, await outcomeToEvents(landed2, verification("tx-2", 3), newerRowsQueued([second], plan3.send)));
    expect(state).toBe("SYNCING");
    awaiting = nextAwaitingReceipt(second, landed2, awaiting);

    // … and SYNCED arrives only with the signed receipt for the newest row.
    const plan4 = planDrain([second], meta("SYNCING"), awaiting);
    const replay2 = signed("duplicate", 3);
    state = reduce(state, await outcomeToEvents(replay2, verification("tx-2", 3), newerRowsQueued([second], plan4.send)));
    expect(state).toBe("SYNCED");
    expect(nextAwaitingReceipt(second, replay2, awaiting)).toBeNull();
  });

  it("reports newer rows that are queued behind an unsafe boundary", () => {
    const damaged = { ...row(3, 1), tx: { ...tx(3, 1), kind: "FUTURE_KIND" } } as unknown as PendingTransaction;
    const queue = [row(1, 1), row(2, 1), damaged];
    const plan = planDrain(queue, null);
    expect(plan.send?.localSeq).toBe(2);
    // Row 3 cannot be sent by this build, but it is newer text all the same.
    expect(newerRowsQueued(queue, plan.send)).toBe(true);
  });

  it("reports nothing newer when the newest row is the one sent", () => {
    const queue = [row(1, 1), row(2, 1)];
    expect(newerRowsQueued(queue, planDrain(queue, null).send)).toBe(false);
    expect(newerRowsQueued([], null)).toBe(false);
  });

  it("is conservative about rows it cannot order", () => {
    const sent = row(2, 1);
    const unordered = { ...row(1, 1), localSeq: Number.NaN };
    expect(newerRowsQueued([sent, unordered], sent)).toBe(true);
    // A second row claiming the same sequence is not provably older.
    expect(newerRowsQueued([sent, row(2, 1)], sent)).toBe(true);
    expect(newerRowsQueued(null as never, sent)).toBe(true);
  });

  it("withholds the ACK for anything but an explicit false", async () => {
    for (const flag of [true, 1, "false", null, undefined, {}] as unknown as boolean[]) {
      const outcome = signed("committed", 2);
      expect(await outcomeToEvents(outcome, verification("tx-1", 2), flag)).toEqual([]);
      expect(ackedRevision(outcome)).toBe(2);
    }
  });

  it("withholds the ACK when the caller leaves the argument out (review finding 1)", async () => {
    // The parameter is required: a caller that forgets it does not compile.
    const omitted = signed("committed", 2);
    // @ts-expect-error newerRowsQueued has no default and must be passed
    expect(await outcomeToEvents(omitted, verification("tx-1", 2))).toEqual([]);
    expect(ackedRevision(omitted)).toBe(2);

    // And a caller that slips past the compiler still gets no ACK.
    const missing = signed("duplicate", 2);
    expect(
      await outcomeToEvents(missing, verification("tx-1", 2), undefined as unknown as boolean),
    ).toEqual([]);
    expect(ackedRevision(missing)).toBe(2);

    // Control: the explicit false is what emits it.
    expect(await outcomeToEvents(signed("committed", 2), verification("tx-1", 2), false)).toEqual([
      { type: "SYNC_ACK" },
    ]);
  });

  it("recognises the sent row by identity, not by object reference (review finding 2)", async () => {
    // The runner re-reads the queue after the answer (IndexedDB hands back
    // new objects) or passes a row moved through fastForwardBase.
    const first = row(1, 1);
    const plan = planDrain([first], meta("SYNCING"));
    expect(plan.send).toBe(first);

    const reread = structuredClone([first]);
    expect(reread[0]).not.toBe(first);
    expect(newerRowsQueued(reread, plan.send)).toBe(false);
    expect(newerRowsQueued([first], structuredClone(first))).toBe(false);
    const forwarded = { ...first, tx: fastForwardBase(first.tx, 4) };
    expect(newerRowsQueued([first], forwarded)).toBe(false);
    expect(newerRowsQueued([forwarded], first)).toBe(false);

    // With nothing newer queued the receipt of the re-read row is SYNCED.
    const state = reduce(
      "SYNCING",
      await outcomeToEvents(signed("committed", 2), verification("tx-1", 2), newerRowsQueued(reread, plan.send)),
    );
    expect(state).toBe("SYNCED");

    // A copy does not hide a newer row behind it.
    expect(newerRowsQueued([...reread, row(2, 1)], plan.send)).toBe(true);
  });

  it("matches the sent row on document, sequence and transaction id together", () => {
    const sent = row(2, 1);
    // Same sequence, different transaction: not provably older.
    const otherTx = { ...row(2, 1), tx: { ...tx(2, 1), clientTransactionId: "tx-other" } };
    expect(newerRowsQueued([otherTx], sent)).toBe(true);
    // Same sequence and transaction, different document.
    expect(newerRowsQueued([row(2, 1, OTHER_DOC)], sent)).toBe(true);
    // Same transaction id under a later sequence.
    const laterSeq = { ...row(3, 1), tx: { ...tx(3, 1), clientTransactionId: "tx-2" } };
    expect(newerRowsQueued([laterSeq], sent)).toBe(true);
    // Only one queued row can be the sent one; a second match is a duplicate.
    expect(newerRowsQueued([structuredClone(sent), structuredClone(sent)], sent)).toBe(true);
    // A sent row without a usable identity matches nothing.
    const bare = { ...row(2, 1), tx: { ...tx(2, 1), clientTransactionId: "" } };
    expect(newerRowsQueued([bare], bare)).toBe(true);
    const nameless = { ...row(2, 1), documentId: "" };
    expect(newerRowsQueued([structuredClone(nameless)], nameless)).toBe(true);
  });

  it("still fails closed on a bad receipt when newer rows are queued", async () => {
    const outcome = signed("committed", 2);
    const events = await outcomeToEvents(
      outcome,
      { ...verification("tx-1", 2), verify: async () => false },
      true,
    );
    expect(events).toEqual([{ type: "SYNC_FAILED", retryable: false }]);
    expect(ackedRevision(outcome)).toBeNull();
  });
});

describe("a verified outcome is bound to its transaction (QA finding 2)", () => {
  it("does not release another row's hold", async () => {
    const outcomeOfFirst = signed("duplicate", 2);
    await outcomeToEvents(outcomeOfFirst, verification("tx-1", 2), false);
    expect(ackedRevision(outcomeOfFirst)).toBe(2);

    const second = row(2, 2);
    const holdOnSecond: AwaitingReceipt = { documentId: DOC, localSeq: 2, clientTransactionId: "tx-2" };
    expect(nextAwaitingReceipt(second, outcomeOfFirst, holdOnSecond)).toEqual(holdOnSecond);
    expect(nextAwaitingReceipt(second, outcomeOfFirst, null)).toEqual(holdOnSecond);
  });

  it("does not release a hold on the same key in another document", async () => {
    const outcome = signed("duplicate", 2);
    await outcomeToEvents(outcome, verification("tx-1", 2, OTHER_DOC), false);
    const first = row(1, 1);
    expect(nextAwaitingReceipt(first, outcome, null)).toEqual({
      documentId: DOC,
      localSeq: 1,
      clientTransactionId: "tx-1",
    });
  });

  it("releases the hold for the row it was verified for", async () => {
    const outcome = signed("duplicate", 2);
    await outcomeToEvents(outcome, verification("tx-1", 2), false);
    expect(nextAwaitingReceipt(row(1, 1), outcome, null)).toBeNull();
  });
});

describe("one document per queue (QA finding 3)", () => {
  const NOTHING = { send: null, supersededUpTo: null };

  it("sends nothing when rows of two documents share the queue", () => {
    const mixed = [row(1, 1, OTHER_DOC), row(2, 1, OTHER_DOC), row(3, 1), row(4, 1)];
    expect(planDrain(mixed, null)).toEqual(NOTHING);
  });

  it("sends nothing when meta belongs to another document", () => {
    expect(planDrain([row(1, 1)], meta("LOCAL_DURABLE", OTHER_DOC))).toEqual(NOTHING);
  });

  it("the hold marker carries its document and does not match another document's row", () => {
    const marker = nextAwaitingReceipt(row(1, 1), pendingSignature("committed", 2), null);
    expect(marker).toEqual({ documentId: DOC, localSeq: 1, clientTransactionId: "tx-1" });
    expect(planDrain([row(1, 1, OTHER_DOC), row(2, 1, OTHER_DOC)], null, marker)).toEqual(NOTHING);
  });

  it("rejects a marker without a document", () => {
    const bare = { localSeq: 1, clientTransactionId: "tx-1" } as unknown as AwaitingReceipt;
    expect(planDrain([row(1, 1), row(2, 1)], null, bare)).toEqual(NOTHING);
  });
});
