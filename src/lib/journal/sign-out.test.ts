// @vitest-environment node
/**
 * The journal side of sign-out on /rad (F-5, plan #376 rows 2 to 5, D-118).
 * Sign-out always ends the session; afterwards the page deletes a principal's
 * journal only when the journal agrees. Until F-3 sends anything, a single
 * local change keeps the journal, under that principal's scope alone. All
 * accounts and text here are synthetic.
 */
import { afterEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

import { documentsEqual, newNodeId, paragraphNode, textNode, type CanonicalDocument } from "../../domain/document";
import { principalScope } from "../../server/auth/principal";
import { AtomicDexieJournal, JournalError } from "./atomic-dexie-journal";
import { LocalDocumentSaver } from "./local-document-saver";

const DOC = "local-demo-document";
const P1 = newNodeId(() => "bbbbbbbb-0000-4000-8000-000000000001");
const INSTITUTION = "00000000-0000-4000-8000-0000000000f1";
const SCOPE_A = principalScope("00000000-0000-4000-8000-00000000000a", INSTITUTION);
const SCOPE_B = principalScope("00000000-0000-4000-8000-00000000000b", INSTITUTION);
const idb = { indexedDB, IDBKeyRange };
const opened: AtomicDexieJournal[] = [];

function journal(scope: string): AtomicDexieJournal {
  const instance = new AtomicDexieJournal(scope, idb);
  opened.push(instance);
  return instance;
}
function text(value: string): CanonicalDocument {
  return { schemaVersion: 1, nodes: [paragraphNode(P1, [textNode(value)])] };
}
let txSerial = 0;
function saver(on: AtomicDexieJournal): LocalDocumentSaver {
  return new LocalDocumentSaver(on, DOC, {
    now: () => new Date("2026-10-16T20:00:00.000Z"),
    newTransactionId: () => `tx-sign-out-${(txSerial += 1)}`,
  });
}
async function write(target: LocalDocumentSaver, value: string): Promise<void> {
  target.edit();
  await target.propose(text(value));
  await target.settled();
}
async function refusal(on: AtomicDexieJournal): Promise<string> {
  try {
    await on.destroyForLogout();
    return "none";
  } catch (error) {
    return error instanceof JournalError ? error.code : "other";
  }
}

afterEach(async () => {
  for (const instance of opened.splice(0)) instance.close();
  for (const scope of [SCOPE_A, SCOPE_B]) await new Dexie(`ductus-journal-v1-${scope}`, idb).delete();
});

describe("sign-out of a principal's journal", () => {
  it("row 1: a document opened and never changed is deleted after sign-out", async () => {
    const own = journal(SCOPE_A);
    expect((await saver(own).load()).kind).toBe("ready");
    expect(await refusal(own)).toBe("none");
    expect((await journal(SCOPE_A).read(DOC)).snapshot).toBeNull();
  });

  it("rows 2 and 3: one local change keeps the journal through sign-out, text readable", async () => {
    const own = journal(SCOPE_A);
    const target = saver(own);
    await target.load();
    await write(target, "Nacrt A: plava bilježnica");
    expect(target.snapshot().state).toBe("LOCAL_DURABLE");

    expect(await refusal(own)).toBe("unsynced_work");
    // Refused before any fence: no half-finished logout, writing goes on.
    expect(await own.hasPendingLogout()).toBe(false);
    await write(target, "Nacrt A: plava bilježnica, dopuna");
    expect(target.snapshot().state).toBe("LOCAL_DURABLE");
    // Asking again refuses again: no path deletes unconfirmed work.
    expect(await refusal(journal(SCOPE_A))).toBe("unsynced_work");
    const read = await journal(SCOPE_A).read(DOC);
    expect(documentsEqual(read.snapshot!.document, text("Nacrt A: plava bilježnica, dopuna"))).toBe(true);
  });

  it("row 4: after the tab is gone, a new tab still keeps the stored change from deletion", async () => {
    const crashed = journal(SCOPE_A);
    const target = saver(crashed);
    await target.load();
    await write(target, "Nacrt A: plava bilježnica");
    crashed.close();

    const reopened = journal(SCOPE_A);
    const loaded = await saver(reopened).load();
    expect(loaded.kind).toBe("ready");
    expect(loaded.kind === "ready" && documentsEqual(loaded.document!, text("Nacrt A: plava bilježnica"))).toBe(true);
    expect(await refusal(reopened)).toBe("unsynced_work");
  });

  it("row 5: another principal's journal neither shows nor blocks on the first one's work", async () => {
    const a = saver(journal(SCOPE_A));
    await a.load();
    await write(a, "Nacrt A: plava bilježnica");

    const b = journal(SCOPE_B);
    const loadedB = await saver(b).load();
    expect(loadedB.kind).toBe("ready");
    expect(JSON.stringify(loadedB)).not.toContain("Nacrt A");
    expect(await refusal(b)).toBe("none");
    // B signing out deleted only B's journal.
    expect(await refusal(journal(SCOPE_A))).toBe("unsynced_work");
  });
});
