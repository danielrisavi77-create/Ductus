// @vitest-environment node
/**
 * Regressions for the QA findings on PR #112 (head a7c3dc6b):
 *   1. a stale tab must not re-create the journal after logout completed;
 *   2. logout must be retryable on the SAME instance after a real
 *      `indexedDB.deleteDatabase` failure (the connection is closed by then);
 *   4. a blocked deletion must reject recognisably instead of hanging.
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
let serial = 5000;
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

afterEach(async () => {
  for (const instance of opened.splice(0)) instance.close();
  for (const scope of new Set(scopes.splice(0))) {
    await new Dexie(dbName(scope), idb).delete();
  }
});

describe("stale tab after a completed logout (QA finding 1)", () => {
  it("cannot save or read, and does not re-create the deleted journal", async () => {
    const scope = newScope();
    const staleTab = open(scope);
    // The stale tab holds an open connection, like an editor that has loaded.
    expect(await staleTab.read(DOC)).toEqual({ snapshot: null, pending: [], meta: null });

    await open(scope).destroyForLogout();
    expect(await exists(scope)).toBe(false);

    await expect(staleTab.saveLocal(DOC, tx("autosave-after-logout"), UTC, 0))
      .rejects.toMatchObject({ code: "logout_in_progress" });
    await expect(staleTab.read(DOC)).rejects.toMatchObject({ code: "logout_in_progress" });
    await expect(staleTab.destroyForLogout())
      .rejects.toMatchObject({ code: "logout_in_progress" });
    expect(await exists(scope)).toBe(false);
  });

  it("the instance that logged out cannot write either, and repeating logout is a no-op", async () => {
    const scope = newScope();
    const owner = open(scope);
    await owner.destroyForLogout();

    await expect(owner.saveLocal(DOC, tx("after-own-logout"), UTC, 0))
      .rejects.toMatchObject({ code: "logout_in_progress" });
    await expect(owner.read(DOC)).rejects.toMatchObject({ code: "logout_in_progress" });
    await expect(owner.destroyForLogout()).resolves.toBeUndefined();
    expect(await exists(scope)).toBe(false);
  });

  it("a save racing a logout from another tab never leaves a record behind a finished logout", async () => {
    for (let round = 0; round < 30; round += 1) {
      const scope = newScope();
      const tabA = open(scope);
      const tabB = open(scope);
      await Promise.all([tabA.read(DOC), tabB.read(DOC)]);

      // Alternate which call is issued first.
      const logoutFirst = round % 2 === 1 ? tabB.destroyForLogout() : null;
      const saving = tabA.saveLocal(DOC, tx(`race-${round}`), UTC, 0);
      const [save, logout] = await Promise.allSettled([
        saving,
        logoutFirst ?? tabB.destroyForLogout(),
      ]);

      if (logout.status === "fulfilled") {
        expect(save.status).toBe("rejected");
        expect(await exists(scope)).toBe(false);
      } else {
        // The save won the serialization: logout must have refused to delete.
        expect(logout.reason).toMatchObject({ code: "unsynced_work" });
        expect(save.status).toBe("fulfilled");
        expect((await open(scope).read(DOC)).pending).toHaveLength(1);
      }
    }
  });
});

describe("logout retry on the same instance (QA finding 2)", () => {
  it("survives a real deleteDatabase failure, keeps the fence, and then deletes", async () => {
    const scope = newScope();
    let failures = 1;
    // Fault injected at the IndexedDB boundary: Dexie really closes the
    // connection before this request is made, as it does in a browser.
    const flaky = {
      IDBKeyRange,
      indexedDB: {
        open: indexedDB.open.bind(indexedDB),
        cmp: indexedDB.cmp.bind(indexedDB),
        databases: indexedDB.databases.bind(indexedDB),
        deleteDatabase(name: string) {
          if (failures === 0) return indexedDB.deleteDatabase(name);
          failures -= 1;
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
    const owner = track(new AtomicDexieJournal(scope, flaky));
    const otherTab = open(scope);
    await otherTab.read(DOC);

    await expect(owner.destroyForLogout()).rejects.toThrow("synthetic deleteDatabase failure");
    expect(await exists(scope)).toBe(true);
    // The fence is durable: neither tab can write while logout is unfinished.
    await expect(otherTab.saveLocal(DOC, tx("late-edit"), UTC, 0))
      .rejects.toMatchObject({ code: "logout_in_progress" });
    await expect(owner.saveLocal(DOC, tx("late-edit-owner"), UTC, 0))
      .rejects.toMatchObject({ code: "logout_in_progress" });

    await expect(owner.destroyForLogout()).resolves.toBeUndefined();
    expect(await exists(scope)).toBe(false);
  });
});

describe("blocked deletion (QA finding 4)", () => {
  it("rejects with logout_blocked instead of hanging, and completes on retry once unblocked", async () => {
    const scope = newScope();
    const journal = track(new AtomicDexieJournal(scope, idb, { logoutBlockedTimeoutMs: 20 }));
    await journal.read(DOC);

    // A raw connection that ignores `versionchange`, like a suspended tab.
    const stubborn = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName(scope));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    try {
      await expect(journal.destroyForLogout()).rejects.toMatchObject({ code: "logout_blocked" });
      // Still blocked: a retry reports the same state rather than hanging.
      await expect(journal.destroyForLogout()).rejects.toMatchObject({ code: "logout_blocked" });
      await expect(journal.saveLocal(DOC, tx("while-blocked"), UTC, 0))
        .rejects.toMatchObject({ code: "logout_in_progress" });
    } finally {
      stubborn.close();
    }

    await expect(journal.destroyForLogout()).resolves.toBeUndefined();
    expect(await exists(scope)).toBe(false);
  });
});
