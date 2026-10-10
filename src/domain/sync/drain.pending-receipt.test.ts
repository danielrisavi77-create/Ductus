// @vitest-environment node
/**
 * Regression for the review finding on PR #97 (STATE.md F-3/F-8):
 * while a commit's receipt is `pending_signature`, the local base has not been
 * fast-forwarded, so a NEWER queued row still carries the old base. Sending it
 * would be answered `stale_base` and put the author in CONFLICT against their
 * own commit. The flow pending → EDIT → drain must instead keep replaying the
 * SAME idempotency key until the signed receipt verifies.
 */
import { describe, expect, it } from "vitest";

import { emptyDocument, type DocumentTransaction } from "@/domain/document";

import {
  ackedRevision,
  awaitingReceiptFor,
  fastForwardBase,
  isRetryable,
  newerRowsQueued,
  nextAwaitingReceipt,
  outcomeToEvents,
  planDrain,
  type AwaitingReceipt,
  type CommitReceiptVerification,
  type DrainOutcome,
} from "./drain";
import type { PendingTransaction, SyncMeta } from "./journal-types";
import { syncReducer, type SyncState } from "./states";

const DOC = "11111111-1111-4111-8111-111111111111";

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

function row(localSeq: number, baseRevision: number): PendingTransaction {
  return {
    documentId: DOC,
    localSeq,
    tx: tx(localSeq, baseRevision),
    queuedAt: "2026-09-19T10:00:00.000Z",
  };
}

function meta(state: SyncState): SyncMeta {
  return { documentId: DOC, state, localSeq: 0 };
}

function verification(clientTransactionId: string, revision: number): CommitReceiptVerification {
  return {
    expected: { documentId: DOC, clientTransactionId, revision },
    verify: async () => true,
  };
}

const PENDING: DrainOutcome = {
  status: "committed",
  revision: 2,
  receipt: { status: "pending_signature" },
};

/**
 * A stand-in server holding revision 2 after tx-1 landed: the same key replays
 * as `duplicate`, anything else is compared against the current revision.
 */
function fakeServerAfterFirstCommit(
  sent: PendingTransaction,
  signed: boolean,
): DrainOutcome {
  if (sent.tx.clientTransactionId === "tx-1") {
    return {
      status: "duplicate",
      revision: 2,
      receipt: signed
        ? { status: "signed", signedReceipt: { testReceipt: true } }
        : { status: "pending_signature" },
    };
  }
  return sent.tx.baseRevision === 2
    ? { status: "committed", revision: 3, receipt: { status: "pending_signature" } }
    : { status: "stale_base", currentRevision: 2 };
}

describe("pending receipt → EDIT → drain", () => {
  it("does not send a newer row with the un-advanced base while the receipt is pending", async () => {
    // Server is on revision 1; seq 1 (base 1) passes the CAS and creates
    // revision 2, but the signer has not published yet.
    const first = row(1, 1);
    const plan1 = planDrain([first], meta("SYNCING"));
    expect(plan1.send).toBe(first);

    const events1 = await outcomeToEvents(PENDING, verification("tx-1", 2), false);
    expect(events1).toEqual([]);
    expect(ackedRevision(PENDING)).toBeNull();
    expect(isRetryable(PENDING)).toBe(true);
    const awaiting = nextAwaitingReceipt(first, PENDING, null);
    expect(awaiting).toEqual({ documentId: DOC, localSeq: 1, clientTransactionId: "tx-1" });

    // The author keeps typing: seq 2 is queued against the same base 1.
    const second = row(2, 1);
    const plan2 = planDrain([first, second], meta("SYNCING"), awaiting);

    // The newer row must be held; the same idempotency key is replayed.
    expect(plan2.send).toBe(first);
    expect(plan2.send?.tx.clientTransactionId).toBe("tx-1");
    expect(plan2.supersededUpTo).toBeNull();

    // And the replay is not a conflict with our own commit.
    const replay = fakeServerAfterFirstCommit(plan2.send!, false);
    expect(replay.status).toBe("duplicate");
    let state: SyncState = "SYNCING";
    for (const event of await outcomeToEvents(replay, verification("tx-1", 2), false)) {
      state = syncReducer(state, event);
    }
    expect(state).toBe("SYNCING");
    expect(nextAwaitingReceipt(plan2.send!, replay, awaiting)).toEqual(awaiting);
  });

  it("releases the newer row, fast-forwarded, only after the signed receipt verifies", async () => {
    const first = row(1, 1);
    const second = row(2, 1);
    const awaiting = nextAwaitingReceipt(first, PENDING, null);

    const plan = planDrain([first, second], meta("SYNCING"), awaiting);
    const signedReplay = fakeServerAfterFirstCommit(plan.send!, true);
    const events = await outcomeToEvents(
      signedReplay,
      verification("tx-1", 2),
      newerRowsQueued([first, second], plan.send),
    );
    // Verified, but seq 2 is still queued: no SYNC_ACK (see drain.held-ack.test.ts).
    expect(events).toEqual([]);

    const acked = ackedRevision(signedReplay);
    expect(acked).toBe(2);
    const cleared = nextAwaitingReceipt(plan.send!, signedReplay, awaiting);
    expect(cleared).toBeNull();

    // The runner clears the acknowledged prefix (seq ≤ 1); seq 2 goes next.
    const next = planDrain([second], meta("LOCAL_DURABLE"), cleared);
    expect(next.send).toBe(second);
    const forwarded = fastForwardBase(next.send!.tx, acked);
    expect(forwarded.baseRevision).toBe(2);
    expect(forwarded.clientTransactionId).toBe("tx-2");
    expect(
      fakeServerAfterFirstCommit({ ...second, tx: forwarded }, false).status,
    ).toBe("committed");
  });

  it("without the hold, the newer row would conflict with the author's own commit", () => {
    // Documents the hazard the hold exists for.
    const unguarded = planDrain([row(1, 1), row(2, 1)], meta("SYNCING"));
    expect(unguarded.send?.localSeq).toBe(2);
    expect(fakeServerAfterFirstCommit(unguarded.send!, false).status).toBe("stale_base");
  });
});

