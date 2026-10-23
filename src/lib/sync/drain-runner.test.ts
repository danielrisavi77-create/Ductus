// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import Dexie from "dexie";
import { emptyDocument, type DocumentTransaction } from "../../domain/document";
import type { DrainOutcome } from "../../domain/sync/drain";
import { AtomicDexieJournal } from "../journal/atomic-dexie-journal";
import { createDrainRunner, type CommitTransport, type DrainJournal } from "./drain-runner";

/**
 * F-3 step 3b (DAN-49): the drain runner over the real journal, with a fake
 * transport and a fake receipt verifier. Synthetic data only.
 */

const ID = "22222222-2222-4222-8222-222222222222";
const UTC = "2026-10-09T12:00:00.000Z";
const deps = { indexedDB, IDBKeyRange };
let serial = 0;
const instances: AtomicDexieJournal[] = [];
const usedScopes: string[] = [];

function open(scope?: string): AtomicDexieJournal {
  if (scope === undefined) {
    serial += 1;
    // A prefix no other journal test file uses, so the files never share a database.
    scope = `6${serial.toString(16).padStart(63, "0")}`;
  }
  usedScopes.push(scope);
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
async function queue(journal: AtomicDexieJournal, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    const seq = (await journal.read(ID)).meta?.localSeq ?? 0;
    await journal.saveLocal(ID, tx(key), UTC, seq);
  }
}
function signed(revision: number): DrainOutcome {
  return { status: "committed", revision, receipt: { status: "signed", signedReceipt: { testReceipt: revision } } };
}
/** Answers each send with the next scripted outcome and records what was sent. */
function scripted(...answers: (DrainOutcome | Error | ((sent: DocumentTransaction) => Promise<DrainOutcome>))[]) {
  const sent: DocumentTransaction[] = [];
  const transport: CommitTransport = async (documentId, transaction) => {
    expect(documentId).toBe(ID);
    sent.push(transaction);
    const next = answers.shift();
    if (next === undefined) throw new Error("unexpected send");
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next(transaction) : next;
  };
  return { sent, transport };
}
const trusted = async () => true;

afterEach(async () => {
  for (const journal of instances.splice(0)) journal.close();
  for (const scope of new Set(usedScopes.splice(0))) {
    await new Dexie(`ductus-journal-v1-${scope}`, deps).delete();
  }
});

