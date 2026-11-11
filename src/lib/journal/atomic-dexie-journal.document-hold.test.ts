// @vitest-environment node
import { indexedDB } from "fake-indexeddb";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { emptyDocument, type DocumentTransaction } from "@/domain/document";
import type { BuiltSegment } from "@/editor/capture";
import {
  answer, capture, committed, DOC, deps, journalKit, R0, raw, save, UTC, type Chain,
} from "@/lib/sync/evidence-test-kit";

import { AtomicDexieJournal, JournalError } from "./atomic-dexie-journal";

/**
 * DAN-699 (#1876, contract #1836 c.6786016677): `peekDocumentHold` tells the
 * submission whether this device holds text of one document the server does
 * not have. It reads like `peekLogoutHold`, never creates the database, and
 * agrees with it on every fixture. Every id and text is invented.
 */

const OTHER = "33333333-3333-4333-8333-333333333333";
let chain: Chain;
let SEG: BuiltSegment[];
beforeAll(async () => {
  chain = await capture(3);
  SEG = chain.segments;
}, 60_000);

const { open, nextScope, cleanup } = journalKit("4");
afterEach(cleanup);

const held = (scope: string, documentId = DOC) => AtomicDexieJournal.peekDocumentHold(scope, documentId, deps);
const scopeOf = (journal: AtomicDexieJournal) => raw(journal).name.slice("ductus-journal-v1-".length);

function tx(id: string): DocumentTransaction {
  return {
    kind: "REPLACE_DOCUMENT", clientTransactionId: id, baseRevision: 0, createdAt: UTC,
    document: emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000001"),
  };
}

async function started(): Promise<AtomicDexieJournal> {
  const journal = open();
  await journal.startEvidence(DOC, chain.opened, UTC);
  return journal;
}

describe("DAN-699: peekDocumentHold", () => {
  it("an opened work never saved over holds nothing; a saved step holds until the receipt", async () => {
    const journal = await started();
    expect(await held(scopeOf(journal))).toBe(false);
    await save(journal, SEG[0]!);
    expect(await held(scopeOf(journal))).toBe(true);
    await answer(journal, committed(R0 + 1));
    expect((await journal.readEvidence(DOC)).meta?.state).toBe("SYNCED");
    expect(await held(scopeOf(journal))).toBe(false);
  });

  it("a stopped recorder holds the work for good, also once every queued row is confirmed (#1876)", async () => {
    const journal = await started();
    for (const built of SEG.slice(0, 2)) await save(journal, built);
    const later = (await journal.readEvidence(DOC)).snapshot!.document;
    await journal.saveUncovered(DOC, later, "gap", UTC, 2);
    await answer(journal, committed(R0 + 1));
    await answer(journal, committed(R0 + 2));
    const stored = await journal.readEvidence(DOC);
    expect(stored.pending).toEqual([]);
    expect(stored.meta?.state).toBe("LOCAL_DURABLE");
    expect(await held(scopeOf(journal))).toBe(true);
  });

  it("reads only its own document: another work's owed rows do not hold this one", async () => {
    const journal = await started();
    await journal.saveLocal(OTHER, tx("drugi"), UTC, 0);
    expect(await held(scopeOf(journal), DOC)).toBe(false);
    expect(await held(scopeOf(journal), OTHER)).toBe(true);
  });

  it("a snapshot without a record, or a record without a snapshot, holds the work", async () => {
    const journal = await started();
    await raw(journal).table("meta").delete(DOC);
    expect(await held(scopeOf(journal))).toBe(true);
    const second = await started();
    await raw(second).table("snapshots").delete(DOC);
    expect(await held(scopeOf(second))).toBe(true);
  });

  it("a kept copy does not hold the submission: the author chose the server's text", async () => {
    const journal = await started();
    await raw(journal).table("salvage").add({ documentId: DOC, savedAt: UTC });
    expect(await held(scopeOf(journal))).toBe(false);
    expect((await AtomicDexieJournal.peekLogoutHold(scopeOf(journal), deps)).kept).toBe(true);
  });

  it("a fenced journal holds nothing, as for the sign-out", async () => {
    const journal = await started();
    await save(journal, SEG[0]!);
    await raw(journal).table("control").put({ key: "logout", state: "closing" });
    expect(await held(scopeOf(journal))).toBe(false);
  });

  it("finds nothing where no journal exists, and does not create one", async () => {
    const scope = nextScope();
    expect(await held(scope)).toBe(false);
    expect((await indexedDB.databases()).some((entry) => entry.name === `ductus-journal-v1-${scope}`)).toBe(false);
  });

  it("refuses a scope that is not a digest and an invalid document id", async () => {
    await expect(AtomicDexieJournal.peekDocumentHold("nije-sazetak", DOC, deps)).rejects.toBeInstanceOf(JournalError);
    await expect(AtomicDexieJournal.peekDocumentHold(nextScope(), "  ", deps)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("agrees with peekLogoutHold: the scope keeps work exactly when a document holds or a copy is kept", async () => {
    const journal = await started();
    const scope = scopeOf(journal);
    const agree = async () => {
      const logout = await AtomicDexieJournal.peekLogoutHold(scope, deps);
      const any = (await held(scope, DOC)) || (await held(scope, OTHER));
      expect(logout.kept).toBe(any || logout.copies !== 0);
    };
    await agree();
    await save(journal, SEG[0]!);
    await agree();
    await answer(journal, committed(R0 + 1));
    await agree();
    await journal.saveLocal(OTHER, tx("drugi"), UTC, 0);
    await agree();
    await raw(journal).table("pending").where("documentId").equals(OTHER).delete();
    await agree();
    await raw(journal).table("meta").update(OTHER, { state: "SYNCED" });
    await agree();
  });
});