describe("lost response → EDIT → drain", () => {
  const LOST: DrainOutcome = { status: "transport_error" };

  it("resends the in-flight row and fast-forwards the newer one after its receipt", async () => {
    // Server is on revision 1; seq 1 (base 1) passes the CAS and creates
    // revision 2, but the response never reaches the client.
    const first = row(1, 1);
    expect(planDrain([first], meta("SYNCING")).send).toBe(first);

    expect(await outcomeToEvents(LOST, verification("tx-1", 2), false)).toEqual([
      { type: "SYNC_FAILED", retryable: true },
    ]);
    expect(isRetryable(LOST)).toBe(true);
    expect(ackedRevision(LOST)).toBeNull();
    const awaiting = nextAwaitingReceipt(first, LOST, null);
    expect(awaiting).toEqual({ documentId: DOC, localSeq: 1, clientTransactionId: "tx-1" });

    // The author keeps typing: seq 2 is queued against the same base 1.
    const second = row(2, 1);
    const plan = planDrain([first, second], meta("SYNCING"), awaiting);

    // The held row goes out again under the same key; seq 2 stays queued.
    expect(plan.send).toBe(first);
    expect(plan.send?.tx.clientTransactionId).toBe("tx-1");
    expect(plan.supersededUpTo).toBeNull();
    const replay = fakeServerAfterFirstCommit(plan.send!, true);
    expect(replay.status).toBe("duplicate");
    let state: SyncState = "SYNCING";
    for (const event of await outcomeToEvents(
      replay,
      verification("tx-1", 2),
      newerRowsQueued([first, second], plan.send),
    )) {
      state = syncReducer(state, event);
    }
    // Verified, but seq 2 is newer: no SYNC_ACK yet, and never a conflict.
    expect(state).toBe("SYNCING");

    const acked = ackedRevision(replay);
    expect(acked).toBe(2);
    const cleared = nextAwaitingReceipt(plan.send!, replay, awaiting);
    expect(cleared).toBeNull();

    // The runner clears the acknowledged prefix (seq ≤ 1); seq 2 goes next.
    const next = planDrain([second], meta("LOCAL_DURABLE"), cleared);
    expect(next.send).toBe(second);
    const forwarded = fastForwardBase(next.send!.tx, acked);
    expect(forwarded.baseRevision).toBe(2);
    expect(forwarded.clientTransactionId).toBe("tx-2");
    expect(
      fakeServerAfterFirstCommit({ ...second, tx: forwarded }, false).status,
    ).toBe("committed");
  });

  it("keeps holding the same row across repeated lost responses", () => {
    const first = row(1, 1);
    const queue = [first, row(2, 1), row(3, 1)];
    let awaiting = nextAwaitingReceipt(first, LOST, null);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const plan = planDrain(queue, meta("SYNCING"), awaiting);
      expect(plan.send).toBe(first);
      awaiting = nextAwaitingReceipt(plan.send!, LOST, awaiting);
      expect(awaiting).toEqual({ documentId: DOC, localSeq: 1, clientTransactionId: "tx-1" });
    }
  });

  it("the marker written before the send is the one a lost response leaves", () => {
    // Contract only: the DAN-49 runner persists this before sending, so a
    // reload mid-flight resumes with the same hold a transport_error leaves.
    const first = row(1, 1);
    const beforeSend = awaitingReceiptFor(first);
    expect(beforeSend).toEqual(nextAwaitingReceipt(first, LOST, null));
    expect(nextAwaitingReceipt(first, LOST, beforeSend)).toEqual(beforeSend);
    expect(planDrain([first, row(2, 1)], meta("LOCAL_DURABLE"), beforeSend).send).toBe(first);
  });

  it("a real stale_base on the held row is a conflict and ends the hold", async () => {
    // Someone else moved the document: replaying the held row must not be
    // softened into a retry. The server read tx-1 and refused it, so it did
    // not land (a landed key replays as `duplicate`) and nothing is owed.
    const first = row(1, 1);
    const awaiting = nextAwaitingReceipt(first, LOST, null);
    const stale: DrainOutcome = { status: "stale_base", currentRevision: 5 };
    expect(await outcomeToEvents(stale, verification("tx-1", 2), false)).toEqual([
      { type: "SYNC_STALE_BASE" },
    ]);
    expect(isRetryable(stale)).toBe(false);
    expect(ackedRevision(stale)).toBeNull();
    const after = nextAwaitingReceipt(first, stale, awaiting);
    expect(after).toBeNull();
    // CONFLICT holds everything until the author decides; a rebase then
    // journals a new row on the server's base, and that row goes out.
    expect(planDrain([first, row(2, 1)], meta("CONFLICT"), after).send).toBeNull();
    const rebased = row(3, 5);
    expect(planDrain([first, row(2, 1), rebased], meta("LOCAL_DURABLE"), after).send).toBe(
      rebased,
    );
  });
});

