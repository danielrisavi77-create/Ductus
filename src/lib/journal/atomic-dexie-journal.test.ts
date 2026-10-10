// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import Dexie from "dexie";
import { emptyDocument, type DocumentTransaction } from "../../domain/document";
import { restoreSyncState } from "../../domain/sync/restore";
import { AtomicDexieJournal } from "./atomic-dexie-journal";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const UTC = "2026-10-09T12:00:00.000Z";
const deps = { indexedDB, IDBKeyRange };
let serial = 0;
const instances: AtomicDexieJournal[] = [];
const usedScopes: string[] = [];

function freshScope(): string {
  serial += 1;
  const scope = serial.toString(16).padStart(64, "0");
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
function rawStore(journal: AtomicDexieJournal) {
  return (journal as unknown as { db: { table: (name: string) => {
    put: (value: unknown) => Promise<unknown>;
    hook: (name: "creating", callback: () => void) => void;
  } } }).db;
}

afterEach(async () => {
  for (const journal of instances.splice(0)) journal.close();
  // Test teardown bypasses product logout guards after each isolated fixture.
  for (const scope of new Set(usedScopes.splice(0))) {
    await new Dexie(`ductus-journal-v1-${scope}`, deps).delete();
  }
});

describe("DAN-90: atomic per-principal journal", () => {
  it("writes snapshot, pending, sequence and LOCAL_DURABLE atomically", async () => {
    const journal = open();
    const result = await journal.saveLocal(ID, tx("tx-1", 2), UTC, 0);
    expect(result).toMatchObject({ localSeq: 1, meta: { localSeq: 1, state: "LOCAL_DURABLE" } });
    const stored = await journal.read(ID);
    expect(stored.snapshot).toMatchObject({ documentId: ID, revision: 2, savedAt: UTC });
    expect(stored.pending).toHaveLength(1);
    expect(stored.pending[0]).toMatchObject({
      localSeq: 1, tx: { clientTransactionId: "tx-1", baseRevision: 2 },
    });
    expect(restoreSyncState(stored)).toBe("LOCAL_DURABLE");
    expect(stored.meta?.state).not.toBe("SYNCED");
  });

  it("survives a close/reopen while retaining the owed transaction", async () => {
    const scope = freshScope();
    const first = open(scope);
    await first.saveLocal(ID, tx("tx-1"), UTC, 0);
    first.close();
    const reopened = open(scope);
    const saved = await reopened.read(ID);
    expect(saved.pending.map((row) => row.localSeq)).toEqual([1]);
    expect(saved.meta?.state).toBe("LOCAL_DURABLE");
    expect(saved.snapshot?.document).toEqual(tx("tx-1").document);
  });

  it("serializes concurrent writers without reusing local sequences", async () => {
    const scope = freshScope();
    const first = open(scope);
    const second = open(scope);
    const results = await Promise.allSettled([
      first.saveLocal(ID, tx("tx-1"), UTC, 0),
      second.saveLocal(ID, tx("tx-2"), UTC, 0),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected", reason: { code: "stale_local_sequence" },
    });
    const beforeRetry = await first.read(ID);
    expect(beforeRetry.meta?.localSeq).toBe(1);
    expect(beforeRetry.pending).toHaveLength(1);
    const oldId = beforeRetry.pending[0].tx.clientTransactionId;
    await first.saveLocal(ID, tx(oldId === "tx-1" ? "tx-2" : "tx-1"), UTC, 1);
    const stored = await first.read(ID);
    expect(stored.meta?.localSeq).toBe(2);
    expect(stored.pending.map((row) => row.localSeq)).toEqual([1, 2]);
    expect(stored.pending.map((row) => row.tx.clientTransactionId).sort()).toEqual(["tx-1", "tx-2"]);
    expect(stored.meta?.state).toBe("LOCAL_DURABLE");
  });

  it("rejects stale or unsafe local CAS preconditions without overwriting the snapshot", async () => {
    const journal = open();
    await journal.saveLocal(ID, tx("first"), UTC, 0);
    const prior = await journal.read(ID);
    for (const expected of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(journal.saveLocal(ID, tx("second"), UTC, expected))
        .rejects.toMatchObject({
          code: expected === 0 ? "stale_local_sequence" : "invalid_input",
        });
    }
    expect(await journal.read(ID)).toEqual(prior);
  });

  it("keeps local sequences and reads separated by document ID", async () => {
    const journal = open();
    await journal.saveLocal(ID, tx("first"), UTC, 0);
    await journal.saveLocal(OTHER_ID, tx("other"), UTC, 0);
    await journal.saveLocal(ID, tx("second"), UTC, 1);
    expect((await journal.read(ID)).pending.map((p) => p.localSeq)).toEqual([1, 2]);
    expect((await journal.read(OTHER_ID)).pending.map((p) => p.localSeq)).toEqual([1]);
  });

  it("isolates two signed-in users even for the same document ID", async () => {
    const userA = open();
    const userB = open();
    await userA.saveLocal(ID, tx("user-a", 3), UTC, 0);
    expect(await userB.read(ID)).toEqual({ snapshot: null, pending: [], meta: null });
    await userB.saveLocal(ID, tx("user-b", 0), UTC, 0);
    expect((await userA.read(ID)).snapshot?.revision).toBe(3);
    expect((await userB.read(ID)).snapshot?.revision).toBe(0);
  });

  it("blocks logout instead of discarding unsent student work", async () => {
    const scope = freshScope();
    const journal = open(scope);
    await journal.saveLocal(ID, tx("before-logout"), UTC, 0);
    await expect(journal.destroyForLogout()).rejects.toMatchObject({
      code: "unsynced_work",
    });
    journal.close();
    expect((await open(scope).read(ID)).pending).toHaveLength(1);
  });

  it("allows deletion only for a clean, empty journal scope", async () => {
    const scope = freshScope();
    const journal = open(scope);
    await journal.destroyForLogout();
    expect(await open(scope).read(ID)).toEqual({
      snapshot: null, pending: [], meta: null,
    });
  });

  it("rolls back the snapshot when pending.put fails after the first write", async () => {
    const journal = open();
    rawStore(journal).table("pending").hook("creating", () => {
      throw new Error("synthetic IndexedDB failure");
    });
    await expect(journal.saveLocal(ID, tx("fail"), UTC, 0)).rejects.toThrow();
    expect(await journal.read(ID)).toEqual({ snapshot: null, pending: [], meta: null });
  });

  it("rejects a reused transaction ID without changing the durable state", async () => {
    const journal = open();
    await journal.saveLocal(ID, tx("same-key"), UTC, 0);
    const original = await journal.read(ID);
    await expect(journal.saveLocal(ID, tx("same-key", 5), UTC, 1)).rejects.toMatchObject({
      code: "duplicate_transaction",
    });
    expect(await journal.read(ID)).toEqual(original);
  });

  it("keeps sticky CONFLICT and RECOVERY_REQUIRED until explicit recovery", async () => {
    for (const state of ["CONFLICT", "RECOVERY_REQUIRED"] as const) {
      const journal = open();
      await journal.saveLocal(ID, tx("first"), UTC, 0);
      await rawStore(journal).table("meta").put({ documentId: ID, localSeq: 1, state });
      const original = await journal.read(ID);
      await expect(journal.saveLocal(ID, tx("new"), UTC, 0)).rejects.toMatchObject({
        code: "sticky_state",
      });
      expect(await journal.read(ID)).toEqual(original);
    }
  });

  it("rejects partial legacy state rather than overwriting a snapshot", async () => {
    const journal = open();
    await rawStore(journal).table("snapshots").put({
      documentId: ID, revision: 0, document: tx("legacy").document, savedAt: UTC,
    });
    await expect(journal.saveLocal(ID, tx("new"), UTC, 0)).rejects.toMatchObject({
      code: "incomplete_store",
    });
    expect((await journal.read(ID)).snapshot).not.toBeNull();
    expect((await journal.read(ID)).pending).toHaveLength(0);
  });

  it("rejects invalid documents, timestamps, base revisions and transaction kinds", async () => {
    const journal = open();
    const invalid = [
      tx("", 0),
      tx("fractional", 1.5),
      { ...tx("future"), kind: "FUTURE_KIND" },
      { ...tx("bad-document"), document: { schemaVersion: 1, nodes: [] } },
      { ...tx("bad-time"), createdAt: "2026-02-30T10:00:00.000Z" },
    ];
    for (const candidate of invalid) {
      await expect(journal.saveLocal(ID, candidate as DocumentTransaction, UTC, 0)).rejects.toMatchObject({
        code: "invalid_input",
      });
    }
    await expect(journal.saveLocal(ID, tx("bad-save-time"), "2026-02-30T10:00:00.000Z", 0))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect(await journal.read(ID)).toEqual({ snapshot: null, pending: [], meta: null });
  });

  it("removes unknown transaction fields before persistence", async () => {
    const journal = open();
    const malicious = { ...tx("safe"), secret: "must-not-persist" };
    await journal.saveLocal(ID, malicious, UTC, 0);
    const stored = (await journal.read(ID)).pending[0].tx;
    expect(stored).toEqual(tx("safe"));
    expect("secret" in stored).toBe(false);
  });

  it("refuses to mint localSeq greater than MAX_SAFE_INTEGER", async () => {
    const journal = open();
    await journal.saveLocal(ID, tx("first"), UTC, 0);
    await rawStore(journal).table("meta").put({
      documentId: ID, localSeq: Number.MAX_SAFE_INTEGER, state: "LOCAL_DURABLE",
    });
    await expect(journal.saveLocal(ID, tx("second"), UTC, Number.MAX_SAFE_INTEGER))
      .rejects.toMatchObject({ code: "sequence_exhausted" });
  });

  it("does not put raw account identifiers into IndexedDB database names", () => {
    expect(() => new AtomicDexieJournal("student@example.com", deps))
      .toThrow(/invalid_input/);
    expect(() => new AtomicDexieJournal("plain-username", deps))
      .toThrow(/invalid_input/);
  });
});
