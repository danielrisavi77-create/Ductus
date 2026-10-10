// @vitest-environment node
/**
 * DAN-110 attack plan (issue #158): a commit whose response is lost holds the
 * queue on that same row until a verified answer for it arrives.
 *
 * Invented data only: Ana's document D1 sits on server revision 4, with rows
 * r7 (T7) and r8 (T8) queued on base 4; her document D2 has row r3 (T3).
 */
import { describe, expect, it } from "vitest";

import { emptyDocument } from "@/domain/document";
import { COMMIT_STATUSES, parseCommitOutcome } from "@/domain/serverSync/contract";

import {
  ackedRevision,
  awaitingReceiptFor,
  fastForwardBase,
  isRetryable,
  newerRowsQueued,
  nextAttemptDelayMs,
  nextAwaitingReceipt,
  outcomeToEvents,
  planDrain,
  serverSyncErrorToOutcome,
  type CommitReceiptVerification,
  type DrainOutcome,
} from "./drain";
import type { PendingTransaction, SyncMeta } from "./journal-types";
import { chipContent, SYNC_STATE_LABELS } from "./labels";
import { syncReducer, type SyncEvent, type SyncState } from "./states";

const D1 = "d1d1d1d1-0000-4000-8000-000000000001";
const D2 = "d2d2d2d2-0000-4000-8000-000000000002";
const LOST: DrainOutcome = { status: "transport_error" };

function row(documentId: string, localSeq: number, baseRevision: number): PendingTransaction {
  return {
    documentId,
    localSeq,
    tx: {
      kind: "REPLACE_DOCUMENT",
      clientTransactionId: `T${localSeq}`,
      baseRevision,
      document: emptyDocument(() => `aaaaaaaa-0000-4000-8000-${String(localSeq).padStart(12, "0")}`),
      createdAt: "2026-10-10T10:00:00.000Z",
    },
    queuedAt: "2026-10-10T10:00:00.000Z",
  };
}

const r7 = row(D1, 7, 4);
const r8 = row(D1, 8, 4);
const r3 = row(D2, 3, 1);

function meta(state: SyncState, documentId = D1): SyncMeta {
  return { documentId, state, localSeq: 0 };
}

/** The test verifier accepts only a receipt signed for the exact document, key and revision. */
function verification(
  sent: PendingTransaction,
  revision: number,
  documentId = sent.documentId,
): CommitReceiptVerification {
  return {
    expected: { documentId, clientTransactionId: sent.tx.clientTransactionId, revision },
    verify: async (signedReceipt, against) => {
      const r = signedReceipt as Record<string, unknown>;
      return (
        r.documentId === against.documentId &&
        r.clientTransactionId === against.clientTransactionId &&
        r.revision === against.revision
      );
    },
  };
}

/** A server answer; `signedFor` is the row (and document) the signer vouched for. */
function answer(
  status: "committed" | "duplicate",
  revision: number,
  signedFor: PendingTransaction | null,
  documentId = signedFor?.documentId,
): DrainOutcome {
  return {
    status,
    revision,
    receipt:
      signedFor === null
        ? { status: "pending_signature" }
        : {
            status: "signed",
            signedReceipt: {
              documentId,
              clientTransactionId: signedFor.tx.clientTransactionId,
              revision,
            },
          },
  };
}

