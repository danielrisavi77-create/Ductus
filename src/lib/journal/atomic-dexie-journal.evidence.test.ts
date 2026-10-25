// @vitest-environment node
import Dexie from "dexie";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { emptyDocument, type DocumentTransaction } from "@/domain/document";
import { MAX_DOCUMENT_SNAPSHOT_BYTES } from "@/domain/document/snapshot";
import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";
import { jcsUtf8Bytes } from "@/domain/forensics/jcs";
import type { EvidenceOpening } from "@/domain/sync/journal-types";
import type { BuiltSegment } from "@/editor/capture";
import {
  answer, capture, committed, DOC, deps, journalKit, openedAfter, PROFILE, R0, raw, receiptKey, save, UTC, type Chain,
} from "@/lib/sync/evidence-test-kit";

import type { AtomicDexieJournal } from "./atomic-dexie-journal";

/**
 * F-8 3d-2a (DAN-285, contract #476 c.6384736095): the journal v3 for a
 * document with evidence, over segments the real recorder captured from the
 * editor schema and receipts signed with a real Ed25519 key. The drain that
 * sends the rows is the next step; here an answer is recorded as a drain step
 * records it (`answer`). Every key, id and text is invented.
 */

let chain: Chain;
let SEG: BuiltSegment[];
beforeAll(async () => {
  chain = await capture(3);
  SEG = chain.segments;
}, 60_000);

// A prefix no other journal test file uses, so the files never share a database.
const { open, nextScope, cleanup } = journalKit("8");
afterEach(cleanup);

async function started(): Promise<AtomicDexieJournal> {
  const journal = open();
  await journal.startEvidence(DOC, chain.opened, UTC);
  return journal;
}
/** Everything the journal holds for `DOC`, to prove a refusal wrote nothing. */
async function everything(journal: AtomicDexieJournal) {
  return { contents: await journal.readEvidence(DOC), timings: await raw(journal).table("timings").toArray() };
}
async function refuses(journal: AtomicDexieJournal, code: string, write: () => Promise<unknown>) {
  const before = await everything(journal);
  await expect(write()).rejects.toMatchObject({ code });
  expect(await everything(journal)).toEqual(before);
}

