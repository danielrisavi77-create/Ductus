// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { emptyDocument, type DocumentTransaction } from "../../domain/document";
import { AtomicDexieJournal } from "./atomic-dexie-journal";

const DOC = "11111111-1111-4111-8111-111111111111";
const UTC = "2026-10-10T09:00:00.000Z";
const idb = { indexedDB, IDBKeyRange };
let serial = 1000;
const opened: AtomicDexieJournal[] = [];
const scopes: string[] = [];

function newScope(): string {
  serial += 1;
  const scope = serial.toString(16).padStart(64, "0");
  scopes.push(scope);
  return scope;
}
function open(scope: string): AtomicDexieJournal {
  const journal = new AtomicDexieJournal(scope, idb);
  opened.push(journal);
  return journal;
}
function tx(id: string): DocumentTransaction {
  return {
    kind: "REPLACE_DOCUMENT",
    clientTransactionId: id,
    baseRevision: 0,
    createdAt: UTC,
    document: emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000001"),
  };
}
// Test-only interception of the deletion boundary; production Dexie never
// exposes a plain Promise signature on its public delete() method.
function rawDb(journal: AtomicDexieJournal): { delete: () => Promise<void> } {
  return (journal as unknown as { db: { delete: () => Promise<void> } }).db;
}

afterEach(async () => {
  for (const instance of opened.splice(0)) instance.close();
  for (const scope of new Set(scopes.splice(0))) {
    await new Dexie(`ductus-journal-v1-${scope}`, idb).delete();
  }
});

describe("DAN-92: fail-closed cross-tab logout", () => {
  it("rejects a new write scheduled after logout has passed its clean-check, before deletion", async () => {
    const scope = newScope();
    const owner = open(scope);
    const staleTab = open(scope);
    const db = rawDb(owner);
    const deleteDb = db.delete.bind(db);
    let attempted = false;

    // The injected call models the exact asynchronous gap between the old
    // read-only check and IndexedDB deletion. It never edits production code.
    db.delete = async () => {
      attempted = true;
      await expect(staleTab.saveLocal(DOC, tx("concurrent-save"), UTC, 0))
        .rejects.toMatchObject({ code: "logout_in_progress" });
      return deleteDb();
    };

    await owner.destroyForLogout();
    expect(attempted).toBe(true);
    expect(await open(scope).read(DOC)).toEqual({
      snapshot: null, pending: [], meta: null,
    });
  });

  it("keeps the logout fence if database deletion fails; retry is allowed", async () => {
    const scope = newScope();
    const owner = open(scope);
    const tab = open(scope);
    const db = rawDb(owner);
    const deleteDb = db.delete.bind(db);
    db.delete = async () => { throw new Error("synthetic deletion failure"); };

    await expect(owner.destroyForLogout()).rejects.toThrow("synthetic deletion failure");
    await expect(tab.saveLocal(DOC, tx("late-edit"), UTC, 0))
      .rejects.toMatchObject({ code: "logout_in_progress" });
    db.delete = deleteDb;
    await owner.destroyForLogout();
    expect(await open(scope).read(DOC)).toEqual({ snapshot: null, pending: [], meta: null });
  });

  it("upgrades a populated v1 journal without losing snapshot and pending queue", async () => {
    const scope = newScope();
    const name = `ductus-journal-v1-${scope}`;
    const legacy = new Dexie(name, idb);
    legacy.version(1).stores({
      snapshots: "documentId",
      pending: "[documentId+localSeq],documentId",
      meta: "documentId",
    });
    await legacy.transaction(
      "rw", legacy.table("snapshots"), legacy.table("pending"), legacy.table("meta"),
      async () => {
        await legacy.table("snapshots").put({
          documentId: DOC, revision: 0, document: tx("first").document, savedAt: UTC,
        });
        await legacy.table("pending").put({
          documentId: DOC, localSeq: 1, tx: tx("first"), queuedAt: UTC,
        });
        await legacy.table("meta").put({
          documentId: DOC, localSeq: 1, state: "LOCAL_DURABLE",
        });
      },
    );
    legacy.close();

    const upgraded = open(scope);
    expect((await upgraded.read(DOC)).pending.map((row) => row.localSeq)).toEqual([1]);
    await upgraded.saveLocal(DOC, tx("second"), UTC, 1);
    const rows = await upgraded.read(DOC);
    expect(rows.pending.map((row) => row.localSeq)).toEqual([1, 2]);
    expect(rows.meta?.state).toBe("LOCAL_DURABLE");
  });
});