describe("F-3 3b: drain runner", () => {
  it("a verified receipt for the only row ends in SYNCED with an empty queue", async () => {
    const journal = open();
    await queue(journal, "tx-1");
    const { sent, transport } = scripted(async () => {
      // The hold is durable before the request leaves.
      expect((await journal.read(ID)).meta).toMatchObject({ state: "SYNCING", awaitingReceipt: { localSeq: 1 } });
      return signed(3);
    });
    const runner = createDrainRunner({ journal, transport, verify: trusted });
    expect(await runner.step(ID)).toEqual({ kind: "sent", state: "SYNCED", ackedRevision: 3 });
    const stored = await journal.read(ID);
    expect(stored.pending).toEqual([]);
    expect(stored.snapshot?.revision).toBe(3);
    expect(sent.map((row) => row.clientTransactionId)).toEqual(["tx-1"]);
    expect(await runner.step(ID)).toEqual({ kind: "idle" });
  });

  it("a receipt that fails verification never reaches SYNCED and keeps the row held", async () => {
    const journal = open();
    await queue(journal, "tx-1");
    let clock = 0;
    const { transport } = scripted(signed(3), signed(3));
    const runner = createDrainRunner({ journal, transport, verify: async () => false, now: () => clock, jitter: () => 0.5 });
    expect(await runner.step(ID)).toMatchObject({ kind: "sent", state: "ERROR", ackedRevision: null });
    expect((await journal.read(ID)).meta).toMatchObject({ state: "ERROR", awaitingReceipt: { localSeq: 1 } });
    // Only a manual retry repeats it, and only once the schedule allows.
    expect((await runner.step(ID)).kind).toBe("waiting");
    clock = 60_000;
    expect(await runner.step(ID)).toEqual({ kind: "needs_retry", state: "ERROR" });
    expect(await runner.step(ID, { manual: true })).toMatchObject({ kind: "sent", state: "ERROR" });
  });

  it("a local save after a fatal answer does not lift the manual block on the held row", async () => {
    const journal = open();
    await queue(journal, "tx-1");
    let clock = 0;
    const { sent, transport } = scripted(signed(1), signed(1));
    let receiptsTrusted = false;
    const runner = createDrainRunner({
      journal, transport, verify: async () => receiptsTrusted, now: () => clock, jitter: () => 0.5,
    });
    expect(await runner.step(ID)).toMatchObject({ kind: "sent", state: "ERROR" });
    // The author keeps typing: the journal says LOCAL_DURABLE, tx-1 stays held.
    await queue(journal, "tx-2");
    expect((await journal.read(ID)).meta).toMatchObject({ state: "LOCAL_DURABLE", awaitingReceipt: { localSeq: 1 } });
    clock = 60_000;
    expect(await runner.step(ID)).toEqual({ kind: "needs_retry", state: "LOCAL_DURABLE" });
    expect(sent).toHaveLength(1);
    receiptsTrusted = true;
    expect(await runner.step(ID, { manual: true })).toMatchObject({ kind: "sent", ackedRevision: 1 });
    expect(sent.map((row) => row.clientTransactionId)).toEqual(["tx-1", "tx-1"]);
  });

  it("a lost answer replays the same key after the backoff, never a newer row", async () => {
    const journal = open();
    await queue(journal, "tx-1");
    let clock = 0;
    const { sent, transport } = scripted(new Error("offline"), signed(1), signed(2));
    const runner = createDrainRunner({ journal, transport, verify: trusted, now: () => clock, jitter: () => 0.5 });
    expect(await runner.step(ID)).toMatchObject({ kind: "sent", state: "ERROR" });
    await queue(journal, "tx-2");
    expect((await runner.step(ID)).kind).toBe("waiting");
    clock = 60_000;
    // Retryable, so no manual step is needed.
    expect(await runner.step(ID)).toMatchObject({ kind: "sent", state: "SYNCING", ackedRevision: 1 });
    expect(await runner.step(ID)).toMatchObject({ kind: "sent", state: "SYNCED", ackedRevision: 2 });
    expect(sent.map((row) => row.clientTransactionId)).toEqual(["tx-1", "tx-1", "tx-2"]);
  });

  it("an ack with a newer row queued moves the base, withholds SYNCED and sends the next row on it", async () => {
    const journal = open();
    await queue(journal, "tx-1");
    const { sent, transport } = scripted(async () => {
      // Written while tx-1 is in flight, on the base the editor loaded (0).
      await journal.saveLocal(ID, tx("tx-2"), UTC, 1);
      return signed(4);
    }, signed(5));
    const runner = createDrainRunner({ journal, transport, verify: trusted });
    expect(await runner.step(ID)).toMatchObject({ kind: "sent", ackedRevision: 4 });
    expect((await journal.read(ID)).meta?.state).not.toBe("SYNCED");
    expect(await runner.step(ID)).toEqual({ kind: "sent", state: "SYNCED", ackedRevision: 5 });
    // The second row is fast-forwarded onto our own ack, never sent on 0.
    expect(sent.map((row) => [row.clientTransactionId, row.baseRevision])).toEqual([["tx-1", 0], ["tx-2", 4]]);
  });

  it("older rows behind the newest one are superseded and never sent", async () => {
    const journal = open();
    await queue(journal, "tx-1", "tx-2");
    const { sent, transport } = scripted(signed(4));
    const runner = createDrainRunner({ journal, transport, verify: trusted });
    expect(await runner.step(ID)).toEqual({ kind: "sent", state: "SYNCED", ackedRevision: 4 });
    expect(sent.map((row) => row.clientTransactionId)).toEqual(["tx-2"]);
    expect((await journal.read(ID)).pending).toEqual([]);
  });

  it("a local save during the flight keeps the new row owed and the state off SYNCED", async () => {
    const journal = open();
    await queue(journal, "tx-1");
    const { transport } = scripted(async () => {
      await journal.saveLocal(ID, tx("tx-2"), UTC, 1);
      return signed(2);
    });
    const runner = createDrainRunner({ journal, transport, verify: trusted });
    const result = await runner.step(ID);
    expect(result).toMatchObject({ kind: "sent", ackedRevision: 2 });
    expect(result).not.toMatchObject({ state: "SYNCED" });
    const stored = await journal.read(ID);
    expect(stored.pending.map((row) => row.tx.clientTransactionId)).toEqual(["tx-2"]);
    expect(stored.meta?.state).not.toBe("SYNCED");
  });

  it("a local save between the answer's read and its write is not swallowed by SYNCED", async () => {
    const journal = open();
    await queue(journal, "tx-1");
    const racing: DrainJournal = {
      read: (id) => journal.read(id),
      beginSend: (id, row) => journal.beginSend(id, row),
      async recordAnswer(id, row, outcome, state) {
        if (state === "SYNCED") await journal.saveLocal(ID, tx("tx-2"), UTC, 1);
        return journal.recordAnswer(id, row, outcome, state);
      },
    };
    const { transport } = scripted(signed(2));
    const result = await createDrainRunner({ journal: racing, transport, verify: trusted }).step(ID);
    expect(result).toEqual({ kind: "sent", state: "LOCAL_DURABLE", ackedRevision: 2 });
    expect((await journal.read(ID)).pending.map((row) => row.tx.clientTransactionId)).toEqual(["tx-2"]);
  });

  it("after a reload mid-flight the held row goes out again before any newer one", async () => {
    const scope = `6${"f".repeat(63)}`;
    const first = open(scope);
    await queue(first, "tx-1", "tx-2");
    await first.beginSend(ID, (await first.read(ID)).pending[0]!);
    first.close();
    const journal = open(scope);
    const { sent, transport } = scripted({ status: "duplicate", revision: 1, receipt: { status: "pending_signature" } });
    const result = await createDrainRunner({ journal, transport, verify: trusted }).step(ID);
    expect(result).toMatchObject({ kind: "sent", state: "SYNCING", ackedRevision: null });
    expect(sent.map((row) => row.clientTransactionId)).toEqual(["tx-1"]);
    expect((await journal.read(ID)).meta?.awaitingReceipt).toMatchObject({ localSeq: 1 });
  });

  it("stale_base and txid_reused stop the drain until the author decides", async () => {
    const conflict = open();
    await queue(conflict, "tx-1");
    const stale = scripted({ status: "stale_base", currentRevision: 9 });
    const runner = createDrainRunner({ journal: conflict, transport: stale.transport, verify: trusted });
    expect(await runner.step(ID)).toMatchObject({ kind: "sent", state: "CONFLICT" });
    expect(await runner.step(ID)).toEqual({ kind: "stalled", state: "CONFLICT" });
    expect(stale.sent).toHaveLength(1);

    const diverged = open();
    await queue(diverged, "tx-1");
    const reused = scripted({ status: "txid_reused" });
    const recovery = createDrainRunner({ journal: diverged, transport: reused.transport, verify: trusted });
    expect(await recovery.step(ID)).toMatchObject({ kind: "sent", state: "RECOVERY_REQUIRED" });
    expect(await recovery.step(ID, { manual: true })).toEqual({ kind: "stalled", state: "RECOVERY_REQUIRED" });
    expect(reused.sent).toHaveLength(1);
  });

  it("a fatal answer waits for a manual retry; a fresh runner after reload tries once by itself", async () => {
    const scope = `6${"e".repeat(63)}`;
    const journal = open(scope);
    await queue(journal, "tx-1");
    const { sent, transport } = scripted({ status: "too_large" }, { status: "too_large" }, signed(1));
    const runner = createDrainRunner({ journal, transport, verify: trusted });
    expect(await runner.step(ID)).toMatchObject({ kind: "sent", state: "ERROR" });
    expect(await runner.step(ID)).toEqual({ kind: "needs_retry", state: "ERROR" });

    const reloaded = createDrainRunner({ journal, transport, verify: trusted });
    expect(await reloaded.step(ID)).toMatchObject({ kind: "sent", state: "ERROR" });
    expect(await reloaded.step(ID)).toEqual({ kind: "needs_retry", state: "ERROR" });
    expect(await reloaded.step(ID, { manual: true })).toMatchObject({ kind: "sent", state: "SYNCED" });
    expect(sent).toHaveLength(3);
  });

  it("two steps for one document never overlap", async () => {
    const journal = open();
    await queue(journal, "tx-1");
    let release: (outcome: DrainOutcome) => void = () => {};
    const { sent, transport } = scripted(() => new Promise((resolve) => { release = resolve; }));
    const runner = createDrainRunner({ journal, transport, verify: trusted });
    const first = runner.step(ID);
    expect(await runner.step(ID)).toEqual({ kind: "busy" });
    while (sent.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    release(signed(1));
    expect(await first).toMatchObject({ kind: "sent", state: "SYNCED" });
    expect(sent).toHaveLength(1);
  });
});