describe("DAN-110 plan #158 — lost response", () => {
  it("1, 10, 17, 19: lost answer, new EDIT, replay, then SYNCED only for the newest row", async () => {
    const seen: SyncState[] = [];
    let state: SyncState = "LOCAL_DURABLE";
    const apply = (events: readonly SyncEvent[]) => {
      for (const event of events) {
        const next = syncReducer(state, event);
        expect(state === "SYNCED" && next === "SYNCING").toBe(false);
        state = next;
        seen.push(state);
      }
    };

    // r7 goes out; the CAS lands on revision 5 but the answer is lost.
    apply([{ type: "SYNC_STARTED" }]);
    expect(planDrain([r7], meta(state)).send).toBe(r7);
    apply(await outcomeToEvents(LOST, verification(r7, 5), false));
    expect(state).toBe("ERROR");
    let awaiting = nextAwaitingReceipt(r7, LOST, null);
    expect(awaiting).toEqual({ documentId: D1, localSeq: 7, clientTransactionId: "T7" });

    // Ana keeps typing: r8 on base 4 goes through the journal first.
    apply([{ type: "EDIT" }, { type: "LOCAL_SAVE_STARTED" }, { type: "LOCAL_SAVE_OK" }]);
    let queue = [r7, r8];
    const replay = planDrain(queue, meta(state), awaiting);
    expect(replay.send).toBe(r7);
    expect(replay.supersededUpTo).toBeNull();

    // The replay answers duplicate 5: the base moves, but r8 is newer, so no ACK.
    apply([{ type: "SYNC_STARTED" }]);
    const dup = answer("duplicate", 5, r7);
    apply(await outcomeToEvents(dup, verification(r7, 5), newerRowsQueued(queue, replay.send)));
    expect(state).toBe("SYNCING");
    const base = ackedRevision(dup);
    expect(base).toBe(5);
    awaiting = nextAwaitingReceipt(r7, dup, awaiting);
    expect(awaiting).toBeNull();
    queue = queue.filter((r) => r.localSeq > r7.localSeq);

    // r8 is fast-forwarded onto 5 and its own signed receipt earns SYNCED.
    const next = planDrain(queue, meta(state), awaiting);
    expect(next.send).toBe(r8);
    expect(fastForwardBase(next.send!.tx, base).baseRevision).toBe(5);
    apply(
      await outcomeToEvents(
        answer("committed", 6, r8),
        verification(r8, 6),
        newerRowsQueued(queue, next.send),
      ),
    );
    expect(state).toBe("SYNCED");
    expect(seen.indexOf("SYNCED")).toBe(seen.length - 1);
    for (const s of seen.slice(0, -1)) {
      expect(chipContent(s).text).not.toBe(SYNC_STATE_LABELS.SYNCED.label);
    }
    expect(chipContent("ERROR").text).not.toMatch(/spremljeno/i);
  });

  it("2: the ported marker carries its document, so planDrain sends r7 instead of nothing", () => {
    const marker = awaitingReceiptFor(r7);
    expect(marker).toEqual({ documentId: D1, localSeq: 7, clientTransactionId: "T7" });
    expect(nextAwaitingReceipt(r7, LOST, null)).toEqual(marker);
    expect(planDrain([r7, r8], meta("ERROR"), marker).send).toBe(r7);
    const withoutDocument = { localSeq: 7, clientTransactionId: "T7" };
    expect(planDrain([r7, r8], meta("ERROR"), withoutDocument as never).send).toBeNull();
  });

  it("5: a truncated or unreadable answer holds r7 like a lost one and never lets r8 out", async () => {
    const unreadable = serverSyncErrorToOutcome("odgovor-neispravan");
    expect(unreadable).toEqual(LOST);
    expect(isRetryable(unreadable)).toBe(true);
    expect(await outcomeToEvents(unreadable, verification(r7, 5), true)).toEqual([
      { type: "SYNC_FAILED", retryable: true },
    ]);
    const awaiting = nextAwaitingReceipt(r7, unreadable, null);
    expect(awaiting).toEqual(awaitingReceiptFor(r7));
    expect(planDrain([r7, r8], meta("ERROR"), awaiting).send).toBe(r7);
  });

  it("5b: every truncated payload the real parser reads as invalid holds r7 and never lets r8 out", async () => {
    const truncated: unknown[] = [
      { status: "committed", revision: 5 },
      { status: "committed", receipt: { status: "signed", signedReceipt: {} } },
      { status: "duplicate", revision: 5, receipt: {} },
      { status: "duplicate", revision: 5, receipt: { status: "signed" } },
      { status: "stale_base" },
      { status: "commi" },
      {},
      '{"status":"committed","revision":5,"rec',
      null,
    ];
    for (const raw of truncated) {
      const parsed = parseCommitOutcome(raw);
      expect(parsed).toEqual({ status: "invalid" });
      const outcome = parsed as DrainOutcome;
      expect(ackedRevision(outcome)).toBeNull();
      expect(await outcomeToEvents(outcome, verification(r7, 5), true)).toEqual([
        { type: "SYNC_FAILED", retryable: false },
      ]);
      // The CAS may have landed behind the cut: hold r7 exactly like a lost answer.
      const awaiting = nextAwaitingReceipt(r7, outcome, null);
      expect(awaiting).toEqual(nextAwaitingReceipt(r7, LOST, null));
      expect(planDrain([r7, r8], meta("ERROR"), awaiting).send).toBe(r7);
      // With a hold already in place it stays on r7.
      expect(nextAwaitingReceipt(r7, outcome, awaiting)).toEqual(awaiting);
    }
  });

  it("5c: a malformed sent row yields a marker that sends nothing instead of throwing", () => {
    const malformed = [
      undefined,
      null,
      {},
      { documentId: D1, localSeq: 7 },
      { documentId: D1, localSeq: 0, tx: r7.tx },
      { ...r7, tx: { ...r7.tx, clientTransactionId: 7 } },
    ] as unknown as PendingTransaction[];
    for (const sent of malformed) {
      const marker = awaitingReceiptFor(sent);
      expect(nextAwaitingReceipt(sent, LOST, null)).toEqual(marker);
      expect(nextAwaitingReceipt(sent, { status: "invalid" }, null)).toEqual(marker);
      // A marker that names no row stalls visibly; r8 never goes out past it.
      expect(planDrain([r7, r8], meta("ERROR"), marker).send).toBeNull();
    }
  });

  it("3: repeated lost answers keep the same marker, key and bytes while backoff grows", () => {
    const bytes = JSON.stringify(r7);
    let awaiting = nextAwaitingReceipt(r7, LOST, null);
    const first = awaiting;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const plan = planDrain([r7, r8], meta("ERROR"), awaiting);
      expect(plan.send).toBe(r7);
      awaiting = nextAwaitingReceipt(plan.send!, LOST, awaiting);
      expect(awaiting).toEqual(first);
      expect(isRetryable(LOST)).toBe(true);
    }
    expect(JSON.stringify(r7)).toBe(bytes);
    expect(nextAttemptDelayMs(3, () => 0.5)).toBeGreaterThan(nextAttemptDelayMs(1, () => 0.5));
  });

  it("4: when the request never arrived, the replay is the first commit and releases the hold", async () => {
    const awaiting = nextAwaitingReceipt(r7, LOST, null);
    const plan = planDrain([r7, r8], meta("ERROR"), awaiting);
    expect(plan.send).toBe(r7);
    const committed = answer("committed", 5, r7);
    expect(await outcomeToEvents(committed, verification(r7, 5), true)).toEqual([]);
    expect(ackedRevision(committed)).toBe(5);
    expect(nextAwaitingReceipt(r7, committed, awaiting)).toBeNull();
  });

  it("6: a late first answer and the replay's answer move the base once and ACK nothing", async () => {
    const awaiting = nextAwaitingReceipt(r7, LOST, null);
    let queue = [r7, r8];
    const bases: Array<number | null> = [];
    for (const late of [answer("committed", 5, r7), answer("duplicate", 5, r7)]) {
      expect(await outcomeToEvents(late, verification(r7, 5), newerRowsQueued(queue, r7))).toEqual(
        [],
      );
      bases.push(ackedRevision(late));
      expect(nextAwaitingReceipt(r7, late, awaiting)).toBeNull();
      queue = queue.filter((r) => r.localSeq > r7.localSeq);
    }
    expect(bases).toEqual([5, 5]);
    expect(queue).toEqual([r8]);
    expect(fastForwardBase(fastForwardBase(r8.tx, 5), 5).baseRevision).toBe(5);
  });

  it("7, 8: a verified answer for another key or another document never releases the hold", async () => {
    const held = nextAwaitingReceipt(r8, LOST, null);
    const forR7 = answer("duplicate", 5, r7);
    await outcomeToEvents(forR7, verification(r7, 5), false);
    expect(nextAwaitingReceipt(r8, forR7, held)).toEqual(held);

    const heldR7 = nextAwaitingReceipt(r7, LOST, null);
    const sameKeyD2 = answer("duplicate", 5, r7, D2);
    await outcomeToEvents(sameKeyD2, verification(r7, 5, D2), false);
    expect(nextAwaitingReceipt(r7, sameKeyD2, heldR7)).toEqual(heldR7);
  });

  it("9: a pending or bad signature on the replay keeps r7 held and never lets r8 out", async () => {
    const awaiting = nextAwaitingReceipt(r7, LOST, null);
    const pending = answer("duplicate", 5, null);
    expect(await outcomeToEvents(pending, verification(r7, 5), true)).toEqual([]);
    expect(ackedRevision(pending)).toBeNull();
    expect(nextAwaitingReceipt(r7, pending, awaiting)).toEqual(awaiting);

    const forged = answer("duplicate", 5, r8);
    expect(await outcomeToEvents(forged, verification(r7, 5), true)).toEqual([
      { type: "SYNC_FAILED", retryable: false },
    ]);
    expect(ackedRevision(forged)).toBeNull();
    expect(nextAwaitingReceipt(r7, forged, awaiting)).toEqual(awaiting);
    expect(planDrain([r7, r8], meta("ERROR"), awaiting).send).toBe(r7);
  });

  it("11: someone else's revision on the replay is a conflict, and after the rebase the new row goes out", async () => {
    // Before this fix the test asserted the hold survived stale_base. That was
    // wrong: the server refused T7 itself, so T7 never landed (a landed key
    // replays as `duplicate`), and a surviving hold replays T7 after every
    // rebase (CONFLICT loop) or, once r7 is gone, stalls the queue for good.
    const awaiting = nextAwaitingReceipt(r7, LOST, null);
    const stale: DrainOutcome = { status: "stale_base", currentRevision: 5 };
    const events = await outcomeToEvents(stale, verification(r7, 5), true);
    expect(events).toEqual([{ type: "SYNC_STALE_BASE" }]);
    expect(syncReducer("SYNCING", events[0]!)).toBe("CONFLICT");
    expect(ackedRevision(stale)).toBeNull();
    const after = nextAwaitingReceipt(r7, stale, awaiting);
    expect(after).toBeNull();

    // Still a conflict, never a rewrite: nothing leaves until Ana decides.
    expect(planDrain([r7, r8], meta("CONFLICT"), after).send).toBeNull();
    expect(syncReducer("CONFLICT", { type: "CONFLICT_RESOLVED", via: "rebase" })).toBe(
      "SAVING_LOCAL",
    );

    // The rebase journals r9 on the server's revision 5; r9 goes out, not r7,
    // whether the old rows are still queued or already cleared.
    const r9 = row(D1, 9, 5);
    expect(planDrain([r7, r8, r9], meta("LOCAL_DURABLE"), after)).toEqual({
      send: r9,
      supersededUpTo: 8,
    });
    expect(planDrain([r9], meta("LOCAL_DURABLE"), after).send).toBe(r9);
    expect(r9.tx.baseRevision).toBe(5);

    // Discarding instead leaves an empty queue and no marker to stall on.
    expect(syncReducer("CONFLICT", { type: "CONFLICT_RESOLVED", via: "discard" })).toBe("SYNCED");
    expect(planDrain([], meta("SYNCED"), after).send).toBeNull();
  });

  it("11b: a fatal refusal of the replayed key ends the hold, shows ERROR and lets a new version out", async () => {
    const awaiting = nextAwaitingReceipt(r7, LOST, null);
    const refused: DrainOutcome = { status: "invalid_document" };
    expect(await outcomeToEvents(refused, verification(r7, 5), true)).toEqual([
      { type: "SYNC_FAILED", retryable: false },
    ]);
    expect(syncReducer("SYNCING", { type: "SYNC_FAILED", retryable: false })).toBe("ERROR");
    const after = nextAwaitingReceipt(r7, refused, awaiting);
    expect(after).toBeNull();
    // r8 is on base 4 and T7 never landed, so base 4 is still the server's.
    expect(planDrain([r7, r8], meta("ERROR"), after).send).toBe(r8);
  });

  it("12: nothing older than r7 is superseded past it, and a missing r7 is a visible stall", () => {
    const awaiting = nextAwaitingReceipt(r7, LOST, null);
    const r6 = row(D1, 6, 4);
    expect(planDrain([r6, r7, r8], meta("ERROR"), awaiting)).toEqual({ send: r7, supersededUpTo: 6 });
    expect(planDrain([r8], meta("ERROR"), awaiting)).toEqual({ send: null, supersededUpTo: null });
  });

  it("13: D1's hold neither blocks nor releases D2", async () => {
    const heldD1 = nextAwaitingReceipt(r7, LOST, null);
    expect(planDrain([r3], meta("LOCAL_DURABLE", D2), null).send).toBe(r3);
    expect(planDrain([r3], meta("LOCAL_DURABLE", D2), heldD1).send).toBeNull();
    const d2Ack = answer("committed", 2, r3);
    await outcomeToEvents(d2Ack, verification(r3, 2), false);
    expect(nextAwaitingReceipt(r7, d2Ack, heldD1)).toEqual(heldD1);
  });
});

