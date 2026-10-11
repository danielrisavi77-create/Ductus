// @vitest-environment node
/**
 * Recovery from a held `txid_reused` (DAN-135, attack plan #166).
 *
 * Invented scene, used throughout: Ana writes document D1. Row r7 (key T7,
 * "Uvod v1") was sent, its answer was lost, and the server meanwhile holds
 * revision 5 under T7 with other bytes ("Uvod v1a"). Rows r8 and r9 were
 * queued after r7. Her second document D2 has row r3. Item numbers below are
 * the plan's.
 */
import { describe, expect, it } from "vitest";

import {
  newNodeId,
  paragraphNode,
  textNode,
  type CanonicalDocument,
} from "@/domain/document";

import {
  adoptDiscardsNewerRows,
  adoptServerEvents,
  isDiverged,
  isRetryable,
  mayAttempt,
  nextAwaitingReceipt,
  outcomeToEvents,
  planDrain,
  scheduleAfterOutcome,
  type AnswerFlight,
  type AwaitingReceipt,
  type DrainOutcome,
  type RetrySchedules,
} from "./drain";
import type { PendingTransaction } from "./journal-types";
import { chipContent, SYNC_STATE_LABELS } from "./labels";
import { planRecovery } from "./recovery";
import { SYNC_STATES, syncReducer, type SyncEvent, type SyncState } from "./states";

const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";
const SERVER_REVISION = 5;

