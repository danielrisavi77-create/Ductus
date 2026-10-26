// @vitest-environment node
/**
 * D-118 sign-out dialog (#476 c.6396619831 §6 U1 and U2): `peekLogoutHold`
 * reads what a principal's journal holds back from a sign-out, never creates
 * the database, writes nothing, takes no lock, and agrees with
 * `destroyForLogout` on every fixture. All data is synthetic.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { emptyDocument, type DocumentTransaction } from "../../domain/document";
import { AtomicDexieJournal, JournalError } from "./atomic-dexie-journal";

const DOC = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const UTC = "2026-10-25T09:00:00.000Z";
const idb = { indexedDB, IDBKeyRange };
let serial = 0x7700;
const opened: AtomicDexieJournal[] = [];
const scopes: string[] = [];

function newScope(): string {
  serial += 1;
  const scope = serial.toString(16).padStart(64, "0");
  scopes.push(scope);
  return scope;
}
const dbName = (scope: string) => `ductus-journal-v1-${scope}`;
function open(scope: string): AtomicDexieJournal {
  const journal = new AtomicDexieJournal(scope, idb);
  opened.push(journal);
  return journal;
}
function tx(id: string): DocumentTransaction {
  return {
    kind: "REPLACE_DOCUMENT", clientTransactionId: id, baseRevision: 0, createdAt: UTC,
    document: emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000001"),
  };
}
function raw(journal: AtomicDexieJournal): Dexie {
  return (journal as unknown as { db: Dexie }).db;
}
async function exists(scope: string): Promise<boolean> {
  return (await indexedDB.databases()).some((entry) => entry.name === dbName(scope));
}
const peek = (scope: string) => AtomicDexieJournal.peekLogoutHold(scope, idb);

/** Saved locally, then made as the server had confirmed it: no row owed, state SYNCED. */
async function confirmed(journal: AtomicDexieJournal, documentId = DOC): Promise<void> {
  await journal.saveLocal(documentId, tx(`saved-${documentId}`), UTC, 0);
  const db = raw(journal);
  await db.table("pending").where("documentId").equals(documentId).delete();
  await db.table("meta").update(documentId, { state: "SYNCED" });
}

type Fixture = { name: string; build: (journal: AtomicDexieJournal) => Promise<void>; hold: object };

const FIXTURES: Fixture[] = [
  { name: "an opened, empty journal", build: async (j) => { await j.hasPendingLogout(); }, hold: { pending: 0, copies: 0, kept: false } },
  { name: "only confirmed documents", build: (j) => confirmed(j), hold: { pending: 0, copies: 0, kept: false } },
  {
    name: "rows owed",
    build: async (j) => {
      await j.saveLocal(DOC, tx("first"), UTC, 0);
      await j.saveLocal(DOC, tx("second"), UTC, 1);
    },
    hold: { pending: 2, kept: true, copies: 0 },
  },
  {
    name: "rows owed in a second document",
    build: async (j) => {
      await confirmed(j, DOC);
      await j.saveLocal(OTHER, tx("other"), UTC, 0);
    },
    hold: { pending: 1, kept: true, copies: 0 },
  },
  {
    name: "a kept copy",
    build: async (j) => {
      await confirmed(j);
      await raw(j).table("salvage").add({ documentId: DOC, savedAt: UTC });
    },
    hold: { pending: 0, copies: 1, kept: true },
  },
  {
    name: "a stopped record without an owed row",
    build: async (j) => {
      await confirmed(j);
      await raw(j).table("meta").update(DOC, { evidenceStopped: { at: UTC } });
    },
    hold: { pending: 0, copies: 0, kept: true },
  },
  {
    name: "a document saved but not confirmed",
    build: async (j) => {
      await j.saveLocal(DOC, tx("first"), UTC, 0);
      await raw(j).table("pending").clear();
    },
    hold: { pending: 0, copies: 0, kept: true },
  },
  {
    name: "a fenced journal",
    build: async (j) => {
      await confirmed(j);
      await raw(j).table("control").put({ key: "logout", state: "closing" });
    },
    hold: { pending: 0, copies: 0, kept: false },
  },
];

