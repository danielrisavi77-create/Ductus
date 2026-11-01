// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { newNodeId, paragraphNode, textNode, type CanonicalDocument, type DocumentTransaction } from "../../domain/document";
import { outcomeToEvents, type CommitReceiptVerification, type DrainOutcome } from "../../domain/sync/drain";
import type { EvidenceOpening, PendingTransaction } from "../../domain/sync/journal-types";
import type { BuiltSegment } from "../../editor/capture";
import {
  capture, DOC, journalKit, json, openedAfter, R0, raw, runnerFor, save, server, UTC, type Chain,
} from "../sync/evidence-test-kit";
import { AtomicDexieJournal, JournalError } from "./atomic-dexie-journal";

/**
 * M0.1 (DAN-376, #1071): journal cases of the core port that had no Ductus
 * test (map: docs/engineering/prijenos-jezgre-M0.1-jednakovrijednost.md).
 * Every id and text here is invented.
 */

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const DECIDED = "2026-10-24T13:00:00.000Z";
const P1 = newNodeId(() => "aaaaaaaa-0000-4000-8000-000000000001");
const kit = journalKit("e");
afterEach(kit.cleanup);

function text(value: string): CanonicalDocument {
  return { schemaVersion: 1, nodes: [paragraphNode(P1, [textNode(value)])] };
}
function tx(key: string, value = "izmišljeni tekst", baseRevision = 0): DocumentTransaction {
  return { kind: "REPLACE_DOCUMENT", clientTransactionId: key, baseRevision, document: text(value), createdAt: UTC };
}
async function queue(journal: AtomicDexieJournal, documentId: string, count: number, value = "tekst") {
  for (let seq = 0; seq < count; seq += 1) {
    await journal.saveLocal(documentId, tx(`${documentId}-tx-${seq + 1}`, `${value} ${seq + 1}`), UTC, seq);
  }
  return (await journal.read(documentId)).pending;
}
function signed(revision: number): DrainOutcome {
  return { status: "committed", revision, receipt: { status: "signed", signedReceipt: { testReceipt: true } } };
}
function verification(sent: PendingTransaction, revision: number): CommitReceiptVerification {
  return {
    expected: { documentId: ID, clientTransactionId: sent.tx.clientTransactionId, revision },
    verify: async () => true,
  };
}
/** What the runner does: verify against the queue of now, then record. */
async function answer(
  journal: AtomicDexieJournal, sent: PendingTransaction, outcome: DrainOutcome, revision: number,
  state: Parameters<AtomicDexieJournal["recordAnswer"]>[3],
) {
  await outcomeToEvents(outcome, verification(sent, revision), { sent, pending: (await journal.read(ID)).pending });
  return journal.recordAnswer(ID, sent, outcome, state);
}

describe("M0.1 journal: local writes", () => {
  it("17: a successful write clears a stale lastError and a recorded ERROR (47, 86)", async () => {
    const journal = kit.open();
    await queue(journal, ID, 1);
    await raw(journal).table("meta").put({ documentId: ID, localSeq: 1, state: "ERROR", lastError: "quota" });
    const saved = await journal.saveLocal(ID, tx("after-error", "nakon kvara"), UTC, 1);
    expect(saved.meta).toEqual({ documentId: ID, localSeq: 2, state: "LOCAL_DURABLE" });
    const after = await journal.read(ID);
    expect(after.meta).toEqual(saved.meta);
    expect(after.snapshot?.document).toEqual(text("nakon kvara"));
    expect(after.pending.map((row) => row.localSeq)).toEqual([1, 2]);
  });

  it.each(["CONFLICT", "RECOVERY_REQUIRED"] as const)(
    "43: %s comes back after the journal is closed and opened again, and still refuses a save",
    async (state) => {
      const scope = kit.nextScope();
      const first = kit.open(scope);
      await queue(first, ID, 1);
      await raw(first).table("meta").put({ documentId: ID, localSeq: 1, state });
      const before = await first.read(ID);
      first.close();

      const reopened = kit.open(scope);
      expect(await reopened.read(ID)).toEqual(before);
      expect((await reopened.read(ID)).meta?.state).toBe(state);
      await expect(reopened.saveLocal(ID, tx("after-reopen"), UTC, 1)).rejects.toMatchObject({ code: "sticky_state" });
      expect(await reopened.read(ID)).toEqual(before);
    },
  );

  it("56: a fresh journal opens straight at version 4 with all six stores", async () => {
    const journal = kit.open();
    await journal.read(ID);
    const db = raw(journal);
    expect(db.verno).toBe(4);
    expect(db.tables.map((table) => table.name).sort())
      .toEqual(["control", "meta", "pending", "salvage", "snapshots", "timings"]);
    expect(Array.from(db.backendDB().objectStoreNames).sort())
      .toEqual(["control", "meta", "pending", "salvage", "snapshots", "timings"]);
    expect(db.table("pending").schema.primKey.keyPath).toEqual(["documentId", "localSeq"]);
  });
});

