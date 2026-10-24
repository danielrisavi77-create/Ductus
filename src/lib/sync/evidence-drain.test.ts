// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { decodeBase64 } from "@/client/evidence-ingest";
import { emptyDocument, type DocumentTransaction } from "@/domain/document";
import type { EvidenceReceiptPayloadV2 } from "@/domain/forensics/evidence-receipt";
import type { BuiltSegment } from "@/editor/capture";
import type { AtomicDexieJournal } from "@/lib/journal/atomic-dexie-journal";

import { createEvidenceTransport } from "./evidence-transport";
import {
  capture, DOC, journalKit, json, R0, receiptKey, runnerFor, save, server, sha256, UTC, type Body, type Chain,
} from "./evidence-test-kit";

/**
 * F-8 3d-2a2 (DAN-285, contract #476 c.6384736095): the drain of evidence
 * segments, over segments the real recorder captured from the editor schema,
 * the real commit client with a fake `fetch` that does the server's
 * compare-and-set, and receipts signed with a real Ed25519 key. Every key, id
 * and text is invented.
 */

const OTHER_DOMAIN = "99999999-9999-4999-8999-999999999999";

let chain: Chain;
let SEG: BuiltSegment[];
beforeAll(async () => {
  chain = await capture(50);
  SEG = chain.segments;
}, 60_000);

// A prefix no other journal test file uses, so the files never share a database.
const { open, cleanup } = journalKit("a");
afterEach(cleanup);

async function started(): Promise<AtomicDexieJournal> {
  const journal = open();
  await journal.startEvidence(DOC, chain.opened, UTC);
  return journal;
}
const sentSequence = (net: ReturnType<typeof server>) =>
  net.calls.map(({ body }) => SEG.findIndex((s) => s.sha256 === sha256(decodeBase64(body.segments[0])!)) + 1);

