// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { emptyDocument, type DocumentTransaction } from "../../domain/document";
import { AtomicDexieJournal } from "./atomic-dexie-journal";

// F-154: what the device holds of one document after its submission goes
// only on the author's explicit action, and only that document's. Every id
// and text is invented.
const A = "11111111-1111-4111-8111-11111111111a";
const B = "11111111-1111-4111-8111-11111111111b";
const UTC = "2026-10-26T09:00:00.000Z";
const idb = { indexedDB, IDBKeyRange };
let serial = 5400;
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
type Raw = {
  salvage: Dexie.Table<Record<string, unknown>, number>;
  timings: Dexie.Table<Record<string, unknown>, string>;
  control: Dexie.Table<Record<string, unknown>, string>;
};
const raw = (journal: AtomicDexieJournal) => (journal as unknown as { db: Raw }).db;

afterEach(async () => {
  for (const instance of opened.splice(0)) instance.close();
  for (const scope of new Set(scopes.splice(0))) {
    await new Dexie(`ductus-journal-v1-${scope}`, idb).delete();
  }
});

describe("F-154: discardAfterSubmission", () => {
  it("deletes only that document's rows, text, meta and step times; other documents and copies stay", async () => {
    const scope = newScope();
    const journal = open(scope);
    await journal.saveLocal(A, tx("a-1"), UTC, 0);
    await journal.saveLocal(A, tx("a-2"), UTC, 1);
    await journal.saveLocal(B, tx("b-1"), UTC, 0);
    await raw(journal).timings.put({ segmentHash: "a".repeat(64), documentId: A });
    await raw(journal).timings.put({ segmentHash: "b".repeat(64), documentId: B });
    await raw(journal).salvage.add({ documentId: A, document: emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000002"), savedAt: UTC });

    await journal.discardAfterSubmission(A);

    expect(await journal.read(A)).toEqual({ snapshot: null, pending: [], meta: null });
    const b = await journal.read(B);
    expect(b.pending.map((row) => row.tx.clientTransactionId)).toEqual(["b-1"]);
    expect(b.snapshot).not.toBeNull();
    expect(await raw(journal).timings.toArray()).toEqual([{ segmentHash: "b".repeat(64), documentId: B }]);
    expect(await journal.readSalvage(A)).toHaveLength(1);
  });

  it("then sign-out deletes the journal when nothing else is held, and refuses while another work is owed", async () => {
    const alone = newScope();
    const only = open(alone);
    await only.saveLocal(A, tx("a-1"), UTC, 0);
    await expect(only.destroyForLogout()).rejects.toMatchObject({ code: "unsynced_work" });
    await only.discardAfterSubmission(A);
    await only.destroyForLogout();
    expect(await AtomicDexieJournal.peekLogoutHold(alone, idb)).toEqual({ pending: 0, copies: 0, kept: false });

    const shared = newScope();
    const both = open(shared);
    await both.saveLocal(A, tx("a-1"), UTC, 0);
    await both.saveLocal(B, tx("b-1"), UTC, 0);
    await both.discardAfterSubmission(A);
    await expect(both.destroyForLogout()).rejects.toMatchObject({ code: "unsynced_work" });
    expect((await both.read(B)).pending).toHaveLength(1);
  });

  it("refuses behind a sign-out fence and for an invalid id, deleting nothing", async () => {
    const scope = newScope();
    const journal = open(scope);
    await journal.saveLocal(A, tx("a-1"), UTC, 0);
    await expect(journal.discardAfterSubmission("")).rejects.toMatchObject({ code: "invalid_input" });
    await raw(journal).control.put({ key: "logout", state: "closing" });
    await expect(journal.discardAfterSubmission(A)).rejects.toMatchObject({ code: "logout_in_progress" });
    await raw(journal).control.delete("logout");
    expect((await journal.read(A)).pending).toHaveLength(1);
  });
});