describe("M0.1 journal: send answers", () => {
  it("35: an acknowledged row never touches another document's queue", async () => {
    const journal = kit.open();
    await queue(journal, OTHER_ID, 2, "drugi");
    const otherBefore = await journal.read(OTHER_ID);
    const [sent] = await queue(journal, ID, 1);
    await journal.beginSend(ID, sent!);
    const result = await answer(journal, sent!, signed(1), 1, "SYNCED");
    expect(result).toMatchObject({ ackedRevision: 1, pending: [] });
    expect((await journal.read(ID)).pending).toEqual([]);
    expect(await journal.read(OTHER_ID)).toEqual(otherBefore);
  });

  it("49: an acknowledgement moves only the revision; the saved text stays as it was", async () => {
    const journal = kit.open();
    const [sent] = await queue(journal, ID, 1, "neka rečenica");
    const before = await journal.read(ID);
    await journal.beginSend(ID, sent!);
    await answer(journal, sent!, signed(3), 3, "SYNCED");
    const after = await journal.read(ID);
    expect(after.snapshot).toEqual({ ...before.snapshot!, revision: 3 });
    expect(after.snapshot!.document).toEqual(text("neka rečenica 1"));
  });

  it.each([1.5, -1, 0, Number.MAX_SAFE_INTEGER + 2])(
    "52: a committed revision %s is no acknowledgement: SYNCED is refused and nothing leaves",
    async (revision) => {
      const journal = kit.open();
      const [sent] = await queue(journal, ID, 1);
      await journal.beginSend(ID, sent!);
      const before = await journal.read(ID);
      const outcome = signed(revision);
      await expect(answer(journal, sent!, outcome, revision, "SYNCED")).rejects.toMatchObject({ code: "unconfirmed_sync" });
      expect(await journal.read(ID)).toEqual(before);
      const recorded = await journal.recordAnswer(ID, sent!, outcome, null);
      expect(recorded.ackedRevision).toBeNull();
      expect(recorded.pending).toHaveLength(1);
      expect((await journal.read(ID)).snapshot).toEqual(before.snapshot);
    },
  );
});

describe("M0.1 journal: taking the server's version", () => {
  let local: Chain;
  let SEG: BuiltSegment[];
  let SERVER: EvidenceOpening;
  beforeAll(async () => {
    local = await capture(2);
    SEG = local.segments;
    const other = (await capture(2, 1, null, "Izmišljeni uvod s drugog uređaja")).segments;
    SERVER = openedAfter(other[1]!, R0 + 2);
  }, 60_000);

  /** DOC in CONFLICT with two segment rows, beside OTHER_ID with plain rows. */
  async function inConflict(): Promise<AtomicDexieJournal> {
    const journal = kit.open();
    await queue(journal, OTHER_ID, 2, "drugi dokument");
    await journal.startEvidence(DOC, local.opened, UTC);
    for (const built of SEG) await save(journal, built);
    await runnerFor(journal, server(R0, () => json(409, { status: "chain_conflict", currentRevision: R0 + 2 }))).step(DOC);
    expect((await journal.readEvidence(DOC)).meta?.state).toBe("CONFLICT");
    return journal;
  }
  async function everything(journal: AtomicDexieJournal) {
    return {
      doc: await journal.readEvidence(DOC),
      other: await journal.read(OTHER_ID),
      salvage: await raw(journal).table("salvage").toArray(),
    };
  }

  it.each([1.5, -1, Number.NaN])("80: a server revision %s is refused and writes nothing", async (currentRevision) => {
    const journal = await inConflict();
    const before = await everything(journal);
    const seq = before.doc.meta!.localSeq;
    const error = await journal.adoptServerEvidence(DOC, { ...SERVER, currentRevision }, true, DECIDED, seq)
      .then(() => null, (caught: unknown) => caught);
    expect(error).toBeInstanceOf(JournalError);
    expect(error).toMatchObject({ code: "invalid_input" });
    expect(await everything(journal)).toEqual(before);
  });

  it("81: taking the server's version leaves another document's queue alone", async () => {
    const journal = await inConflict();
    const before = await everything(journal);
    await journal.adoptServerEvidence(DOC, SERVER, true, DECIDED, before.doc.meta!.localSeq);
    const after = await everything(journal);
    expect(after.doc.pending).toEqual([]);
    expect(after.other).toEqual(before.other);
    expect(after.other.pending.map((row) => row.localSeq)).toEqual([1, 2]);
    expect(after.salvage.map((copy) => copy.documentId)).toEqual([DOC]);
  });
});
