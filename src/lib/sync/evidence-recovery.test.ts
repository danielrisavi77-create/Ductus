// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { emptyDocument } from "@/domain/document";
import { jcsUtf8Bytes } from "@/domain/forensics/jcs";
import { outcomeToEvents, type DrainOutcome } from "@/domain/sync/drain";
import type { EvidenceOpening, EvidenceSegmentTransaction, PendingTransaction } from "@/domain/sync/journal-types";
import type { BuiltSegment } from "@/editor/capture";
import type { AtomicDexieJournal } from "@/lib/journal/atomic-dexie-journal";

import {
  capture, DOC, journalKit, json, openedAfter, R0, raw, runnerFor, save, server, trusted, UTC, type Chain,
} from "./evidence-test-kit";

/**
 * F-8 3d-2b1 (DAN-285, contract #476 c.6385900370, points 1-11): a document
 * with evidence leaves CONFLICT and RECOVERY_REQUIRED only by taking the
 * server's version, with a copy of the local text kept until the author lets
 * it go. Every key, id and text is invented.
 */

const DECIDED = "2026-10-24T13:00:00.000Z";
const kit = journalKit("9");
afterEach(kit.cleanup);

let local: Chain;
let SEG: BuiltSegment[];
/** Another device's chain: what the server holds when ours is refused. */
let OTHER: BuiltSegment[];
let SERVER: EvidenceOpening;
beforeAll(async () => {
  local = await capture(4);
  SEG = local.segments;
  OTHER = (await capture(2, 1, null, "Uvod s drugog uredaja")).segments;
  SERVER = openedAfter(OTHER[1]!, R0 + 2);
}, 60_000);

async function started(): Promise<AtomicDexieJournal> {
  const journal = kit.open();
  await journal.startEvidence(DOC, local.opened, UTC);
  return journal;
}
/** Rows 1..`rows` queued, then the server refuses row 1 with `answer`. */
async function refused(rows: number, answer: Response): Promise<AtomicDexieJournal> {
  const journal = await started();
  for (const built of SEG.slice(0, rows)) await save(journal, built);
  await runnerFor(journal, server(R0, () => answer)).step(DOC);
  return journal;
}
const chainConflict = () => json(409, { status: "chain_conflict", currentRevision: R0 + 2 });
const seqOf = async (journal: AtomicDexieJournal) => (await journal.readEvidence(DOC)).meta!.localSeq;

/** Everything the journal holds for `DOC`, to prove a refusal wrote nothing. */
async function everything(journal: AtomicDexieJournal) {
  return {
    contents: await journal.readEvidence(DOC),
    timings: await raw(journal).table("timings").toArray(),
    salvage: await raw(journal).table("salvage").toArray(),
  };
}
async function refuses(journal: AtomicDexieJournal, code: string, write: () => Promise<unknown>) {
  const before = await everything(journal);
  await expect(write()).rejects.toMatchObject({ code });
  expect(await everything(journal)).toEqual(before);
}

