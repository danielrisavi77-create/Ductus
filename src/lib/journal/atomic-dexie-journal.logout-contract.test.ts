// @vitest-environment node
/**
 * Regressions for the review (claude:reviewB) and QA (claude:qa112-2) findings
 * on PR #112 head 662074d2, and for the owner's decision "option A":
 *   - an instance whose connection Dexie closed WITHOUT `versionchange`
 *     (bfcache `pagehide`, `idbdb.onclose`) must not re-create a journal that
 *     was deleted by a logout elsewhere;
 *   - concurrent `destroyForLogout` calls must all settle;
 *   - `hasPendingLogout` reports a leftover logout fence at sign-in.
 * fake-indexeddb only: it has no bfcache and never force-closes a connection,
 * so both are driven through the exact Dexie calls those paths make.
 * All data here is synthetic.
 */
import { afterEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
import { emptyDocument, type DocumentTransaction } from "../../domain/document";
import { AtomicDexieJournal } from "./atomic-dexie-journal";

const DOC = "11111111-1111-4111-8111-111111111111";
const UTC = "2026-10-10T09:00:00.000Z";
const idb = { indexedDB, IDBKeyRange };
const EMPTY = { snapshot: null, pending: [], meta: null };
let serial = 9000;
const opened: AtomicDexieJournal[] = [];
const scopes: string[] = [];

function newScope(): string {
  serial += 1;
  const scope = serial.toString(16).padStart(64, "0");
  scopes.push(scope);
  return scope;
}
function dbName(scope: string): string {
  return `ductus-journal-v1-${scope}`;
}
function track(journal: AtomicDexieJournal): AtomicDexieJournal {
  opened.push(journal);
  return journal;
}
function open(scope: string): AtomicDexieJournal {
  return track(new AtomicDexieJournal(scope, idb));
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
async function exists(scope: string): Promise<boolean> {
  return (await indexedDB.databases()).some((entry) => entry.name === dbName(scope));
}
function rawDb(journal: AtomicDexieJournal): Dexie {
  return (journal as unknown as { db: Dexie }).db;
}
/** What Dexie does on a persisted `pagehide`: close, auto-open stays on. */
function closeLikePagehide(journal: AtomicDexieJournal): void {
  rawDb(journal).close({ disableAutoOpen: false });
}
/** Runs the handler Dexie installs for a connection the browser force-closed. */
function closeLikeBrowser(journal: AtomicDexieJournal): void {
  const backend = rawDb(journal).backendDB() as IDBDatabase;
  backend.onclose?.call(backend, new Event("close"));
}
function stubbornConnection(scope: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName(scope));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
/** A factory whose first `deleteDatabase` calls fail, as in the lifecycle test. */
function flakyDeletion(failures: number) {
  let left = failures;
  return {
    IDBKeyRange,
    indexedDB: {
      open: indexedDB.open.bind(indexedDB),
      cmp: indexedDB.cmp.bind(indexedDB),
      databases: indexedDB.databases.bind(indexedDB),
      deleteDatabase(name: string) {
        if (left === 0) return indexedDB.deleteDatabase(name);
        left -= 1;
        const request: { onerror?: (event: unknown) => void } = {};
        setTimeout(() => request.onerror?.({
          target: { error: new Error("synthetic deleteDatabase failure") },
          preventDefault() {},
          stopPropagation() {},
        }), 0);
        return request;
      },
    } as unknown as IDBFactory,
  };
}

afterEach(async () => {
  for (const instance of opened.splice(0)) instance.close();
  for (const scope of new Set(scopes.splice(0))) {
    await new Dexie(dbName(scope), idb).delete();
  }
});

describe("connection closed without versionchange, then logout elsewhere", () => {
  for (const [label, closeConnection] of [
    ["persisted pagehide (bfcache)", closeLikePagehide],
    ["browser-closed connection (idbdb.onclose)", closeLikeBrowser],
  ] as const) {
    it(`${label}: does not re-create the deleted journal`, async () => {
      const scope = newScope();
      const staleTab = open(scope);
      expect(await staleTab.read(DOC)).toEqual(EMPTY);
      closeConnection(staleTab);

      await open(scope).destroyForLogout();
      expect(await exists(scope)).toBe(false);

      await expect(staleTab.saveLocal(DOC, tx("autosave-after-back"), UTC, 0))
        .rejects.toMatchObject({ code: "logout_in_progress" });
      expect(await exists(scope)).toBe(false);
      await expect(staleTab.read(DOC)).rejects.toMatchObject({ code: "logout_in_progress" });
      await expect(staleTab.hasPendingLogout())
        .rejects.toMatchObject({ code: "logout_in_progress" });
      await expect(staleTab.destroyForLogout())
        .rejects.toMatchObject({ code: "logout_in_progress" });
      expect(await exists(scope)).toBe(false);
    });

    it(`${label}: logout as the first call after return reports the finished logout`, async () => {
      const scope = newScope();
      const staleTab = open(scope);
      await staleTab.read(DOC);
      closeConnection(staleTab);
      await open(scope).destroyForLogout();

      const outcomes = await Promise.allSettled([
        staleTab.destroyForLogout(), staleTab.destroyForLogout(),
      ]);
      for (const outcome of outcomes) {
        expect(outcome.status).toBe("rejected");
        expect((outcome as PromiseRejectedResult).reason).toMatchObject({
          name: "JournalError", code: "logout_in_progress",
        });
      }
      expect(await exists(scope)).toBe(false);
    });

    it(`${label}: keeps working when nobody logged out`, async () => {
      const scope = newScope();
      const tab = open(scope);
      await tab.saveLocal(DOC, tx("before-navigation"), UTC, 0);
      closeConnection(tab);

      const saved = await tab.saveLocal(DOC, tx("after-return"), UTC, 1);
      expect(saved.localSeq).toBe(2);
      expect((await tab.read(DOC)).pending.map((row) => row.localSeq)).toEqual([1, 2]);
    });
  }

  it("a save already waiting for the re-open is rejected, not answered with a raw Dexie error", async () => {
    const scope = newScope();
    const staleTab = open(scope);
    await staleTab.read(DOC);
    closeLikePagehide(staleTab);
    await open(scope).destroyForLogout();

    const [save, read] = await Promise.allSettled([
      staleTab.saveLocal(DOC, tx("first-after-return"), UTC, 0),
      staleTab.read(DOC),
    ]);
    for (const outcome of [save, read]) {
      expect(outcome.status).toBe("rejected");
      expect((outcome as PromiseRejectedResult).reason).toMatchObject({
        name: "JournalError", code: "logout_in_progress",
      });
    }
    expect(await exists(scope)).toBe(false);
  });
});

describe("concurrent destroyForLogout calls", () => {
  it("all report logout_blocked while deletion is blocked, and all finish once unblocked", async () => {
    const scope = newScope();
    const journal = track(new AtomicDexieJournal(scope, idb, { logoutBlockedTimeoutMs: 20 }));
    await journal.read(DOC);
    const stubborn = await stubbornConnection(scope);

    try {
      const calls = [journal.destroyForLogout(), journal.destroyForLogout(), journal.destroyForLogout()];
      const outcomes = await Promise.race([
        Promise.allSettled(calls),
        new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 1_500)),
      ]);
      expect(outcomes).not.toBe("hung");
      for (const outcome of outcomes as PromiseSettledResult<void>[]) {
        expect(outcome.status).toBe("rejected");
        expect((outcome as PromiseRejectedResult).reason).toMatchObject({ code: "logout_blocked" });
      }
    } finally {
      stubborn.close();
    }

    await expect(Promise.all([journal.destroyForLogout(), journal.destroyForLogout()]))
      .resolves.toEqual([undefined, undefined]);
    expect(await exists(scope)).toBe(false);
  });

  it("share one fence-and-delete run when nothing blocks", async () => {
    const scope = newScope();
    const journal = open(scope);
    const db = rawDb(journal);
    const deleteDb = db.delete.bind(db);
    let deletions = 0;
    db.delete = ((...args: Parameters<Dexie["delete"]>) => {
      deletions += 1;
      return deleteDb(...args);
    }) as Dexie["delete"];

    await expect(Promise.all([journal.destroyForLogout(), journal.destroyForLogout()]))
      .resolves.toEqual([undefined, undefined]);
    expect(deletions).toBe(1);
    expect(await exists(scope)).toBe(false);
  });

  it("all refuse when the journal holds unsynced work, and a later logout still works", async () => {
    const scope = newScope();
    const journal = open(scope);
    await journal.saveLocal(DOC, tx("unsynced"), UTC, 0);

    const outcomes = await Promise.allSettled([journal.destroyForLogout(), journal.destroyForLogout()]);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe("rejected");
      expect((outcome as PromiseRejectedResult).reason).toMatchObject({ code: "unsynced_work" });
    }
    // Nothing was fenced or deleted, and the instance is still usable.
    expect(await journal.hasPendingLogout()).toBe(false);
    expect((await journal.read(DOC)).pending).toHaveLength(1);
    await expect(journal.destroyForLogout()).rejects.toMatchObject({ code: "unsynced_work" });
  });
});

