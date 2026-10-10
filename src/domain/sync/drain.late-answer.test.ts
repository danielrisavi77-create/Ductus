// @vitest-environment node
/**
 * Late answers of earlier attempts (#181, attack plan #183).
 *
 * An answer is judged against the queue it finds when it is processed, never
 * against the queue that produced the send. SYNCED is earned only by a
 * verified receipt for the newest queued row; an answer for a row that has
 * already left the queue changes nothing; an answer for a row that is still
 * owed is never dropped. Numbers in test names are the attacks of #183.
 */
import { describe, expect, it } from "vitest";

import { emptyDocument } from "@/domain/document";

import {
  ackedRevision,
  fastForwardBase,
  newerRowsQueued,
  nextAwaitingReceipt,
  outcomeToEvents,
  planDrain,
  type AnswerFlight,
  type CommitReceiptVerification,
  type DrainOutcome,
} from "./drain";
import type { PendingTransaction } from "./journal-types";
import { syncReducer, type SyncEvent, type SyncState } from "./states";

const D1 = "d1d1d1d1-0000-4000-8000-000000000001";
const D2 = "d2d2d2d2-0000-4000-8000-000000000002";

function row(seq: number, base: number, documentId = D1): PendingTransaction {
  return {
    documentId,
    localSeq: seq,
    tx: {
      kind: "REPLACE_DOCUMENT",
      clientTransactionId: `T${seq}`,
      baseRevision: base,
      document: emptyDocument(() => `aaaaaaaa-0000-4000-8000-${String(seq).padStart(12, "0")}`),
      createdAt: "2026-10-10T10:00:00.000Z",
    },
    queuedAt: "2026-10-10T10:00:00.000Z",
  };
}

function ver(sent: PendingTransaction, revision: number): CommitReceiptVerification {
  return {
    expected: { documentId: sent.documentId, clientTransactionId: sent.tx.clientTransactionId, revision },
    verify: async () => true,
  };
}

function signed(status: "committed" | "duplicate", revision: number): DrainOutcome {
  return { status, revision, receipt: { status: "signed", signedReceipt: { testReceipt: true } } };
}

function unsigned(status: "committed" | "duplicate", revision: number): DrainOutcome {
  return { status, revision, receipt: { status: "pending_signature" } };
}

const meta = (state: SyncState) => ({ documentId: D1, state, localSeq: 0 });
const reduce = (state: SyncState, events: readonly SyncEvent[]) => events.reduce(syncReducer, state);
const flight = (sent: PendingTransaction, pending: readonly PendingTransaction[]): AnswerFlight => ({
  sent,
  pending,
});
const STALE: DrainOutcome = { status: "stale_base", currentRevision: 6 };
const REUSED: DrainOutcome = { status: "txid_reused" };

const r7 = row(7, 4);
const r8 = row(8, 4);