describe("F-8 3d-2a2: segments drain in order", () => {
  it("1, 5: three rows go 1, 2, 3 once each on r0, r0+1, r0+2; SYNCED only with the last", async () => {
    const journal = await started();
    for (const built of SEG.slice(0, 3)) await save(journal, built);
    const net = server();
    const runner = runnerFor(journal, net);
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", ackedRevision: R0 + 1 });
    expect((await journal.readEvidence(DOC)).meta?.state).not.toBe("SYNCED");
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", ackedRevision: R0 + 2 });
    expect((await journal.readEvidence(DOC)).meta?.state).not.toBe("SYNCED");
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", state: "SYNCED", ackedRevision: R0 + 3 });
    expect(await runner.step(DOC)).toEqual({ kind: "idle" });
    expect(sentSequence(net)).toEqual([1, 2, 3]);
    expect(net.calls.map(({ body }) => body.baseRevision)).toEqual([R0, R0 + 1, R0 + 2]);
    const { meta, snapshot, pending } = await journal.readEvidence(DOC);
    expect(pending).toEqual([]);
    expect(meta?.evidenceHead).toEqual({ segmentHash: SEG[2]!.sha256, lastSequenceTo: 3 });
    expect(snapshot?.revision).toBe(R0 + 3);
  });

  it("2: a lost answer replays row 1 with the same key and bytes; row 2 waits for its receipt", async () => {
    const journal = await started();
    for (const built of SEG.slice(0, 2)) await save(journal, built);
    // The commit lands on the server, the answer never reaches the client.
    const net = server(R0, (body, accept) => {
      accept(body);
      return new TypeError("offline");
    });
    const runner = runnerFor(journal, net);
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", state: "ERROR", ackedRevision: null });
    expect((await journal.readEvidence(DOC)).pending).toHaveLength(2);
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", ackedRevision: R0 + 1 });
    expect(net.calls[1]!.text).toBe(net.calls[0]!.text);
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", state: "SYNCED" });
    expect(sentSequence(net)).toEqual([1, 1, 2]);
  });

  it("3: a save while row 1 is in flight: its receipt clears row 1 only, no SYNCED, row 2 next", async () => {
    const journal = await started();
    await save(journal, SEG[0]!);
    const net = server(R0, async (body, accept) => {
      await save(journal, SEG[1]!);
      return accept(body);
    });
    const runner = runnerFor(journal, net);
    const first = await runner.step(DOC);
    expect(first).toMatchObject({ kind: "sent", ackedRevision: R0 + 1 });
    expect(first).not.toMatchObject({ state: "SYNCED" });
    const after = await journal.readEvidence(DOC);
    expect(after.pending.map((row) => row.tx.segmentHash)).toEqual([SEG[1]!.sha256]);
    expect(after.meta?.evidenceHead).toEqual({ segmentHash: SEG[0]!.sha256, lastSequenceTo: 1 });
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", state: "SYNCED" });
    expect(sentSequence(net)).toEqual([1, 2]);
  });

  it.each([
    ["a sound signature over another segment hash", (accept: (b: Body, o?: Partial<EvidenceReceiptPayloadV2>) => Response, body: Body) => accept(body, { segmentHash: "d".repeat(64) })],
    ["a key the open route never gave", (_accept: unknown, body: Body) => json(200, {
      status: "committed", revision: R0 + 1,
      receipt: { status: "signed", signedReceipt: receiptKey("kljuc-izmisljeni-tudi").sign({ documentId: DOC, clientTransactionId: body.clientTransactionId, revision: R0 + 1, segmentHash: SEG[0]!.sha256 }) },
    })],
    ["another evidence domain", (accept: (b: Body, o?: Partial<EvidenceReceiptPayloadV2>) => Response, body: Body) => accept(body, { evidenceDomainId: OTHER_DOMAIN })],
  ])("4: %s is no receipt: the row stays, the head stays, no SYNCED", async (_name, forge) => {
    const journal = await started();
    await save(journal, SEG[0]!);
    const net = server(R0, (body, accept) => forge(accept, body));
    const runner = runnerFor(journal, net);
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", state: "ERROR", ackedRevision: null });
    const { pending, meta } = await journal.readEvidence(DOC);
    expect(pending).toHaveLength(1);
    expect(meta?.evidenceHead).toEqual({ segmentHash: null, lastSequenceTo: 0 });
  });

  it("10: the request carries exactly the stored bytes and no time of any step", async () => {
    const journal = await started();
    await save(journal, SEG[0]!);
    const [row] = (await journal.readEvidence(DOC)).pending;
    expect(Object.keys(row!.tx).sort()).toEqual([
      "baseRevision", "clientTransactionId", "createdAt", "document", "kind", "segment", "segmentHash", "sequenceFrom", "sequenceTo",
    ]);
    expect(row!.tx.segment).toBeInstanceOf(Uint8Array);
    expect(row!.tx.segment).toEqual(SEG[0]!.bytes);
    expect(row!.tx.document).toEqual(SEG[0]!.document);
    const net = server();
    await runnerFor(journal, net).step(DOC);
    const [{ body, text }] = net.calls as [{ body: Body; text: string }];
    expect(Object.keys(body).sort()).toEqual(["baseRevision", "clientTransactionId", "document", "documentId", "segments"]);
    expect(body.segments).toHaveLength(1);
    expect(decodeBase64(body.segments[0])).toEqual(SEG[0]!.bytes);
    expect(decodeBase64(body.document)).toEqual(SEG[0]!.document);
    expect(text).not.toMatch(/stepOffsetsMs|timing/);
    const segment = JSON.parse(new TextDecoder().decode(decodeBase64(body.segments[0])!));
    // The only time on the wire: whole minutes in the segment.
    expect([segment.observedStartedAt, segment.observedEndedAt]).toEqual([
      expect.stringMatching(/:00\.000Z$/), expect.stringMatching(/:00\.000Z$/),
    ]);
  });

  it.each(["stale_base", "chain_conflict", "not_continuous"])("11: %s is CONFLICT; the row stays and nothing more is sent", async (status) => {
    const journal = await started();
    await save(journal, SEG[0]!);
    const net = server(R0, () => json(409, { status, currentRevision: 9 }));
    const runner = runnerFor(journal, net);
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", state: "CONFLICT" });
    expect(await runner.step(DOC)).toMatchObject({ kind: "stalled" });
    expect(net.calls).toHaveLength(1);
    expect((await journal.readEvidence(DOC)).pending[0]!.tx.segment).toEqual(SEG[0]!.bytes);
  });

  it("11: txid_reused is RECOVERY_REQUIRED with the row held as diverged", async () => {
    const journal = await started();
    await save(journal, SEG[0]!);
    const net = server(R0, () => json(409, { status: "txid_reused" }));
    const runner = runnerFor(journal, net);
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", state: "RECOVERY_REQUIRED" });
    expect((await journal.readEvidence(DOC)).meta?.awaitingReceipt).toMatchObject({ localSeq: 1, diverged: "txid_reused" });
    expect(await runner.step(DOC)).toMatchObject({ kind: "stalled" });
    expect(net.calls).toHaveLength(1);
  });

  it("12: the evidence transport sends no replacement row", async () => {
    let requests = 0;
    const transport = createEvidenceTransport(async () => { requests += 1; return json(200, {}); });
    const replace: DocumentTransaction = {
      kind: "REPLACE_DOCUMENT", clientTransactionId: "tx-zamjena", baseRevision: 0,
      document: emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000001"), createdAt: UTC,
    };
    expect(await transport(DOC, replace)).toEqual({ status: "invalid_document" });
    expect(requests).toBe(0);
  });

  it("15: after the recorder stops, earlier rows still drain and nothing is SYNCED", async () => {
    const journal = await started();
    for (const built of SEG.slice(0, 2)) await save(journal, built);
    await journal.saveUncovered(DOC, (await journal.readEvidence(DOC)).snapshot!.document, "gap", UTC, 2);
    const net = server();
    const runner = runnerFor(journal, net);
    await runner.step(DOC);
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", state: "LOCAL_DURABLE", ackedRevision: R0 + 2 });
    expect(await runner.step(DOC)).toEqual({ kind: "idle" });
    expect(sentSequence(net)).toEqual([1, 2]);
  });

  it("17: fifty rows, one segment per request, never two requests in flight", async () => {
    const journal = await started();
    for (const built of SEG) await save(journal, built);
    const net = server();
    const runner = runnerFor(journal, net);
    for (let round = 0; round < 60; round++) {
      const results = await Promise.all([runner.step(DOC), runner.step(DOC), runner.step(DOC)]);
      if (results.every((result) => result.kind === "idle")) break;
    }
    expect(net.maxInFlight).toBe(1);
    expect(net.calls.every(({ body }) => body.segments.length === 1)).toBe(true);
    expect(sentSequence(net)).toEqual(SEG.map((_, index) => index + 1));
    expect((await journal.readEvidence(DOC)).meta).toMatchObject({
      state: "SYNCED", evidenceHead: { segmentHash: SEG[49]!.sha256, lastSequenceTo: 50 },
    });
  });
});