async function dump(scope: string): Promise<unknown> {
  const db = new Dexie(dbName(scope), idb);
  await db.open();
  try {
    const out: Record<string, unknown> = {};
    for (const table of db.tables) out[table.name] = await table.toArray();
    return out;
  } finally {
    db.close();
  }
}

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const journal of opened.splice(0)) journal.close();
  for (const scope of new Set(scopes.splice(0))) await new Dexie(dbName(scope), idb).delete();
});

describe("peekLogoutHold (U1)", () => {
  it("finds nothing where no journal exists, and does not create one", async () => {
    const scope = newScope();
    expect(await peek(scope)).toEqual({ pending: 0, copies: 0, kept: false });
    expect(await exists(scope)).toBe(false);
  });

  it("a journal opened while the read runs on a missing database stays usable", async () => {
    const scope = newScope();
    const read = peek(scope);
    const journal = open(scope);
    const saved = journal.saveLocal(DOC, tx("first"), UTC, 0);
    expect(await read).toEqual({ pending: 0, copies: 0, kept: false });
    await saved;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((raw(journal) as unknown as { deletedElsewhere: boolean }).deletedElsewhere).toBe(false);
    await journal.saveLocal(DOC, tx("second"), UTC, 1);
    expect(await exists(scope)).toBe(true);
    expect(await peek(scope)).toEqual({ pending: 2, copies: 0, kept: true });
  });

  it("refuses a scope that is not a digest", async () => {
    await expect(AtomicDexieJournal.peekLogoutHold("ductus", idb)).rejects.toBeInstanceOf(JournalError);
  });

  it.each(FIXTURES.map((f) => [f.name, f] as const))("%s", async (_name, fixture) => {
    const scope = newScope();
    const journal = open(scope);
    await fixture.build(journal);
    const before = await dump(scope);
    const request = vi.fn();
    vi.stubGlobal("navigator", { locks: { request } });
    expect(await peek(scope)).toEqual(fixture.hold);
    // Nothing written, no lock asked for, and the writing tab carries on.
    expect(await dump(scope)).toEqual(before);
    expect(request).not.toHaveBeenCalled();
  });

  it("reads only its own scope: another person's owed rows are not seen", async () => {
    const mine = newScope();
    const theirs = open(newScope());
    await theirs.saveLocal(DOC, tx("theirs"), UTC, 0);
    expect(await peek(mine)).toEqual({ pending: 0, copies: 0, kept: false });
    expect(await exists(mine)).toBe(false);
  });

  it("reads a version 1 journal without upgrading it", async () => {
    const scope = newScope();
    const legacy = new Dexie(dbName(scope), idb);
    legacy.version(1).stores({ snapshots: "documentId", pending: "[documentId+localSeq],documentId", meta: "documentId" });
    await legacy.table("snapshots").put({ documentId: DOC, revision: 0, document: tx("first").document, savedAt: UTC });
    await legacy.table("pending").put({ documentId: DOC, localSeq: 1, tx: tx("first"), queuedAt: UTC });
    await legacy.table("meta").put({ documentId: DOC, localSeq: 1, state: "LOCAL_DURABLE" });
    const version = legacy.verno;
    legacy.close();
    expect(await peek(scope)).toEqual({ pending: 1, copies: 0, kept: true });
    const after = new Dexie(dbName(scope), idb);
    await after.open();
    expect(after.verno).toBe(version);
    expect(after.tables.map((table) => table.name).sort()).toEqual(["meta", "pending", "snapshots"]);
    after.close();
  });
});

describe("the dialog and the deletion agree (U2)", () => {
  it.each(FIXTURES.map((f) => [f.name, f] as const))("%s", async (_name, fixture) => {
    const scope = newScope();
    const journal = open(scope);
    await fixture.build(journal);
    const hold = await peek(scope);
    const holds = hold.kept || hold.pending > 0 || hold.copies > 0;
    journal.close();
    const outcome = await open(scope).destroyForLogout().then(
      () => "deleted",
      (error: unknown) => (error instanceof JournalError ? error.code : "other"),
    );
    expect(outcome).toBe(holds ? "unsynced_work" : "deleted");
  });
});