/**
 * Replay outcome → marker → next state, for a replay of the held row r7.
 * Every row of the table in the PR description is one case here.
 */
describe("DAN-110 replay outcome table", () => {
  type Row = {
    outcome: () => DrainOutcome;
    revision: number;
    marker: "released" | "held";
    events: SyncEvent[];
    state: SyncState;
    nextSend: PendingTransaction | null;
  };
  const ACK_NOTHING: SyncEvent[] = [];
  const TABLE: Record<string, Row> = {
    "committed, verified": {
      outcome: () => answer("committed", 5, r7),
      revision: 5,
      marker: "released",
      events: ACK_NOTHING,
      state: "SYNCING",
      nextSend: r8,
    },
    "duplicate, verified": {
      outcome: () => answer("duplicate", 5, r7),
      revision: 5,
      marker: "released",
      events: ACK_NOTHING,
      state: "SYNCING",
      nextSend: r8,
    },
    "committed, pending signature": {
      outcome: () => answer("committed", 5, null),
      revision: 5,
      marker: "held",
      events: ACK_NOTHING,
      state: "SYNCING",
      nextSend: r7,
    },
    "duplicate, signature for another key": {
      outcome: () => answer("duplicate", 5, r8),
      revision: 5,
      marker: "held",
      events: [{ type: "SYNC_FAILED", retryable: false }],
      state: "ERROR",
      nextSend: r7,
    },
    transport_error: {
      outcome: () => LOST,
      revision: 5,
      marker: "held",
      events: [{ type: "SYNC_FAILED", retryable: true }],
      state: "ERROR",
      nextSend: r7,
    },
    stale_base: {
      outcome: () => ({ status: "stale_base", currentRevision: 5 }),
      revision: 5,
      marker: "released",
      events: [{ type: "SYNC_STALE_BASE" }],
      state: "CONFLICT",
      nextSend: null,
    },
    ...Object.fromEntries(
      (
        [
          "too_large",
          "not_found",
          "invalid_document",
          "invalid_client_transaction_id",
        ] as const
      ).map((status) => [
        status,
        {
          outcome: () => ({ status }) as DrainOutcome,
          revision: 5,
          marker: "released",
          events: [{ type: "SYNC_FAILED", retryable: false }],
          state: "ERROR",
          nextSend: r8,
        } satisfies Row,
      ]),
    ),
    ...Object.fromEntries(
      // txid_reused: the key IS on the server (other bytes), so r7 may have
      // landed and r8 must not go out on base 4 past it.
      (["unauthenticated", "txid_reused", "invalid", "something_new"] as const).map((status) => [
        status,
        {
          outcome: () => ({ status }) as unknown as DrainOutcome,
          revision: 5,
          marker: "held",
          events: [{ type: "SYNC_FAILED", retryable: false }],
          state: "ERROR",
          nextSend: r7,
        } satisfies Row,
      ]),
    ),
  };

  for (const [name, expected] of Object.entries(TABLE)) {
    it(`${name} → marker ${expected.marker} → ${expected.state}`, async () => {
      const awaiting = nextAwaitingReceipt(r7, LOST, null);
      const queue = [r7, r8];
      expect(planDrain(queue, meta("ERROR"), awaiting).send).toBe(r7);
      const outcome = expected.outcome();
      const events = await outcomeToEvents(
        outcome,
        verification(r7, expected.revision),
        newerRowsQueued(queue, r7),
      );
      expect(events).toEqual(expected.events);
      expect(events.some((e) => e.type === "SYNC_ACK")).toBe(false);
      let state: SyncState = "SYNCING";
      for (const event of events) {
        state = syncReducer(state, event);
      }
      expect(state).toBe(expected.state);
      const after = nextAwaitingReceipt(r7, outcome, awaiting);
      expect(after).toEqual(expected.marker === "released" ? null : awaiting);
      // A released marker after a landed key drops r7 from the queue first.
      const remaining = ackedRevision(outcome) === null ? queue : queue.filter((r) => r !== r7);
      expect(planDrain(remaining, meta(state), after).send).toBe(expected.nextSend);
    });
  }
});

