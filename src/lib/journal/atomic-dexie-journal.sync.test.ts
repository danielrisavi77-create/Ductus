// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import Dexie from "dexie";
import { emptyDocument, type DocumentTransaction } from "../../domain/document";
import {
  outcomeToEvents, planDrain, type CommitReceiptVerification, type DrainOutcome,
} from "../../domain/sync/drain";
import type { PendingTransaction } from "../../domain/sync/journal-types";
import { AtomicDexieJournal, JournalError } from "./atomic-dexie-journal";

/**
 * F-3 step 3a (DAN-49): send bookkeeping. SYNCED is written only together
 * with deleting the acknowledged rows, and only for a receipt that
 * `outcomeToEvents` verified. Synthetic data only.
 */

const ID = "11111111-1111-4111-8111-111111111111";
const UTC = "2026-10-09T12:00:00.000Z";
const deps = { indexedDB, IDBKeyRange };
let serial = 0;
const instances: AtomicDexieJournal[] = [];
const usedScopes: string[] = [];

function freshScope(): string {
  serial += 1;
  // A different prefix from atomic-dexie-journal.test.ts, so the files never share a database.
  const scope = `5${serial.toString(16).padStart(63, "0")}`;
  usedScopes.push(scope);
  return scope;
}
function open(scope = freshScope()): AtomicDexieJournal {
  const journal = new AtomicDexieJournal(scope, deps);
  instances.push(journal);
  return journal;
}
function tx(key: string, baseRevision = 0): DocumentTransaction {
  return {
    kind: "REPLACE_DOCUMENT", clientTransactionId: key, baseRevision,
    document: emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000001"),
    createdAt: UTC,
  };
}
function signed(revision: number): DrainOutcome {
  return { status: "committed", revision, receipt: { status: "signed", signedReceipt: { testReceipt: true } } };
}
function verification(sent: PendingTransaction, revision: number, valid = true): CommitReceiptVerification {
  return {
    expected: { documentId: ID, clientTransactionId: sent.tx.clientTransactionId, revision },
    verify: async () => valid,
  };
}
/** Saves `count` rows and returns them as the journal holds them. */
async function queued(journal: AtomicDexieJournal, count: number): Promise<PendingTransaction[]> {
  for (let seq = 0; seq < count; seq += 1) await journal.saveLocal(ID, tx(`tx-${seq + 1}`), UTC, seq);
  return (await journal.read(ID)).pending;
}
/** What the runner does with an answer: verify against the queue of now, then record. */
async function answer(
  journal: AtomicDexieJournal, sent: PendingTransaction, outcome: DrainOutcome,
  check: CommitReceiptVerification, state: Parameters<AtomicDexieJournal["recordAnswer"]>[3],
) {
  await outcomeToEvents(outcome, check, { sent, pending: (await journal.read(ID)).pending });
  return journal.recordAnswer(ID, sent, outcome, state);
}
async function rejection(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(JournalError);
  return (error as JournalError).code;
}

afterEach(async () => {
  for (const journal of instances.splice(0)) journal.close();
  for (const scope of new Set(usedScopes.splice(0))) {
    await new Dexie(`ductus-journal-v1-${scope}`, deps).delete();
  }
});