describe("hasPendingLogout (owner decision: option A)", () => {
  it("is false for a new journal and for a journal with ordinary work", async () => {
    const scope = newScope();
    const journal = open(scope);
    expect(await journal.hasPendingLogout()).toBe(false);
    await journal.saveLocal(DOC, tx("work"), UTC, 0);
    expect(await journal.hasPendingLogout()).toBe(false);
    expect(await open(scope).hasPendingLogout()).toBe(false);
  });

  it("is false for a version 1 journal, which is upgraded without losing rows", async () => {
    const scope = newScope();
    const legacy = new Dexie(dbName(scope), idb);
    legacy.version(1).stores({
      snapshots: "documentId",
      pending: "[documentId+localSeq],documentId",
      meta: "documentId",
    });
    await legacy.table("snapshots").put({
      documentId: DOC, revision: 0, document: tx("first").document, savedAt: UTC,
    });
    await legacy.table("pending").put({ documentId: DOC, localSeq: 1, tx: tx("first"), queuedAt: UTC });
    await legacy.table("meta").put({ documentId: DOC, localSeq: 1, state: "LOCAL_DURABLE" });
    legacy.close();

    const journal = open(scope);
    expect(await journal.hasPendingLogout()).toBe(false);
    expect((await journal.read(DOC)).pending.map((row) => row.localSeq)).toEqual([1]);
  });

  it("reports an interrupted logout to the same instance and to the next sign-in", async () => {
    const scope = newScope();
    const owner = track(new AtomicDexieJournal(scope, flakyDeletion(1)));
    await expect(owner.destroyForLogout()).rejects.toThrow("synthetic deleteDatabase failure");

    expect(await owner.hasPendingLogout()).toBe(true);
    const nextSignIn = open(scope);
    expect(await nextSignIn.hasPendingLogout()).toBe(true);
    await expect(nextSignIn.saveLocal(DOC, tx("too-early"), UTC, 0))
      .rejects.toMatchObject({ code: "logout_in_progress" });
  });

  it("sign-in contract: finish the leftover logout, then a NEW instance is an empty usable journal", async () => {
    const scope = newScope();
    await expect(track(new AtomicDexieJournal(scope, flakyDeletion(1))).destroyForLogout())
      .rejects.toThrow("synthetic deleteDatabase failure");
    for (const instance of opened.splice(0)) instance.close(); // browser closed

    const atSignIn = open(scope);
    expect(await atSignIn.hasPendingLogout()).toBe(true);
    await atSignIn.destroyForLogout();
    expect(await exists(scope)).toBe(false);
    // The instance that finished the logout is spent.
    await expect(atSignIn.hasPendingLogout()).rejects.toMatchObject({ code: "logout_in_progress" });
    await expect(atSignIn.read(DOC)).rejects.toMatchObject({ code: "logout_in_progress" });

    const fresh = open(scope);
    expect(await fresh.hasPendingLogout()).toBe(false);
    expect(await fresh.read(DOC)).toEqual(EMPTY);
    expect((await fresh.saveLocal(DOC, tx("new-session"), UTC, 0)).localSeq).toBe(1);
  });
});