describe("a late answer of an earlier attempt (#181)", () => {
  it("1: never reports SYNCED while a newer row is owed, and the newer row's stale_base still conflicts", async () => {
    let state: SyncState = "LOCAL_DURABLE";
    let queue = [r7];
    const plan1 = planDrain(queue, meta(state), null);
    expect(plan1.send).toBe(r7);
    // At send time nothing newer was queued; that is exactly what #181 trusted.
    expect(newerRowsQueued(queue, plan1.send)).toBe(false);
    state = reduce(state, [{ type: "SYNC_STARTED" }]);
    const lost: DrainOutcome = { status: "transport_error" };
    state = reduce(state, await outcomeToEvents(lost, ver(r7, 0), flight(r7, queue)));
    let awaiting = nextAwaitingReceipt(r7, lost, null);
    expect(state).toBe("ERROR");

    // The author types r8 while the server had in fact committed r7 as revision 5.
    queue = [r7, r8];
    state = reduce(state, [{ type: "EDIT" }, { type: "LOCAL_SAVE_STARTED" }, { type: "LOCAL_SAVE_OK" }]);
    const plan2 = planDrain(queue, meta(state), awaiting);
    expect(plan2.send).toBe(r7);
    state = reduce(state, [{ type: "SYNC_STARTED" }]);
    const dup = signed("duplicate", 5);
    expect(await outcomeToEvents(dup, ver(r7, 5), flight(r7, queue))).toEqual([]);
    awaiting = nextAwaitingReceipt(r7, dup, awaiting);
    expect(awaiting).toBeNull();
    const base = ackedRevision(dup);
    queue = queue.filter((r) => r.localSeq > 7);
    const plan3 = planDrain(queue, meta(state), awaiting);
    expect(plan3.send).toBe(r8);
    expect(fastForwardBase(r8.tx, base).baseRevision).toBe(5);

    // Attempt 1's answer arrives now, while r8 is in flight.
    const late = signed("committed", 5);
    state = reduce(state, await outcomeToEvents(late, ver(r7, 5), flight(r7, queue)));
    const stateAfterLate = state;
    expect(nextAwaitingReceipt(r7, late, awaiting)).toBe(awaiting);
    expect(ackedRevision(late)).toBeNull();

    state = reduce(state, await outcomeToEvents(STALE, ver(r8, 0), flight(r8, queue)));
    expect({ stateAfterLate, finalState: state, owed: queue.map((r) => r.localSeq) }).toEqual({
      stateAfterLate: "SYNCING",
      finalState: "CONFLICT",
      owed: [8],
    });
  });

  it("2: after r8 is acknowledged, a late answer for r7 changes neither state nor base", async () => {
    const ack = signed("committed", 6);
    let state = reduce("SYNCING", await outcomeToEvents(ack, ver(r8, 6), flight(r8, [r8])));
    expect(state).toBe("SYNCED");
    const queue: PendingTransaction[] = [];
    for (const late of [signed("committed", 5), signed("duplicate", 5), STALE, REUSED]) {
      const events = await outcomeToEvents(late, ver(r7, 5), flight(r7, queue));
      expect(events, late.status).toEqual([]);
      state = reduce(state, events);
      expect(ackedRevision(late), late.status).toBeNull();
      expect(nextAwaitingReceipt(r7, late, null), late.status).toBeNull();
    }
    expect(state).toBe("SYNCED");
  });

  it("3: the base never moves backwards", async () => {
    // A settled late answer verifies nothing, so it offers no revision at all …
    const late = signed("duplicate", 3);
    expect(await outcomeToEvents(late, ver(r7, 3), flight(r7, [r8]))).toEqual([]);
    expect(ackedRevision(late)).toBeNull();
    // … and a verified revision below a row's base never lowers it.
    const ahead = row(9, 6);
    expect(fastForwardBase(ahead.tx, 5).baseRevision).toBe(6);
    expect(fastForwardBase(ahead.tx, ackedRevision(late)).baseRevision).toBe(6);
  });

  it("4: a late stale_base for r7 after its duplicate is no conflict with our own commit", async () => {
    const queue = [r8];
    const events = await outcomeToEvents(STALE, ver(r7, 0), flight(r7, queue));
    expect(events).toEqual([]);
    expect(reduce("SYNCING", events)).toBe("SYNCING");
    const held = nextAwaitingReceipt(r8, { status: "transport_error" }, null);
    expect(nextAwaitingReceipt(r7, STALE, held)).toBe(held);
    // Control: the same refusal for the owed r8 is a conflict.
    expect(reduce("SYNCING", await outcomeToEvents(STALE, ver(r8, 0), flight(r8, queue)))).toBe(
      "CONFLICT",
    );
  });

  it("5: a late txid_reused for an acknowledged r7 neither diverges nor marks a hold", async () => {
    const events = await outcomeToEvents(REUSED, ver(r7, 0), flight(r7, [r8]));
    expect(events).toEqual([]);
    expect(reduce("SYNCING", events)).toBe("SYNCING");
    expect(nextAwaitingReceipt(r7, REUSED, null)).toBeNull();
    const held = nextAwaitingReceipt(r8, { status: "transport_error" }, null);
    expect(nextAwaitingReceipt(r7, REUSED, held)).toBe(held);
    // Control: txid_reused for the owed r8 still reaches RECOVERY_REQUIRED (DAN-135).
    expect(reduce("SYNCING", await outcomeToEvents(REUSED, ver(r8, 0), flight(r8, [r8])))).toBe(
      "RECOVERY_REQUIRED",
    );
  });

  it("6: a late pending_signature after the signed answer restores no hold", async () => {
    const late = unsigned("committed", 5);
    for (const queue of [[], [r8]]) {
      expect(await outcomeToEvents(late, ver(r7, 5), flight(r7, queue))).toEqual([]);
      expect(nextAwaitingReceipt(r7, late, null)).toBeNull();
    }
  });

  it("7: the same answer delivered twice changes nothing the second time", async () => {
    const answer = signed("committed", 5);
    let queue = [r7];
    let state = reduce("SYNCING", await outcomeToEvents(answer, ver(r7, 5), flight(r7, queue)));
    expect(state).toBe("SYNCED");
    expect(ackedRevision(answer)).toBe(5);
    queue = [];
    const again = await outcomeToEvents(answer, ver(r7, 5), flight(r7, queue));
    expect(again).toEqual([]);
    state = reduce(state, again);
    expect(state).toBe("SYNCED");
    expect(ackedRevision(answer)).toBeNull();
    expect(nextAwaitingReceipt(r7, answer, null)).toBeNull();
  });

  it("8: an answer for D2 does nothing for D1's flight", async () => {
    const r7OnD2 = row(7, 4, D2);
    const heldD1 = nextAwaitingReceipt(r7, { status: "transport_error" }, null);
    const forD2 = signed("duplicate", 5);
    expect(await outcomeToEvents(forD2, ver(r7OnD2, 5), flight(r7OnD2, [r7OnD2]))).toEqual([
      { type: "SYNC_ACK" },
    ]);
    expect(nextAwaitingReceipt(r7, forD2, heldD1)).toEqual(heldD1);
    // Verified for D2 but handed D1's flight: bound to the wrong row, fail closed.
    const crossed = signed("duplicate", 5);
    expect(await outcomeToEvents(crossed, ver(r7OnD2, 5), flight(r7, [r7, r8]))).toEqual([
      { type: "SYNC_FAILED", retryable: false },
    ]);
    expect(ackedRevision(crossed)).toBeNull();
    expect(nextAwaitingReceipt(r7, crossed, heldD1)).toEqual(heldD1);
  });

  it("9: SYNCED is unreachable while rows wait, so SYNCED has nothing owed to swallow", async () => {
    const rows = [row(1, 1), row(2, 1), row(3, 1)];
    for (let s = 0; s < rows.length; s += 1) {
      for (let first = 0; first <= s; first += 1) {
        for (let last = s; last <= rows.length; last += 1) {
          const sent = rows[s]!;
          const pending = rows.slice(first, last);
          const answer = signed("committed", 2);
          const events = await outcomeToEvents(answer, ver(sent, 2), flight(sent, pending));
          const left = pending.filter((r) => r.localSeq > sent.localSeq);
          if (events.some((e) => e.type === "SYNC_ACK")) {
            // ACK only when the queue the answer finds empties with it.
            expect(left).toEqual([]);
            expect(pending).toContain(sent);
          }
          expect(events.some((e) => e.type === "SYNC_ACK")).toBe(pending.includes(sent) && left.length === 0);
        }
      }
    }
  });

  it("10: the caller passes the queue, not a verdict; a remembered flag no longer compiles or acks", async () => {
    const answer = signed("committed", 5);
    // @ts-expect-error the answer takes its flight, not a send-time boolean
    expect(await outcomeToEvents(answer, ver(r7, 5), false)).toEqual([]);
    expect(ackedRevision(answer)).toBe(5);
  });
});