describe("F-3 3a: beginSend", () => {
  it("writes the marker and SYNCING before the request leaves, and a reload replays that row", async () => {
    const scope = freshScope();
    const journal = open(scope);
    const [first] = await queued(journal, 1);
    const meta = await journal.beginSend(ID, first!);
    expect(meta).toMatchObject({ state: "SYNCING", awaitingReceipt: { localSeq: 1, clientTransactionId: "tx-1" } });
    await journal.saveLocal(ID, tx("tx-2"), UTC, 1);
    journal.close();

    const reopened = await open(scope).read(ID);
    expect(reopened.meta?.awaitingReceipt).toEqual({ documentId: ID, localSeq: 1, clientTransactionId: "tx-1" });
    expect(planDrain(reopened.pending, reopened.meta, reopened.meta?.awaitingReceipt).send?.localSeq).toBe(1);
  });

  it("refuses a row that is not queued, a hold on another row and a diverged hold", async () => {
    const journal = open();
    const [first, second] = await queued(journal, 2);
    expect(await rejection(journal.beginSend(ID, { ...first!, tx: tx("tx-x") }))).toBe("not_queued");
    await journal.beginSend(ID, first!);
    expect(await rejection(journal.beginSend(ID, second!))).toBe("held_elsewhere");

    await answer(journal, first!, { status: "txid_reused" }, verification(first!, 1), "RECOVERY_REQUIRED");
    expect((await journal.read(ID)).meta?.awaitingReceipt?.diverged).toBe("txid_reused");
    expect(await rejection(journal.beginSend(ID, first!))).toBe("sticky_state");
  });

  it("rejects input that does not name a row of this document", async () => {
    const journal = open();
    const [first] = await queued(journal, 1);
    expect(await rejection(journal.beginSend(ID, { ...first!, documentId: "other" }))).toBe("invalid_input");
    expect(await rejection(journal.beginSend(ID, { ...first!, localSeq: 0 }))).toBe("invalid_input");
  });
});