describe("DAN-110 every status and parser output, without a hold", () => {
  // Answers that prove the sent key did not land: no hold, the queue moves on.
  const PROVES_MISSED = new Set([
    "stale_base",
    "too_large",
    "not_found",
    "invalid_document",
    "invalid_client_transaction_id",
  ]);
  const outcomes: Array<[string, DrainOutcome]> = [
    ...COMMIT_STATUSES.map((status): [string, DrainOutcome] => {
      if (status === "committed" || status === "duplicate") {
        return [`${status}, pending signature`, answer(status, 5, null)];
      }
      if (status === "stale_base") {
        return [status, { status, currentRevision: 5 }];
      }
      return [status, { status } as DrainOutcome];
    }),
    ["committed, verified", answer("committed", 5, r7)],
    ["duplicate, verified", answer("duplicate", 5, r7)],
    ["duplicate, signed for another key", answer("duplicate", 5, r8)],
    ["transport_error", LOST],
    ["invalid (parser)", parseCommitOutcome({ status: "committed", revision: 5 }) as DrainOutcome],
    ["unknown status", { status: "something_new" } as unknown as DrainOutcome],
    ["null", null as unknown as DrainOutcome],
    ["undefined", undefined as unknown as DrainOutcome],
  ];

  for (const [name, outcome] of outcomes) {
    const proves = typeof outcome?.status === "string" && PROVES_MISSED.has(outcome.status);
    const verified = name.endsWith(", verified");
    // `unauthenticated` is refused before the RPC touches the key.
    const released = proves || verified || name === "unauthenticated";
    const expected = released ? "no hold" : "hold r7";
    it(`${name} → ${expected}`, async () => {
      if (outcome !== null && outcome !== undefined) {
        await outcomeToEvents(outcome, verification(r7, 5), true);
      }
      const after = nextAwaitingReceipt(r7, outcome, null);
      if (expected === "hold r7") {
        expect(after).toEqual(awaitingReceiptFor(r7));
        expect(planDrain([r7, r8], meta("ERROR"), after).send).toBe(r7);
      } else {
        expect(after).toBeNull();
      }
    });
  }

  it("covers every status the contract knows", () => {
    for (const status of COMMIT_STATUSES) {
      expect(outcomes.some(([, o]) => o?.status === status)).toBe(true);
    }
  });
});