describe("planDrain — holding for a receipt", () => {
  const awaiting: AwaitingReceipt = { documentId: DOC, localSeq: 2, clientTransactionId: "tx-2" };

  it("still supersedes rows older than the held row, never the newer ones", () => {
    const plan = planDrain([row(1, 1), row(2, 1), row(3, 1), row(4, 1)], null, awaiting);
    expect(plan.send?.localSeq).toBe(2);
    expect(plan.supersededUpTo).toBe(1);
  });

  it("sends nothing when the held row is no longer in the queue", () => {
    expect(planDrain([row(3, 1), row(4, 1)], null, awaiting)).toEqual({
      send: null,
      supersededUpTo: null,
    });
  });

  it("sends nothing when the row at that sequence carries a different idempotency key", () => {
    expect(
      planDrain([row(2, 1), row(3, 1)], null, { documentId: DOC, localSeq: 2, clientTransactionId: "tx-other" }),
    ).toEqual({ send: null, supersededUpTo: null });
  });

  it("sends nothing when the held row sits at or beyond an unsafe boundary", () => {
    const damaged = { ...row(1, 1), tx: { ...tx(1, 1), kind: "FUTURE_KIND" } } as unknown as PendingTransaction;
    expect(planDrain([damaged, row(2, 1), row(3, 1)], null, awaiting).send).toBeNull();
    expect(planDrain([row(2, 1), row(2, 1), row(3, 1)], null, awaiting).send).toBeNull();
  });

  it("fails closed on a malformed marker instead of sending the newest row", () => {
    const queue = [row(1, 1), row(2, 1)];
    for (const bad of [
      {},
      { documentId: DOC, localSeq: 1 },
      { documentId: DOC, localSeq: 1.5, clientTransactionId: "tx-1" },
      { documentId: DOC, localSeq: 0, clientTransactionId: "tx-1" },
      { documentId: DOC, localSeq: 1, clientTransactionId: "" },
      "tx-1",
      1,
    ]) {
      expect(planDrain(queue, null, bad as unknown as AwaitingReceipt).send).toBeNull();
    }
  });

  it("keeps the sticky states sticky", () => {
    const queue = [row(2, 1), row(3, 1)];
    expect(planDrain(queue, meta("CONFLICT"), awaiting).send).toBeNull();
    expect(planDrain(queue, meta("RECOVERY_REQUIRED"), awaiting).send).toBeNull();
  });

  it("behaves exactly as before when nothing is awaited", () => {
    const queue = [row(1, 1), row(2, 1)];
    expect(planDrain(queue, null, null)).toEqual(planDrain(queue, null));
    expect(planDrain(queue, null, undefined).send?.localSeq).toBe(2);
  });

  it("does not mutate its inputs", () => {
    const queue = [row(1, 1), row(2, 1), row(3, 1)];
    const before = JSON.stringify(queue);
    const marker = { ...awaiting };
    planDrain(queue, null, marker);
    expect(JSON.stringify(queue)).toBe(before);
    expect(marker).toEqual(awaiting);
  });
});