describe("F-3 3a: recordAnswer", () => {
  it("a verified receipt deletes the row, moves the base and allows SYNCED", async () => {
    const journal = open();
    const [first] = await queued(journal, 1);
    await journal.beginSend(ID, first!);
    const result = await answer(journal, first!, signed(4), verification(first!, 4), "SYNCED");
    expect(result).toMatchObject({ ackedRevision: 4, pending: [], meta: { state: "SYNCED" } });
    const stored = await journal.read(ID);
    expect(stored.pending).toEqual([]);
    expect(stored.snapshot?.revision).toBe(4);
    expect(stored.meta).not.toHaveProperty("awaitingReceipt");
  });

  it("SYNCED is refused without a verified receipt, and nothing is deleted", async () => {
    const journal = open();
    const [first] = await queued(journal, 1);
    await journal.beginSend(ID, first!);
    // A signed outcome never passed through outcomeToEvents vouches for nothing.
    expect(await rejection(journal.recordAnswer(ID, first!, signed(4), "SYNCED"))).toBe("unconfirmed_sync");
    // A receipt that fails verification.
    expect(await rejection(answer(journal, first!, signed(4), verification(first!, 4, false), "SYNCED")))
      .toBe("unconfirmed_sync");
    // A receipt still waiting for its signature.
    const pendingSignature: DrainOutcome = { status: "committed", revision: 4, receipt: { status: "pending_signature" } };
    expect(await rejection(answer(journal, first!, pendingSignature, verification(first!, 4), "SYNCED")))
      .toBe("unconfirmed_sync");
    const stored = await journal.read(ID);
    expect(stored.pending).toHaveLength(1);
    expect(stored.snapshot?.revision).toBe(0);
    expect(stored.meta).toMatchObject({ state: "SYNCING", awaitingReceipt: { localSeq: 1 } });
  });

  it("pending signature keeps the hold and the row", async () => {
    const journal = open();
    const [first] = await queued(journal, 1);
    await journal.beginSend(ID, first!);
    const outcome: DrainOutcome = { status: "duplicate", revision: 4, receipt: { status: "pending_signature" } };
    const result = await answer(journal, first!, outcome, verification(first!, 4), null);
    expect(result).toMatchObject({ ackedRevision: null, meta: { state: "SYNCING", awaitingReceipt: { localSeq: 1 } } });
    expect(result.pending).toHaveLength(1);
  });

  it("with newer rows queued the prefix goes, the hold is released and SYNCED is refused", async () => {
    const journal = open();
    const [first] = await queued(journal, 3);
    await journal.beginSend(ID, first!);
    expect(await rejection(answer(journal, first!, signed(5), verification(first!, 5), "SYNCED")))
      .toBe("unconfirmed_sync");
    const result = await answer(journal, first!, signed(5), verification(first!, 5), "SYNCING");
    expect(result.pending.map((row) => row.localSeq)).toEqual([2, 3]);
    expect(result.meta).not.toHaveProperty("awaitingReceipt");
    expect((await journal.read(ID)).snapshot?.revision).toBe(5);
  });

  it("a late answer for a settled row neither deletes, releases nor moves the base back", async () => {
    const journal = open();
    const [first, second] = await queued(journal, 2);
    await journal.beginSend(ID, first!);
    await answer(journal, first!, signed(5), verification(first!, 5), null);
    await journal.beginSend(ID, second!);
    const late = await answer(journal, first!, signed(3), verification(first!, 3), null);
    expect(late.ackedRevision).toBeNull();
    expect(late.pending.map((row) => row.localSeq)).toEqual([2]);
    expect(late.meta.awaitingReceipt).toMatchObject({ localSeq: 2 });
    expect((await journal.read(ID)).snapshot?.revision).toBe(5);
  });

  it("a later local save keeps the acknowledged base instead of the editor's older one", async () => {
    const journal = open();
    const [first] = await queued(journal, 1);
    await journal.beginSend(ID, first!);
    await answer(journal, first!, signed(5), verification(first!, 5), "SYNCED");
    // The editor still holds the base it loaded (0).
    const saved = await journal.saveLocal(ID, tx("tx-2", 0), UTC, 1);
    expect(saved.snapshot.revision).toBe(5);
    expect((await journal.read(ID)).snapshot?.revision).toBe(5);
  });

  it("a verified receipt for a different row deletes nothing", async () => {
    const journal = open();
    const [first, second] = await queued(journal, 2);
    await journal.beginSend(ID, first!);
    const outcome = signed(5);
    await outcomeToEvents(outcome, verification(second!, 5), { sent: second!, pending: [first!, second!] });
    const result = await journal.recordAnswer(ID, first!, outcome, null);
    expect(result.ackedRevision).toBeNull();
    expect(result.pending).toHaveLength(2);
    expect(result.meta.awaitingReceipt).toMatchObject({ localSeq: 1 });
  });

  it("txid_reused marks the hold diverged; a sticky state is never left by an answer", async () => {
    const journal = open();
    const [first] = await queued(journal, 1);
    await journal.beginSend(ID, first!);
    const result = await answer(journal, first!, { status: "txid_reused" }, verification(first!, 1), "RECOVERY_REQUIRED");
    expect(result.meta).toMatchObject({ state: "RECOVERY_REQUIRED", awaitingReceipt: { localSeq: 1, diverged: "txid_reused" } });
    expect(await rejection(journal.recordAnswer(ID, first!, { status: "transport_error" }, "ERROR")))
      .toBe("sticky_state");
    expect(await rejection(journal.saveLocal(ID, tx("tx-2"), UTC, 1))).toBe("sticky_state");
  });

  it("a refusal of the held row releases the hold without deleting it", async () => {
    const journal = open();
    const [first] = await queued(journal, 1);
    await journal.beginSend(ID, first!);
    const result = await answer(journal, first!, { status: "stale_base", currentRevision: 7 }, verification(first!, 7), "CONFLICT");
    expect(result).toMatchObject({ ackedRevision: null, meta: { state: "CONFLICT" } });
    expect(result.meta).not.toHaveProperty("awaitingReceipt");
    expect(result.pending).toHaveLength(1);
  });

  it("refuses editor states and works only behind no logout fence", async () => {
    const journal = open();
    const [first] = await queued(journal, 1);
    expect(await rejection(journal.recordAnswer(ID, first!, signed(1), "EDITING"))).toBe("invalid_input");
    expect(await rejection(journal.recordAnswer(ID, first!, signed(1), "SAVING_LOCAL"))).toBe("invalid_input");
    expect(await rejection(journal.destroyForLogout())).toBe("unsynced_work");
    await answer(journal, first!, signed(1), verification(first!, 1), "SYNCED");
    await journal.destroyForLogout();
    expect(await rejection(journal.beginSend(ID, first!))).toBe("logout_in_progress");
    expect(await rejection(journal.recordAnswer(ID, first!, signed(1), null))).toBe("logout_in_progress");
  });
});