describe("restart mid-flight (#183 t. 11 to 13)", () => {
  it("11: a reload while r8 flies resends r8 and earns SYNCED only with its own receipt", async () => {
    const queue = [r8];
    const plan = planDrain(queue, meta("SYNCING"), null);
    expect(plan.send).toBe(r8);
    const pending = unsigned("duplicate", 5);
    expect(await outcomeToEvents(pending, ver(r8, 5), flight(r8, queue))).toEqual([]);
    const held = nextAwaitingReceipt(r8, pending, null);
    const replay = signed("duplicate", 5);
    expect(reduce("SYNCING", await outcomeToEvents(replay, ver(r8, 5), flight(r8, queue)))).toBe("SYNCED");
    expect(nextAwaitingReceipt(r8, replay, held)).toBeNull();
  });

  it("12, 13: KNOWN GAP: the hold is not journalled, so a reload sends r8 on its stored base", async () => {
    // r7 landed as revision 5 (its answer was lost, or processed but r7 not yet
    // removed); after a reload the queue is [r7, r8] and no hold survives.
    const queue = [r7, r8];
    const plan = planDrain(queue, meta("SYNCING"), null);
    expect(plan.send).toBe(r8);
    expect(plan.supersededUpTo).toBe(7);
    expect(plan.send?.tx.baseRevision).toBe(4);
    // The server refuses base 4: a conflict with our own commit, but visible.
    // No SYNCED is ever reported before r8 itself is acknowledged.
    expect(reduce("SYNCING", await outcomeToEvents(STALE, ver(r8, 0), flight(r8, queue)))).toBe("CONFLICT");
  });
});

describe("controls: no false blocking (#183)", () => {
  it("the normal path reaches SYNCED at once", async () => {
    expect(reduce("SYNCING", await outcomeToEvents(signed("committed", 5), ver(r7, 5), flight(r7, [r7])))).toBe(
      "SYNCED",
    );
  });

  it("a held replay still ends in SYNCED once the newest row is acknowledged", async () => {
    let awaiting = nextAwaitingReceipt(r7, unsigned("committed", 5), null);
    let queue = [r7, r8];
    expect(planDrain(queue, meta("SYNCING"), awaiting).send).toBe(r7);
    const dup = signed("duplicate", 5);
    let state = reduce("SYNCING", await outcomeToEvents(dup, ver(r7, 5), flight(r7, queue)));
    awaiting = nextAwaitingReceipt(r7, dup, awaiting);
    expect(awaiting).toBeNull();
    queue = [r8];
    const sent = { ...r8, tx: fastForwardBase(r8.tx, ackedRevision(dup)) };
    expect(sent.tx.baseRevision).toBe(5);
    state = reduce(state, await outcomeToEvents(signed("committed", 6), ver(sent, 6), flight(sent, queue)));
    expect(state).toBe("SYNCED");
  });

  it("a slow answer that is still for the current flight is accepted", async () => {
    // r8 went out; no retry, no newer row: however late, the answer is current.
    const queue = [r8];
    expect(reduce("SYNCING", await outcomeToEvents(signed("committed", 6), ver(r8, 6), flight(r8, queue)))).toBe(
      "SYNCED",
    );
  });
});