describe("F-8 3d-2a: journal v3", () => {
  it("13: startEvidence sets snapshot, revision and head; again only on an empty queue", async () => {
    const journal = await started();
    const first = await journal.readEvidence(DOC);
    expect(first.snapshot).toMatchObject({ revision: R0, savedAt: UTC });
    expect(jcsUtf8Bytes(first.snapshot!.document)).toEqual(chain.opened.document);
    expect(first.meta).toMatchObject({ localSeq: 0, evidenceHead: { segmentHash: null, lastSequenceTo: 0 } });
    await save(journal, SEG[0]!);
    await refuses(journal, "queue_not_empty", () => journal.startEvidence(DOC, chain.opened, UTC));
    await answer(journal, committed(R0 + 1));
    expect(await journal.startEvidence(DOC, openedAfter(SEG[0]!, R0 + 1), UTC)).toMatchObject({
      state: "SYNCED", localSeq: 1, evidenceHead: { segmentHash: SEG[0]!.sha256, lastSequenceTo: 1 },
    });
    await expect(open().startEvidence(DOC, { ...chain.opened, documentHash: "a".repeat(64) }, UTC)).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("13: startEvidence refuses a missing answer and a server behind this device, without a write", async () => {
    await expect(open().startEvidence(DOC, null as unknown as EvidenceOpening, UTC)).rejects.toMatchObject({ code: "invalid_input" });
    const journal = await started();
    await save(journal, SEG[0]!);
    await answer(journal, committed(R0 + 1));
    // An answer of the open route from before that receipt, processed late
    // (review676 MANJE 3, Codex 4367661620).
    await refuses(journal, "invalid_input", () => journal.startEvidence(DOC, openedAfter(SEG[0]!, R0), UTC));
    await refuses(journal, "invalid_input", () => journal.startEvidence(DOC, { ...chain.opened, currentRevision: R0 + 1 }, UTC));
  });

  it("6: saveSegment refuses a broken chain, foreign or forged bytes and limits without a write", async () => {
    const journal = await started();
    await save(journal, SEG[0]!);
    const wrongPredecessor = (await capture(1, 2, "f".repeat(64))).segments[0]!;
    const notJcs = new TextEncoder().encode(` ${new TextDecoder().decode(SEG[1]!.document)}`);
    const tooBig = (size: number) => new Uint8Array(size).fill(0x20);
    const cases: [string, () => Promise<unknown>][] = [
      ["chain_broken", () => journal.saveSegment(DOC, SEG[2]!, UTC, 1)],
      ["duplicate_transaction", () => journal.saveSegment(DOC, SEG[0]!, UTC, 1)],
      ["chain_broken", () => journal.saveSegment(DOC, wrongPredecessor, UTC, 1)],
      ["invalid_input", () => journal.saveSegment("drugi-dokument", SEG[1]!, UTC, 1)],
      ["invalid_input", () => journal.saveSegment(DOC, { ...SEG[1]!, document: notJcs }, UTC, 1)],
      ["invalid_input", () => journal.saveSegment(DOC, { ...SEG[1]!, document: SEG[2]!.document }, UTC, 1)],
      ["invalid_input", () => journal.saveSegment(DOC, { ...SEG[1]!, sha256: SEG[2]!.sha256 }, UTC, 1)],
      ["invalid_input", () => journal.saveSegment(DOC, { ...SEG[1]!, bytes: tooBig(MAX_EVIDENCE_SEGMENT_BYTES + 1) }, UTC, 1)],
      ["invalid_input", () => journal.saveSegment(DOC, { ...SEG[1]!, document: tooBig(MAX_DOCUMENT_SNAPSHOT_BYTES + 1) }, UTC, 1)],
      ["invalid_input", () => journal.saveSegment(DOC, { ...SEG[1]!, timing: SEG[2]!.timing }, UTC, 1)],
      ["stale_local_sequence", () => journal.saveSegment(DOC, SEG[1]!, UTC, 0)],
      ["mixed_queue", () => journal.saveLocal(DOC, {
        kind: "REPLACE_DOCUMENT", clientTransactionId: "tx-zamjena", baseRevision: R0,
        document: emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000001"), createdAt: UTC,
      }, UTC, 1)],
    ];
    for (const [code, write] of cases) await refuses(journal, code, write);
    await raw(journal).table("control").put({ key: "logout", state: "closing" });
    await refuses(journal, "logout_in_progress", () => journal.saveSegment(DOC, SEG[1]!, UTC, 1));
  });

  it("6: a document of replacements takes no segment, a CONFLICT none either", async () => {
    const plain = open();
    await plain.saveLocal(DOC, {
      kind: "REPLACE_DOCUMENT", clientTransactionId: "tx-zamjena", baseRevision: R0,
      document: emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000001"), createdAt: UTC,
    }, UTC, 0);
    await expect(plain.saveSegment(DOC, SEG[0]!, UTC, 1)).rejects.toMatchObject({ code: "mixed_queue" });
    await expect(open().saveSegment(DOC, SEG[0]!, UTC, 0)).rejects.toMatchObject({ code: "mixed_queue" });
    const journal = await started();
    await save(journal, SEG[0]!);
    await answer(journal, () => ({ status: "stale_base", currentRevision: 9 }));
    expect((await journal.readEvidence(DOC)).meta?.state).toBe("CONFLICT");
    await refuses(journal, "sticky_state", () => journal.saveSegment(DOC, SEG[1]!, UTC, 1));
  });

  it.each([
    ["pending", "creating"], ["snapshots", "updating"], ["timings", "creating"], ["meta", "updating"],
  ] as const)("7, 16: a failure writing %s leaves nothing of the save", async (table, hook) => {
    const journal = await started();
    const before = await everything(journal);
    raw(journal).table(table).hook(hook as "creating", () => {
      throw new Error("synthetic IndexedDB failure");
    });
    await expect(journal.saveSegment(DOC, SEG[0]!, UTC, 0)).rejects.toThrow();
    expect(await everything(journal)).toEqual(before);
  });

  it("7: every hash of a save is taken before its transaction opens", async () => {
    // Awaiting Web Crypto inside an IndexedDB transaction lets a browser commit
    // it early; fake-indexeddb does not, so the call itself is watched.
    const journal = await started();
    const inside: boolean[] = [];
    const subtle = globalThis.crypto.subtle;
    const original = subtle.digest.bind(subtle);
    const digest = vi.spyOn(subtle, "digest").mockImplementation((...args: Parameters<SubtleCrypto["digest"]>) => {
      inside.push(Dexie.currentTransaction != null);
      return original(...args);
    });
    try {
      await save(journal, SEG[0]!);
    } finally {
      digest.mockRestore();
    }
    expect(inside.length).toBeGreaterThan(0);
    expect(inside).not.toContain(true);
  });

  it("8: a version 2 database opens as the current version with its rows, snapshot, meta and fence", async () => {
    const scope = nextScope();
    const old = new Dexie(`ductus-journal-v1-${scope}`, deps);
    old.version(1).stores({ snapshots: "documentId", pending: "[documentId+localSeq],documentId", meta: "documentId" });
    old.version(2).stores({ control: "key" });
    const document = emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000001");
    const tx: DocumentTransaction = { kind: "REPLACE_DOCUMENT", clientTransactionId: "tx-stari", baseRevision: 3, document, createdAt: UTC };
    await old.table("snapshots").put({ documentId: "stari-dokument", revision: 3, document, savedAt: UTC });
    await old.table("pending").put({ documentId: "stari-dokument", localSeq: 1, tx, queuedAt: UTC });
    await old.table("meta").put({ documentId: "stari-dokument", localSeq: 1, state: "LOCAL_DURABLE" });
    await old.table("control").put({ key: "logout", state: "closing" });
    old.close();
    const journal = open(scope);
    expect(await journal.read("stari-dokument")).toEqual({
      snapshot: { documentId: "stari-dokument", revision: 3, document, savedAt: UTC },
      pending: [{ documentId: "stari-dokument", localSeq: 1, tx, queuedAt: UTC }],
      meta: { documentId: "stari-dokument", localSeq: 1, state: "LOCAL_DURABLE" },
    });
    expect(await journal.hasPendingLogout()).toBe(true);
    // Version 4 (3d-2b) added the store of kept copies.
    expect(raw(journal).verno).toBe(4);
    expect(await raw(journal).table("timings").count()).toBe(0);
    expect(await raw(journal).table("salvage").count()).toBe(0);
  });

  it("9: an owed segment blocks logout; the timing record does not, and goes with the database", async () => {
    const opened = open();
    await opened.startEvidence(DOC, chain.opened, UTC);
    await opened.destroyForLogout();
    const journal = await started();
    await save(journal, SEG[0]!);
    await expect(journal.destroyForLogout()).rejects.toMatchObject({ code: "unsynced_work" });
    await answer(journal, committed(R0 + 1));
    expect(await raw(journal).table("timings").get(SEG[0]!.sha256)).toEqual({
      segmentHash: SEG[0]!.sha256, documentId: DOC, sequenceFrom: 1, events: SEG[0]!.timing.events,
    });
    const scope = raw(journal).name.slice("ductus-journal-v1-".length);
    await journal.destroyForLogout();
    const after = open(scope);
    expect(await after.readEvidence(DOC)).toEqual({ snapshot: null, pending: [], meta: null });
    expect(await raw(after).table("timings").count()).toBe(0);
  });

  it("4, 5: the head moves only with a verified receipt for the stored row, SYNCED only with the last", async () => {
    const journal = await started();
    for (const built of SEG.slice(0, 2)) await save(journal, built);
    await answer(journal, committed(R0 + 1, {}, receiptKey("kljuc-izmisljeni-tudi")));
    await answer(journal, committed(R0 + 1, { segmentHash: "d".repeat(64) }));
    let stored = await journal.readEvidence(DOC);
    expect(stored.pending).toHaveLength(2);
    expect(stored.meta?.evidenceHead).toEqual({ segmentHash: null, lastSequenceTo: 0 });
    expect(stored.meta?.state).not.toBe("SYNCED");
    expect((await answer(journal, committed(R0 + 1))).meta.state).not.toBe("SYNCED");
    stored = await journal.readEvidence(DOC);
    expect(stored.meta?.evidenceHead).toEqual({ segmentHash: SEG[0]!.sha256, lastSequenceTo: 1 });
    expect(stored.snapshot?.revision).toBe(R0 + 1);
    expect((await answer(journal, committed(R0 + 2))).meta).toMatchObject({
      state: "SYNCED", evidenceHead: { segmentHash: SEG[1]!.sha256, lastSequenceTo: 2 },
    });
  });

  it("15: after the recorder stops, text is saved without evidence, earlier rows settle, no SYNCED, logout blocked", async () => {
    const journal = await started();
    for (const built of SEG.slice(0, 2)) await save(journal, built);
    const later = (await journal.readEvidence(DOC)).snapshot!.document;
    await journal.saveUncovered(DOC, later, "gap", UTC, 2);
    await refuses(journal, "evidence_stopped", () => journal.saveSegment(DOC, SEG[2]!, UTC, 3));
    expect((await journal.readEvidence(DOC)).meta).toMatchObject({ evidenceStopped: "gap", localSeq: 3, state: "LOCAL_DURABLE" });
    await answer(journal, committed(R0 + 1));
    const last = await answer(journal, committed(R0 + 2));
    expect(last).toMatchObject({ meta: { state: "LOCAL_DURABLE" }, ackedRevision: R0 + 2, pending: [] });
    expect(last.meta.evidenceHead).toEqual({ segmentHash: SEG[1]!.sha256, lastSequenceTo: 2 });
    await expect(journal.startEvidence(DOC, chain.opened, UTC)).rejects.toMatchObject({ code: "evidence_stopped" });
    await expect(journal.destroyForLogout()).rejects.toMatchObject({ code: "unsynced_work" });
  });
});

describe("BE-2: the evidence profile of the work (#476 c.6392622568)", () => {
  const profileOf = async (journal: AtomicDexieJournal) => (await journal.readEvidence(DOC)).meta?.evidenceProfileId;

  it("startEvidence keeps the open route's profile, a new instance reads it, and every other write keeps it", async () => {
    const journal = await started();
    expect(await profileOf(journal)).toBe(PROFILE);
    const scope = raw(journal).name.slice("ductus-journal-v1-".length);
    expect(await profileOf(open(scope))).toBe(PROFILE);
    await save(journal, SEG[0]!);
    expect(await profileOf(journal)).toBe(PROFILE);
    await answer(journal, committed(R0 + 1));
    expect(await profileOf(journal)).toBe(PROFILE);
    const later = (await journal.readEvidence(DOC)).snapshot!.document;
    await journal.saveUncovered(DOC, later, "gap", UTC, 1);
    expect(await profileOf(journal)).toBe(PROFILE);
  });

  it.each([
    ["no profile", undefined], ["an empty profile", ""], ["a profile over 120 characters", "p".repeat(121)], ["a number", 7],
  ])("an opening with %s is refused without a write", async (_name, evidenceProfileId) => {
    const opening = { ...chain.opened, evidenceProfileId } as unknown as EvidenceOpening;
    const fresh = open();
    await refuses(fresh, "invalid_input", () => fresh.startEvidence(DOC, opening, UTC));
    // The answer is judged before the journal's state: no recovery takes it either.
    const ready = await started();
    await refuses(ready, "invalid_input", () => ready.adoptServerEvidence(DOC, opening, true, UTC, 0));
  });

  it("a profile of 120 characters is taken, and a later open answer's profile is the one kept", async () => {
    const journal = open();
    await journal.startEvidence(DOC, { ...chain.opened, evidenceProfileId: "p".repeat(120) }, UTC);
    expect(await profileOf(journal)).toBe("p".repeat(120));
    await journal.startEvidence(DOC, { ...chain.opened, evidenceProfileId: "profil-drugi" }, UTC);
    expect(await profileOf(journal)).toBe("profil-drugi");
  });

  it("a record from before BE-2 reads without a profile, still takes segments, and the journal never makes one up", async () => {
    const journal = await started();
    const meta = await raw(journal).table("meta").get(DOC);
    delete meta.evidenceProfileId;
    await raw(journal).table("meta").put(meta);
    expect((await journal.readEvidence(DOC)).meta).not.toHaveProperty("evidenceProfileId");
    await save(journal, SEG[0]!);
    await answer(journal, committed(R0 + 1));
    expect((await journal.readEvidence(DOC)).meta).not.toHaveProperty("evidenceProfileId");
  });
});