describe("nextAwaitingReceipt", () => {
  const sent = row(3, 1);
  const previous: AwaitingReceipt = { documentId: DOC, localSeq: 3, clientTransactionId: "tx-3" };

  it("holds after a CAS success whose signed receipt failed verification", async () => {
    const outcome: DrainOutcome = {
      status: "committed",
      revision: 2,
      receipt: { status: "signed", signedReceipt: { testReceipt: true } },
    };
    const events = await outcomeToEvents(
      outcome,
      {
        expected: { documentId: DOC, clientTransactionId: "tx-3", revision: 2 },
        verify: async () => false,
      },
      false,
    );
    expect(events).toEqual([{ type: "SYNC_FAILED", retryable: false }]);
    // The commit landed on the server even though it cannot be acknowledged.
    expect(nextAwaitingReceipt(sent, outcome, null)).toEqual(previous);
  });

  it("holds after a CAS success with no receipt at all", () => {
    const bare = { status: "committed", revision: 2 } as unknown as DrainOutcome;
    expect(nextAwaitingReceipt(sent, bare, null)).toEqual(previous);
  });

  it("holds the sent row when no server answer was learned", () => {
    // The response may be what was lost: the CAS can have landed unheard.
    expect(nextAwaitingReceipt(sent, { status: "transport_error" }, previous)).toEqual(previous);
    expect(nextAwaitingReceipt(sent, { status: "transport_error" }, null)).toEqual(previous);
  });

  it("does not start a hold on answers that say the commit did not land", () => {
    for (const outcome of [
      { status: "stale_base", currentRevision: 9 },
      { status: "too_large" },
      { status: "invalid" },
      null,
    ] as unknown as DrainOutcome[]) {
      expect(nextAwaitingReceipt(sent, outcome, null)).toBeNull();
    }
  });

  const KEY_REFUSALS = [
    { status: "stale_base", currentRevision: 9 },
    { status: "too_large" },
    { status: "txid_reused" },
    { status: "not_found" },
    { status: "invalid_document" },
    { status: "invalid_client_transaction_id" },
  ] as unknown as DrainOutcome[];
  const SAYS_NOTHING_ABOUT_LANDING = [
    { status: "unauthenticated" },
    { status: "invalid" },
    { status: "something_new" },
    null,
    undefined,
  ] as unknown as DrainOutcome[];

  it("ends the hold when the server refuses the held key itself", () => {
    // A landed key replays as `duplicate`, so a refusal of the same key
    // proves it never landed: keeping the hold would replay it forever.
    for (const outcome of KEY_REFUSALS) {
      expect(nextAwaitingReceipt(sent, outcome, previous)).toBeNull();
    }
  });

  it("keeps the hold on answers that say nothing about whether the key landed", () => {
    for (const outcome of SAYS_NOTHING_ABOUT_LANDING) {
      expect(nextAwaitingReceipt(sent, outcome, previous)).toEqual(previous);
    }
  });

  it("a refusal of another row never releases the held one", () => {
    const others = [
      row(4, 1),
      { ...row(3, 1), tx: { ...tx(3, 1), clientTransactionId: "tx-other" } },
      { ...row(3, 1), documentId: "22222222-2222-4222-8222-222222222222" },
    ];
    for (const other of others) {
      for (const outcome of [...KEY_REFUSALS, ...SAYS_NOTHING_ABOUT_LANDING]) {
        expect(nextAwaitingReceipt(other, outcome, previous)).toEqual(previous);
      }
    }
  });

  it("an unverified outcome object can never clear the marker by itself", () => {
    const forged: DrainOutcome = {
      status: "duplicate",
      revision: 2,
      receipt: { status: "signed", signedReceipt: { testReceipt: true } },
    };
    // outcomeToEvents was never run, so nothing vouches for this receipt.
    expect(nextAwaitingReceipt(sent, forged, previous)).toEqual(previous);
  });
});