function doc(prefix: string, ...paragraphs: string[]): CanonicalDocument {
  let n = 0;
  const nextId = () => {
    n += 1;
    return `${prefix.repeat(8)}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
  return {
    schemaVersion: 1,
    nodes: paragraphs.map((text) => paragraphNode(newNodeId(nextId), [textNode(text)])),
  };
}

function row(localSeq: number, text: string, documentId = D1, baseRevision = 4): PendingTransaction {
  return {
    documentId,
    localSeq,
    tx: {
      kind: "REPLACE_DOCUMENT",
      clientTransactionId: `T${localSeq}`,
      baseRevision,
      document: doc("a", text),
      createdAt: "2026-10-10T10:00:00.000Z",
    },
    queuedAt: "2026-10-10T10:00:00.000Z",
  };
}

const R7 = row(7, "Uvod v1");
const R8 = row(8, "Uvod v1, drugi odlomak");
const R9 = row(9, "Uvod v1, treći odlomak");
const QUEUE = [R7, R8, R9];
const D2_R3 = row(3, "Sažetak", D2);
const R7_ON_D2 = { ...R7, documentId: D2 };
const SERVER_DOC = doc("b", "Uvod v1a");
const HELD_R7: AwaitingReceipt = { documentId: D1, localSeq: 7, clientTransactionId: "T7" };
const REUSED: DrainOutcome = { status: "txid_reused" };

function meta(state: SyncState, documentId = D1) {
  return { documentId, state, localSeq: 0 };
}

function reduce(state: SyncState, events: readonly SyncEvent[]): SyncState {
  return events.reduce(syncReducer, state);
}

/** The answer's flight: `sent` went out, and `pending` is the queue the answer finds. */
function flight(sent: PendingTransaction, pending: readonly PendingTransaction[] = QUEUE): AnswerFlight {
  return { sent, pending };
}

function verification(clientTransactionId: string, revision: number, documentId = D1) {
  return { expected: { documentId, clientTransactionId, revision }, verify: async () => true };
}

function signedDuplicate(revision: number): DrainOutcome {
  return {
    status: "duplicate",
    revision,
    receipt: { status: "signed", signedReceipt: { testReceipt: true } },
  };
}

/** r7 replayed out of its hold and answered `txid_reused`. */
async function diverge(): Promise<{ marker: AwaitingReceipt | null; state: SyncState }> {
  const plan = planDrain(QUEUE, meta("SYNCING"), HELD_R7);
  expect(plan.send).toBe(R7);
  const events = await outcomeToEvents(REUSED, verification("T7", 0), flight(R7));
  return {
    marker: nextAwaitingReceipt(R7, REUSED, HELD_R7),
    state: reduce(reduce("LOCAL_DURABLE", [{ type: "SYNC_STARTED" }]), events),
  };
}

/** The salvage journal transaction: marker cleared, newest text as a NEW row and key on the server revision. */
function salvage(queue: readonly PendingTransaction[]): PendingTransaction[] {
  const newest = queue.at(-1)!;
  const salvaged = row(10, "Uvod v1, treći odlomak", D1, SERVER_REVISION);
  return [...queue, { ...salvaged, tx: { ...salvaged.tx, document: newest.tx.document } }];
}

describe("held txid_reused — finite exit (DAN-135)", () => {
  it("1, 3: one answer, then RECOVERY_REQUIRED; nothing is sent again, under any key", async () => {
    const { marker, state } = await diverge();
    expect(state).toBe("RECOVERY_REQUIRED");
    expect(isDiverged(marker)).toBe(true);
    // Whatever the runner still believes about the state, the diverged hold sends nothing.
    for (const s of SYNC_STATES) {
      expect(planDrain(QUEUE, meta(s), marker).send).toBeNull();
    }
    // A row typed afterwards does not slip out under a fresh key either.
    expect(planDrain([...QUEUE, row(10, "Novo")], meta("LOCAL_DURABLE"), marker).send).toBeNull();
    expect(isRetryable(REUSED)).toBe(false);
  });

  it("2: RECOVERY_REQUIRED is left only by an explicit RECOVERED", async () => {
    const { state } = await diverge();
    const exits = ["salvage-local", "adopt-server"] as const;
    expect(exits.map((via) => syncReducer(state, { type: "RECOVERED", via }))).toEqual([
      "SAVING_LOCAL",
      "SYNCED",
    ]);
    for (const event of [
      { type: "EDIT" },
      { type: "SYNC_STARTED" },
      { type: "SYNC_ACK" },
      { type: "SYNC_FAILED", retryable: true },
      { type: "SYNC_KEY_DIVERGED" },
    ] as SyncEvent[]) {
      expect(syncReducer(state, event)).toBe("RECOVERY_REQUIRED");
    }
  });

  it("4, 5: both options are offered and validated; salvage keeps r8 and r9 until the new row is acked", async () => {
    const { marker } = await diverge();
    const plan = planRecovery({
      journalReadable: true,
      snapshot: null,
      pendingNewest: { document: R9.tx.document, revision: R9.tx.baseRevision, at: R9.queuedAt },
      serverDocument: SERVER_DOC,
      serverRevision: SERVER_REVISION,
    });
    expect(plan.canSalvageLocal).toBe(true);
    expect(plan.canAdoptServer).toBe(true);
    expect(plan.salvage?.document).toEqual(R9.tx.document);
    expect(plan.salvage?.nextBaseRevision).toBe(SERVER_REVISION);
    expect(plan.adopt?.document).toEqual(SERVER_DOC);

    // The marker still names r7 and nothing was dropped by the answer itself.
    expect(marker).toMatchObject(HELD_R7);
    const salvaged = salvage(QUEUE);
    expect(salvaged.slice(0, 3)).toEqual(QUEUE);
    const next = planDrain(salvaged, meta("LOCAL_DURABLE"), null);
    expect(next.send?.tx.clientTransactionId).toBe("T10");
    expect(next.send?.tx.baseRevision).toBe(SERVER_REVISION);
    expect(next.supersededUpTo).toBe(9);
  });

  it("6: the same key never earns SYNCED without a verified receipt for it", async () => {
    // Even if the bytes looked equal locally, txid_reused is not a success.
    expect(await outcomeToEvents(REUSED, verification("T7", 0), flight(R7, [R7]))).toEqual([
      { type: "SYNC_KEY_DIVERGED" },
    ]);
    const unsigned: DrainOutcome = {
      status: "duplicate",
      revision: SERVER_REVISION,
      receipt: { status: "pending_signature" },
    };
    expect(await outcomeToEvents(unsigned, verification("T7", SERVER_REVISION), flight(R7, [R7]))).toEqual([]);
    // An unverified duplicate after divergence keeps the diverged hold.
    const diverged = nextAwaitingReceipt(R7, REUSED, HELD_R7);
    expect(nextAwaitingReceipt(R7, unsigned, diverged)).toBe(diverged);
  });

  it("11: txid_reused never becomes CONFLICT, from any state where it is legal", async () => {
    const events = await outcomeToEvents(REUSED, verification("T7", 0), flight(R7));
    expect(events.some((e) => e.type === "SYNC_STALE_BASE")).toBe(false);
    for (const s of SYNC_STATES) {
      // Legal: RECOVERY_REQUIRED. Illegal: the state stays as it was.
      expect([s, "RECOVERY_REQUIRED"]).toContain(reduce(s, events));
      if (s !== "CONFLICT") {
        expect(reduce(s, events)).not.toBe("CONFLICT");
      }
    }
  });
});

describe("held txid_reused — backoff (DAN-135)", () => {
  const T0 = 1_000_000;
  const half = () => 0.5;

  it("7: a lost answer waits, the wait grows, and a new EDIT does not reset it", () => {
    const lost: DrainOutcome = { status: "transport_error" };
    const held = nextAwaitingReceipt(R7, lost, HELD_R7);
    let schedules: RetrySchedules = scheduleAfterOutcome(new Map(), D1, held, T0, half);
    expect(mayAttempt(schedules, D1, T0)).toBe(false);
    expect(mayAttempt(schedules, D1, T0 + 999)).toBe(false);
    expect(mayAttempt(schedules, D1, T0 + 1_000)).toBe(true);

    // Ana types r10: the plan still owes r7, and the schedule is untouched.
    const typed = [...QUEUE, row(10, "Novo")];
    expect(planDrain(typed, meta("ERROR"), held).send).toBe(R7);
    expect(mayAttempt(schedules, D1, T0 + 500)).toBe(false);

    schedules = scheduleAfterOutcome(schedules, D1, held, T0 + 1_000, half);
    expect(schedules.get(D1)).toEqual({ attempt: 2, notBefore: T0 + 3_000 });
  });

  it("9: D1's wait never delays D2", () => {
    const schedules = scheduleAfterOutcome(new Map(), D1, HELD_R7, T0, half);
    expect(mayAttempt(schedules, D2, T0)).toBe(true);
    expect(planDrain([D2_R3], meta("LOCAL_DURABLE", D2), null).send).toBe(D2_R3);
  });

  it("8: one retry rule: a retryable answer keeps a sendable hold; txid_reused ends the schedule", async () => {
    const outcomes: DrainOutcome[] = [
      { status: "transport_error" },
      { status: "committed", revision: 5, receipt: { status: "pending_signature" } },
      REUSED,
      { status: "unauthenticated" },
      { status: "invalid" },
      { status: "too_large" },
    ];
    for (const outcome of outcomes) {
      const held = nextAwaitingReceipt(R7, outcome, HELD_R7);
      const events = await outcomeToEvents(outcome, verification("T7", 5), flight(R7));
      const schedules = scheduleAfterOutcome(new Map(), D1, held, T0, half);
      if (isRetryable(outcome)) {
        expect(isDiverged(held)).toBe(false);
        expect(planDrain(QUEUE, meta("SYNCING"), held).send).toBe(R7);
        expect(events.every((e) => e.type === "SYNC_FAILED" && e.retryable)).toBe(true);
        expect(schedules.has(D1)).toBe(true);
      }
      if (outcome.status === "txid_reused") {
        expect(isRetryable(outcome)).toBe(false);
        expect(schedules.has(D1)).toBe(false);
      }
    }
  });
});

describe("held txid_reused — the marker (DAN-135)", () => {
  it("10: a late verified duplicate releases it only for D1/T7", async () => {
    const { marker } = await diverge();

    const forT8 = signedDuplicate(6);
    await outcomeToEvents(forT8, verification("T8", 6), flight(R8));
    expect(nextAwaitingReceipt(R8, forT8, marker)).toBe(marker);

    const forD2 = signedDuplicate(5);
    await outcomeToEvents(forD2, verification("T7", 5, D2), flight(R7_ON_D2, [R7_ON_D2]));
    expect(nextAwaitingReceipt(R7, forD2, marker)).toBe(marker);

    const forT7 = signedDuplicate(5);
    await outcomeToEvents(forT7, verification("T7", 5), flight(R7));
    expect(nextAwaitingReceipt(R7, forT7, marker)).toBeNull();
  });

  it("10, 11: a late refusal for D1/T7 itself never releases it", async () => {
    const { marker, state } = await diverge();
    const refusals = ["stale_base", "too_large", "not_found", "invalid_document"] as const;
    for (const status of refusals) {
      const late = { status } as DrainOutcome;
      const kept = nextAwaitingReceipt(R7, late, marker);
      expect(kept, status).toBe(marker);
      expect(isDiverged(kept), status).toBe(true);
      expect(planDrain(QUEUE, meta(state), kept).send, status).toBeNull();
      expect(reduce(state, await outcomeToEvents(late, verification("T7", 0), flight(R7))), status).toBe(
        "RECOVERY_REQUIRED",
      );
    }
    // Its own verified receipt still releases it afterwards.
    const forT7 = signedDuplicate(5);
    await outcomeToEvents(forT7, verification("T7", 5), flight(R7));
    expect(nextAwaitingReceipt(R7, forT7, marker)).toBeNull();
  });

  it("a late txid_reused for r8 while r7 is held marks the hold, so the state survives a restart", async () => {
    const lateForR8 = await outcomeToEvents(REUSED, verification("T8", 0), flight(R8));
    expect(lateForR8).toEqual([{ type: "SYNC_KEY_DIVERGED" }]);
    const state = reduce(reduce("LOCAL_DURABLE", [{ type: "SYNC_STARTED" }]), lateForR8);
    expect(state).toBe("RECOVERY_REQUIRED");

    const marker = nextAwaitingReceipt(R8, REUSED, HELD_R7);
    expect(marker).toEqual({ ...HELD_R7, diverged: "txid_reused" });
    expect(planDrain(QUEUE, meta(state), marker).send).toBeNull();

    // After a restart the marker alone brings the state back.
    const reloaded = JSON.parse(JSON.stringify(marker)) as AwaitingReceipt;
    expect(isDiverged(reloaded)).toBe(true);
    expect(planDrain(QUEUE, meta("LOCAL_DURABLE"), reloaded).send).toBeNull();

    // An already diverged hold is kept as it is.
    expect(nextAwaitingReceipt(R8, REUSED, marker)).toBe(marker);
  });

  it("12: the cause is recorded, the content is not", async () => {
    const { marker } = await diverge();
    expect(Object.keys(marker!).sort()).toEqual([
      "clientTransactionId",
      "diverged",
      "documentId",
      "localSeq",
    ]);
    expect(marker!.diverged).toBe("txid_reused");
    expect(JSON.stringify(marker)).not.toMatch(/Uvod/);
  });

  it("14: a restart mid-exit keeps the hold diverged and the state escalates again", async () => {
    const { marker } = await diverge();
    const reloaded = JSON.parse(JSON.stringify(marker)) as AwaitingReceipt;
    expect(isDiverged(reloaded)).toBe(true);
    expect(planDrain(QUEUE, meta("ERROR"), reloaded).send).toBeNull();
    // meta was written before the escalation: the runner dispatches it again.
    expect(syncReducer("ERROR", { type: "SYNC_KEY_DIVERGED" })).toBe("RECOVERY_REQUIRED");
    expect(syncReducer("LOCAL_DURABLE", { type: "SYNC_KEY_DIVERGED" })).toBe("RECOVERY_REQUIRED");
    // A tampered cause is not a valid hold, and an invalid hold sends nothing.
    const tampered = { ...reloaded, diverged: "other" } as unknown as AwaitingReceipt;
    expect(isDiverged(tampered)).toBe(false);
    expect(planDrain(QUEUE, meta("LOCAL_DURABLE"), tampered).send).toBeNull();
  });
});

describe("held txid_reused — the author's decision (DAN-135)", () => {
  it("13: server unavailable blocks adopt, salvage stays and sends nothing until revalidated", () => {
    const plan = planRecovery({
      journalReadable: true,
      snapshot: null,
      pendingNewest: { document: R9.tx.document, revision: R9.tx.baseRevision, at: R9.queuedAt },
      serverDocument: null,
      serverRevision: null,
    });
    expect(plan.canAdoptServer).toBe(false);
    expect(plan.options.find((o) => o.choice === "adopt-server")?.blockedBy).toBe(
      "server-unavailable",
    );
    expect(plan.canSalvageLocal).toBe(true);
    expect(plan.salvage?.nextBaseRevision).toBeNull();
  });

  it("owner decision 3: adopting the server's version over newer local rows needs explicit confirmation", async () => {
    const { marker, state } = await diverge();
    expect(adoptDiscardsNewerRows(QUEUE, D1, marker)).toBe(true);

    // No confirmation, or anything that is not `true`: no event, no transition.
    expect(adoptServerEvents(QUEUE, D1, marker, false)).toEqual([]);
    expect(adoptServerEvents(QUEUE, D1, marker, "yes" as unknown as boolean)).toEqual([]);
    expect(reduce(state, adoptServerEvents(QUEUE, D1, marker, false))).toBe("RECOVERY_REQUIRED");

    expect(reduce(state, adoptServerEvents(QUEUE, D1, marker, true))).toBe("SYNCED");
  });

  it("owner decision 3: only r7 queued, nothing newer is lost, adopt needs no extra confirmation", async () => {
    const { marker } = await diverge();
    expect(adoptDiscardsNewerRows([R7], D1, marker)).toBe(false);
    // D2's rows are not D1's and do not count.
    expect(adoptDiscardsNewerRows([R7, D2_R3], D1, marker)).toBe(false);
    expect(adoptServerEvents([R7, D2_R3], D1, marker, false)).toEqual([
      { type: "RECOVERED", via: "adopt-server" },
    ]);
    // Without a hold every queued row of the document is newer than the server.
    expect(adoptDiscardsNewerRows([R7], D1, null)).toBe(true);
  });

  it("16: the label stays the existing \"Potreban oporavak\"", () => {
    expect(SYNC_STATE_LABELS.RECOVERY_REQUIRED).toEqual({
      label: "Potreban oporavak",
      tone: "error",
    });
    expect(chipContent("RECOVERY_REQUIRED").text).toBe("Potreban oporavak");
  });
});