describe("F-8 3d-2b1: leaving CONFLICT and RECOVERY_REQUIRED", () => {
  it.each(["stale_base", "chain_conflict", "not_continuous"])("1: after %s nothing is taken without a confirmation", async (status) => {
    const journal = await refused(2, json(409, { status, currentRevision: R0 + 2 }));
    expect((await journal.readEvidence(DOC)).meta?.state).toBe("CONFLICT");
    await refuses(journal, "confirmation_required", async () =>
      journal.adoptServerEvidence(DOC, SERVER, false, DECIDED, await seqOf(journal)));
  });

  it("2: a confirmed take: the server's text, revision and head, the local text kept, nothing owed", async () => {
    const journal = await refused(2, chainConflict());
    const before = await journal.readEvidence(DOC);
    const meta = await journal.adoptServerEvidence(DOC, SERVER, true, DECIDED, before.meta!.localSeq);
    expect(meta).toEqual({
      documentId: DOC, localSeq: before.meta!.localSeq + 1, state: "SYNCED",
      evidenceHead: { segmentHash: OTHER[1]!.sha256, lastSequenceTo: 2 },
    });
    const after = await journal.readEvidence(DOC);
    expect(after.pending).toEqual([]);
    expect(after.meta).toEqual(meta);
    expect(after.snapshot).toMatchObject({ revision: R0 + 2, savedAt: DECIDED });
    expect(jcsUtf8Bytes(after.snapshot!.document)).toEqual(SERVER.document);
    expect(await journal.readSalvage(DOC)).toEqual([{
      id: expect.any(Number), documentId: DOC, document: before.snapshot!.document,
      cause: "CONFLICT", localSeq: before.meta!.localSeq, decidedAt: DECIDED,
    }]);
    expect(await runnerFor(journal, server()).step(DOC)).toEqual({ kind: "idle" });
  });

  it("2b: in CONFLICT the server's version must reach the revision the conflict named", async () => {
    const journal = await refused(2, chainConflict());
    // Nothing was acknowledged, so the page-load opening is not behind this
    // device; it is behind the server that refused the row.
    await refuses(journal, "invalid_input", () => journal.adoptServerEvidence(DOC, local.opened, true, DECIDED, 2));
    await refuses(journal, "invalid_input", () =>
      journal.adoptServerEvidence(DOC, openedAfter(OTHER[0]!, R0 + 1), true, DECIDED, 2));
    await expect(journal.adoptServerEvidence(DOC, SERVER, true, DECIDED, 2)).resolves.toMatchObject({ state: "SYNCED" });
  });

  it("3: RECOVERY_REQUIRED: only the diverged row owed needs no confirmation; a newer row does", async () => {
    const one = await refused(1, json(409, { status: "txid_reused" }));
    expect((await one.readEvidence(DOC)).meta?.state).toBe("RECOVERY_REQUIRED");
    await expect(one.adoptServerEvidence(DOC, SERVER, false, DECIDED, 1)).resolves.toMatchObject({ state: "SYNCED" });
    expect(await one.readSalvage(DOC)).toMatchObject([{ cause: "RECOVERY_REQUIRED" }]);
    const two = await refused(2, json(409, { status: "txid_reused" }));
    await refuses(two, "confirmation_required", () => two.adoptServerEvidence(DOC, SERVER, false, DECIDED, 2));
    await expect(two.adoptServerEvidence(DOC, SERVER, true, DECIDED, 2)).resolves.toMatchObject({ state: "SYNCED" });
  });

  it("4: after the take the chain continues the server's head, on the server's revision", async () => {
    const journal = await refused(2, chainConflict());
    await journal.adoptServerEvidence(DOC, SERVER, true, DECIDED, 2);
    await expect(journal.saveSegment(DOC, SEG[2]!, UTC, 3)).rejects.toMatchObject({ code: "chain_broken" });
    const next = (await capture(1, 3, OTHER[1]!.sha256, "Uvod s drugog uredaja")).segments[0]!;
    await journal.saveSegment(DOC, next, UTC, 3);
    const net = server(R0 + 2);
    expect(await runnerFor(journal, net).step(DOC)).toMatchObject({ kind: "sent", state: "SYNCED", ackedRevision: R0 + 3 });
    expect(net.calls.map(({ body }) => body.baseRevision)).toEqual([R0 + 2]);
    expect((await journal.readEvidence(DOC)).meta?.evidenceHead).toEqual({ segmentHash: next.sha256, lastSequenceTo: 3 });
  });

  it("5: refusals write nothing", async () => {
    const owing = await started();
    await save(owing, SEG[0]!);
    await refuses(owing, "not_in_recovery", () => owing.adoptServerEvidence(DOC, SERVER, true, DECIDED, 1));
    const plain = kit.open();
    await plain.saveLocal(DOC, {
      kind: "REPLACE_DOCUMENT", clientTransactionId: "tx-zamjena", baseRevision: R0,
      document: emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000001"), createdAt: UTC,
    }, UTC, 0);
    await expect(plain.adoptServerEvidence(DOC, SERVER, true, DECIDED, 1)).rejects.toMatchObject({ code: "mixed_queue" });
    const journal = await refused(2, chainConflict());
    const cases: [string, () => Promise<unknown>][] = [
      ["invalid_input", () => journal.adoptServerEvidence(DOC, { ...SERVER, documentId: "drugi-dokument" }, true, DECIDED, 2)],
      ["invalid_input", () => journal.adoptServerEvidence(DOC, { ...SERVER, documentHash: "a".repeat(64) }, true, DECIDED, 2)],
      ["invalid_input", () => journal.adoptServerEvidence(DOC, { ...SERVER, currentRevision: R0 - 1 }, true, DECIDED, 2)],
      ["invalid_input", () => journal.adoptServerEvidence(DOC, local.opened, true, "nije-vrijeme", 2)],
      ["stale_local_sequence", () => journal.adoptServerEvidence(DOC, SERVER, true, DECIDED, 1)],
    ];
    for (const [code, write] of cases) await refuses(journal, code, write);
    // The server's head may not fall behind a head this device already had acknowledged.
    const acked = await started();
    await save(acked, SEG[0]!);
    await save(acked, SEG[1]!);
    await runnerFor(acked, server(R0)).step(DOC);
    await runnerFor(acked, server(R0 + 1, () => chainConflict())).step(DOC);
    await refuses(acked, "invalid_input", () => acked.adoptServerEvidence(DOC, local.opened, true, DECIDED, 2));
    await raw(journal).table("control").put({ key: "logout", state: "closing" });
    await refuses(journal, "logout_in_progress", () => journal.adoptServerEvidence(DOC, SERVER, true, DECIDED, 2));
  });

  it.each([
    ["salvage", "creating"], ["pending", "deleting"], ["snapshots", "updating"], ["meta", "updating"],
  ] as const)("6: a failure writing %s leaves the document in CONFLICT with its rows", async (table, hook) => {
    const journal = await refused(2, chainConflict());
    const before = await everything(journal);
    raw(journal).table(table).hook(hook as "creating", () => {
      throw new Error("synthetic IndexedDB failure");
    });
    await expect(journal.adoptServerEvidence(DOC, SERVER, true, DECIDED, 2)).rejects.toThrow();
    expect(await everything(journal)).toEqual(before);
  });

  it("7: a stopped recorder: the take clears the stop and keeps the uncovered text with its cause", async () => {
    const journal = await started();
    await save(journal, SEG[0]!);
    const uncovered = (await capture(1, 1, null, "Nepokriveni tekst")).segments[0]!;
    const text = JSON.parse(new TextDecoder().decode(uncovered.document));
    await journal.saveUncovered(DOC, text, "gap", UTC, 1);
    await runnerFor(journal, server(R0, () => chainConflict())).step(DOC);
    expect((await journal.readEvidence(DOC)).meta).toMatchObject({ state: "CONFLICT", evidenceStopped: "gap" });
    const meta = await journal.adoptServerEvidence(DOC, SERVER, true, DECIDED, 2);
    expect(meta.evidenceStopped).toBeUndefined();
    expect(await journal.readSalvage(DOC)).toMatchObject([{ document: text, cause: "CONFLICT", evidenceStopped: "gap" }]);
  });

  it("7: a stopped recorder with nothing owed: a confirmed take is the way out, and logout opens once the copy goes", async () => {
    const journal = await started();
    await save(journal, SEG[0]!);
    const text = (await journal.readEvidence(DOC)).snapshot!.document;
    await journal.saveUncovered(DOC, text, "unsupported_step", UTC, 1);
    await refuses(journal, "not_in_recovery", () => journal.adoptServerEvidence(DOC, SERVER, true, DECIDED, 2));
    await runnerFor(journal, server()).step(DOC);
    expect((await journal.readEvidence(DOC)).meta).toMatchObject({ state: "LOCAL_DURABLE", evidenceStopped: "unsupported_step" });
    await expect(journal.destroyForLogout()).rejects.toMatchObject({ code: "unsynced_work" });
    const server1 = openedAfter(SEG[0]!, R0 + 1);
    await refuses(journal, "confirmation_required", () => journal.adoptServerEvidence(DOC, server1, false, DECIDED, 2));
    expect(await journal.adoptServerEvidence(DOC, server1, true, DECIDED, 2)).toEqual({
      documentId: DOC, localSeq: 3, state: "SYNCED", evidenceHead: { segmentHash: SEG[0]!.sha256, lastSequenceTo: 1 },
    });
    const [copy] = await journal.readSalvage(DOC);
    expect(copy).toMatchObject({ cause: "EVIDENCE_STOPPED", evidenceStopped: "unsupported_step", document: text });
    await expect(journal.destroyForLogout()).rejects.toMatchObject({ code: "unsynced_work" });
    await journal.releaseSalvage(DOC, copy!.id);
    await expect(journal.destroyForLogout()).resolves.toBeUndefined();
  });

  it("7: a stopped recorder whose owed row the server refuses for good: a confirmed take is the way out", async () => {
    const journal = await started();
    await save(journal, SEG[0]!);
    const text = (await journal.readEvidence(DOC)).snapshot!.document;
    await journal.saveUncovered(DOC, text, "unsupported_step", UTC, 1);
    await runnerFor(journal, server(R0, () => json(413, { status: "too_large" }))).step(DOC);
    expect((await journal.readEvidence(DOC)).meta).toMatchObject({ state: "ERROR", evidenceStopped: "unsupported_step" });
    await expect(journal.destroyForLogout()).rejects.toMatchObject({ code: "unsynced_work" });
    await refuses(journal, "confirmation_required", () => journal.adoptServerEvidence(DOC, local.opened, false, DECIDED, 2));
    await expect(journal.adoptServerEvidence(DOC, local.opened, true, DECIDED, 2)).resolves.toMatchObject({ state: "SYNCED" });
    expect((await journal.readEvidence(DOC)).pending).toEqual([]);
    const [copy] = await journal.readSalvage(DOC);
    expect(copy).toMatchObject({ cause: "EVIDENCE_STOPPED", evidenceStopped: "unsupported_step", document: text });
    await journal.releaseSalvage(DOC, copy!.id);
    await expect(journal.destroyForLogout()).resolves.toBeUndefined();
  });

  it("8: a kept copy blocks logout until the author lets it go; then everything goes", async () => {
    const journal = await refused(1, chainConflict());
    await journal.adoptServerEvidence(DOC, SERVER, true, DECIDED, 1);
    await expect(journal.destroyForLogout()).rejects.toMatchObject({ code: "unsynced_work" });
    const [copy] = await journal.readSalvage(DOC);
    await expect(journal.releaseSalvage("drugi-dokument", copy!.id)).rejects.toMatchObject({ code: "not_queued" });
    await journal.releaseSalvage(DOC, copy!.id);
    expect(await journal.readSalvage(DOC)).toEqual([]);
    const scope = raw(journal).name.slice("ductus-journal-v1-".length);
    await journal.destroyForLogout();
    const after = kit.open(scope);
    expect(await after.readEvidence(DOC)).toEqual({ snapshot: null, pending: [], meta: null });
    expect(await raw(after).table("timings").count()).toBe(0);
    expect(await after.readSalvage(DOC)).toEqual([]);
  });

  it("9: a late answer for a dropped row changes nothing", async () => {
    const journal = await refused(2, chainConflict());
    const [dropped] = (await journal.readEvidence(DOC)).pending as PendingTransaction<EvidenceSegmentTransaction>[];
    await journal.adoptServerEvidence(DOC, SERVER, true, DECIDED, 2);
    const before = await everything(journal);
    const late: DrainOutcome[] = [
      { status: "committed", revision: R0 + 1, receipt: { status: "signed", signedReceipt: trusted.sign({ documentId: DOC, clientTransactionId: dropped!.tx.clientTransactionId, revision: R0 + 1, segmentHash: dropped!.tx.segmentHash }) } },
      { status: "stale_base", currentRevision: R0 + 2 },
    ];
    for (const outcome of late) {
      const events = await outcomeToEvents(outcome, {
        expected: { documentId: DOC, clientTransactionId: dropped!.tx.clientTransactionId, revision: R0 + 1 },
        verify: async () => true,
      }, { sent: dropped!, pending: (await journal.readEvidence(DOC)).pending });
      expect(events).toEqual([]);
      await journal.recordAnswer(DOC, dropped!, outcome, null);
    }
    expect(await everything(journal)).toEqual(before);
  });

  it("9b: another tab's answer for a row the take dropped changes nothing, through the runner too", async () => {
    const journal = await started();
    await save(journal, SEG[0]!);
    await save(journal, SEG[1]!);
    const [sent] = (await journal.readEvidence(DOC)).pending;
    let taken: Awaited<ReturnType<typeof everything>> | undefined;
    // Tab B's request is out; meanwhile tab A is refused on the same row and
    // its author takes the server's version. Then B's connection drops.
    const tabB = runnerFor(journal, server(R0, async () => {
      await runnerFor(journal, server(R0, () => chainConflict())).step(DOC);
      await journal.adoptServerEvidence(DOC, SERVER, true, DECIDED, 2);
      taken = await everything(journal);
      return new Error("connection dropped");
    }));
    await tabB.step(DOC);
    expect(taken?.contents.meta).toMatchObject({ state: "SYNCED" });
    expect(await everything(journal)).toEqual(taken);
    // The state tab B computes when it read the CONFLICT before the take.
    await journal.recordAnswer(DOC, sent!, { status: "transport_error" }, "CONFLICT");
    expect(await everything(journal)).toEqual(taken);
  });

  it.each([
    ["CONFLICT", chainConflict], ["RECOVERY_REQUIRED", () => json(409, { status: "txid_reused" })],
  ] as const)("10: %s refuses every other write, as before", async (state, answer) => {
    const journal = await refused(1, answer());
    expect((await journal.readEvidence(DOC)).meta?.state).toBe(state);
    const text = (await journal.readEvidence(DOC)).snapshot!.document;
    await refuses(journal, "sticky_state", () => journal.saveSegment(DOC, SEG[1]!, UTC, 1));
    await refuses(journal, "sticky_state", () => journal.saveUncovered(DOC, text, "gap", UTC, 1));
    await refuses(journal, "sticky_state", () => journal.saveLocal(DOC, {
      kind: "REPLACE_DOCUMENT", clientTransactionId: "tx-zamjena", baseRevision: R0, document: text, createdAt: UTC,
    }, UTC, 1));
  });
});
