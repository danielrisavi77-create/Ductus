// @vitest-environment node
import { createHash, generateKeyPairSync, sign as nodeSign } from "node:crypto";

import { Editor } from "@tiptap/core";
import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { decodeBase64, type FetchLike } from "@/client/evidence-ingest";
import { emptyDocument, type DocumentTransaction } from "@/domain/document";
import { MAX_DOCUMENT_SNAPSHOT_BYTES } from "@/domain/document/snapshot";
import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";
import type { EvidenceReceiptPayloadV2, SignedEvidenceReceiptV2 } from "@/domain/forensics/evidence-receipt";
import type { EvidenceDomainKey } from "@/domain/forensics/evidence-receipt-verifier";
import { loadGoldenVectors } from "@/domain/forensics/golden-vectors/load";
import { canonicalizeJcs, jcsUtf8Bytes } from "@/domain/forensics/jcs";
import type { EvidenceOpening, QueuedTransaction } from "@/domain/sync/journal-types";
import { changeOf, EvidenceRecorder, type BuiltSegment } from "@/editor/capture";
import { tiptapToCanonical } from "@/editor/interop";
import { createEditorExtensions } from "@/editor/schema";
import { AtomicDexieJournal } from "@/lib/journal/atomic-dexie-journal";

import { createDrainRunner } from "./drain-runner";
import { createEvidenceTransport, evidenceVerifierFor } from "./evidence-transport";

/**
 * F-8 3d-2a (DAN-285, contract #476 c.6384736095): the journal v3 and the drain
 * of evidence segments, over segments the real recorder captured from the
 * editor schema, the real commit client with a fake `fetch` that does the
 * server's compare-and-set, and receipts signed with a real Ed25519 key.
 * Every key, id and text is invented.
 */

const { receiptV2 } = loadGoldenVectors();
const BASE = receiptV2.accepted[0]!.payload;
const DOC = BASE.documentId;
const DOMAIN = BASE.evidenceDomainId;
const OTHER_DOMAIN = "99999999-9999-4999-8999-999999999999";
const UTC = "2026-10-24T12:00:00.000Z";
const T0 = Date.parse("2026-10-24T09:00:00.000Z");
const R0 = 4;
const deps = { indexedDB, IDBKeyRange };
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// ---- the recorder ---------------------------------------------------------

type Chain = { opened: EvidenceOpening; segments: BuiltSegment[] };

/** `n` segments of one event each, chained from `sequenceFrom` and `predecessor`. */
async function capture(n: number, sequenceFrom = 1, predecessor: string | null = null): Promise<Chain> {
  const editor = new Editor({
    element: null,
    extensions: createEditorExtensions(),
    content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "aaaaaaaa-0000-4000-8000-00000000000a" }, content: [{ type: "text", text: "Uvod" }] }] },
  });
  editor.view.updateState(editor.state.reconfigure({ plugins: editor.extensionManager.plugins }));
  const initial = tiptapToCanonical(editor.getJSON());
  if (!initial.ok) throw new Error("test document is not canonical");
  const document = jcsUtf8Bytes(initial.doc);
  const recorder = new EvidenceRecorder();
  let at = T0;
  editor.on("transaction", ({ transaction, appendedTransactions }) => {
    const all = [transaction, ...appendedTransactions];
    if (all.some((tr) => tr.docChanged)) recorder.record(changeOf(all, "editor", at));
  });
  const segments: BuiltSegment[] = [];
  for (let i = 0; i < n; i++) {
    at += 1_000;
    editor.view.dispatch(editor.state.tr.insertText(String.fromCharCode(97 + (i % 26))));
    recorder.close();
    const built = await recorder.takeSegment({
      documentId: DOC,
      sessionId: "11111111-1111-4111-8111-111111111111",
      segmentId: `22222222-2222-4222-8222-${(sequenceFrom + i).toString().padStart(12, "0")}`,
      evidenceProfileId: "profil-izmisljeni",
      sequenceFrom: sequenceFrom + i,
      predecessorSegmentHash: predecessor,
    });
    if (built === null) throw new Error("no segment");
    segments.push(built);
    predecessor = built.sha256;
  }
  editor.destroy();
  return {
    opened: { documentId: DOC, currentRevision: R0, documentHash: sha256(document), headSegmentHash: null, lastSequenceTo: 0, document },
    segments,
  };
}

let chain: Chain;
let SEG: BuiltSegment[];
beforeAll(async () => {
  chain = await capture(50);
  SEG = chain.segments;
}, 60_000);

// ---- the journal ------------------------------------------------------------

let serial = 0;
const journals: AtomicDexieJournal[] = [];
const scopes: string[] = [];

function nextScope(): string {
  serial += 1;
  // A prefix no other journal test file uses, so the files never share a database.
  const scope = `8${serial.toString(16).padStart(63, "0")}`;
  scopes.push(scope);
  return scope;
}
function open(scope = nextScope()): AtomicDexieJournal {
  const journal = new AtomicDexieJournal(scope, deps);
  journals.push(journal);
  return journal;
}
const raw = (journal: AtomicDexieJournal) => (journal as unknown as { db: Dexie }).db;

afterEach(async () => {
  for (const journal of journals.splice(0)) journal.close();
  for (const scope of new Set(scopes.splice(0))) await new Dexie(`ductus-journal-v1-${scope}`, deps).delete();
});

async function started(): Promise<AtomicDexieJournal> {
  const journal = open();
  await journal.startEvidence(DOC, chain.opened, UTC);
  return journal;
}
async function save(journal: AtomicDexieJournal, built: BuiltSegment) {
  const seq = (await journal.readEvidence(DOC)).meta?.localSeq ?? 0;
  return journal.saveSegment(DOC, built, UTC, seq);
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

// ---- the server -------------------------------------------------------------

function receiptKey(keyId: string, scope: Partial<EvidenceDomainKey> = {}) {
  const pair = generateKeyPairSync("ed25519");
  const key: EvidenceDomainKey = {
    algorithm: "Ed25519", keyId, keyVersion: "1", encoding: "spki-der",
    keyBase64Url: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
    evidenceDomainId: DOMAIN, purpose: "receipt",
    validFrom: "2026-01-01T00:00:00.000Z", validTo: null, revokedAt: null, ...scope,
  };
  const sign = (over: Partial<EvidenceReceiptPayloadV2>): SignedEvidenceReceiptV2 => {
    const payload = { ...BASE, ...over };
    const digest = createHash("sha256").update(canonicalizeJcs(payload), "utf8").digest();
    const input = Buffer.concat([Buffer.from("ductus-evidence-receipt-v2\n"), digest]);
    return {
      payload,
      payloadDigestSha256: digest.toString("hex"),
      signature: {
        algorithm: "Ed25519", keyId, keyVersion: "1", signatureEncoding: "raw",
        signatureBase64Url: nodeSign(null, input, pair.privateKey).toString("base64url"),
      },
    };
  };
  return { key, sign };
}
const trusted = receiptKey("kljuc-izmisljeni-1");
const json = (status: number, body: unknown) => Response.json(body, { status });

type Body = { documentId: string; clientTransactionId: string; baseRevision: number; segments: string[]; document: string };
type Answer = (body: Body, accept: (body: Body, over?: Partial<EvidenceReceiptPayloadV2>) => Response) => Promise<Response | Error> | Response | Error;

/**
 * The commit route as far as the client can tell: a compare-and-set on the
 * revision, one stored commit per key (a replay is `duplicate`), and a receipt
 * over the hash of the received segment. `answers` replace the next answers.
 */
function server(...answers: Answer[]) {
  const calls: { body: Body; text: string }[] = [];
  const keys = new Map<string, number>();
  let revision = R0;
  let inFlight = 0;
  let maxInFlight = 0;
  const accept = (body: Body, over: Partial<EvidenceReceiptPayloadV2> = {}): Response => {
    const segmentHash = sha256(decodeBase64(body.segments[0])!);
    const known = keys.get(body.clientTransactionId);
    if (known === undefined && body.baseRevision !== revision) {
      return json(409, { status: "stale_base", currentRevision: revision });
    }
    if (known === undefined) keys.set(body.clientTransactionId, (revision += 1));
    const committed = keys.get(body.clientTransactionId)!;
    const signedReceipt = trusted.sign({ documentId: DOC, clientTransactionId: body.clientTransactionId, revision: committed, segmentHash, ...over });
    return json(200, { status: known === undefined ? "committed" : "duplicate", revision: committed, receipt: { status: "signed", signedReceipt } });
  };
  const fetchImpl: FetchLike = async (_url, init) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const text = init.body as string;
      const body = JSON.parse(text) as Body;
      calls.push({ body, text });
      await Promise.resolve();
      const next = answers.shift();
      const answer = next ? await next(body, accept) : accept(body);
      if (answer instanceof Error) throw answer;
      return answer;
    } finally {
      inFlight -= 1;
    }
  };
  return { calls, fetchImpl, accept, get maxInFlight() { return maxInFlight; } };
}

function runnerFor(journal: AtomicDexieJournal, net: ReturnType<typeof server>, keys = [trusted.key]) {
  let clock = 0;
  return createDrainRunner<QueuedTransaction>({
    journal,
    transport: createEvidenceTransport(net.fetchImpl),
    verifyFor: evidenceVerifierFor({ evidenceDomainId: DOMAIN, receiptKeys: keys }),
    // Every step is past any backoff, so only the plan decides what goes.
    now: () => (clock += 60_000),
    jitter: () => 0.5,
  });
}
const sentSequence = (net: ReturnType<typeof server>) =>
  net.calls.map(({ body }) => SEG.findIndex((s) => s.sha256 === sha256(decodeBase64(body.segments[0])!)) + 1);

// ---- the drain --------------------------------------------------------------

describe("F-8 3d-2a: segments drain in order", () => {
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
    const net = server((body, accept) => {
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
    const net = server(async (body, accept) => {
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
    const net = server((body, accept) => forge(accept, body));
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
    const net = server(() => json(409, { status, currentRevision: 9 }));
    const runner = runnerFor(journal, net);
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", state: "CONFLICT" });
    expect(await runner.step(DOC)).toMatchObject({ kind: "stalled" });
    expect(net.calls).toHaveLength(1);
    expect((await journal.readEvidence(DOC)).pending[0]!.tx.segment).toEqual(SEG[0]!.bytes);
  });

  it("11: txid_reused is RECOVERY_REQUIRED with the row held as diverged", async () => {
    const journal = await started();
    await save(journal, SEG[0]!);
    const net = server(() => json(409, { status: "txid_reused" }));
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

// ---- the journal ------------------------------------------------------------

describe("F-8 3d-2a: journal v3", () => {
  it("13: startEvidence sets snapshot, revision and head; again only on an empty queue", async () => {
    const journal = await started();
    const first = await journal.readEvidence(DOC);
    expect(first.snapshot).toMatchObject({ revision: R0, savedAt: UTC });
    expect(jcsUtf8Bytes(first.snapshot!.document)).toEqual(chain.opened.document);
    expect(first.meta).toMatchObject({ localSeq: 0, evidenceHead: { segmentHash: null, lastSequenceTo: 0 } });
    await save(journal, SEG[0]!);
    await refuses(journal, "queue_not_empty", () => journal.startEvidence(DOC, chain.opened, UTC));
    await runnerFor(journal, server()).step(DOC);
    const reopened = { ...chain.opened, currentRevision: R0 + 1, headSegmentHash: SEG[0]!.sha256, lastSequenceTo: 1, document: SEG[0]!.document, documentHash: sha256(SEG[0]!.document) };
    expect(await journal.startEvidence(DOC, reopened, UTC)).toMatchObject({
      state: "SYNCED", localSeq: 1, evidenceHead: { segmentHash: SEG[0]!.sha256, lastSequenceTo: 1 },
    });
    await expect(open().startEvidence(DOC, { ...chain.opened, documentHash: "a".repeat(64) }, UTC)).rejects.toMatchObject({ code: "invalid_input" });
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
    await runnerFor(journal, server(() => json(409, { status: "stale_base", currentRevision: 9 }))).step(DOC);
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

  it("8: a version 2 database opens as version 3 with its rows, snapshot, meta and fence", async () => {
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
    expect(raw(journal).verno).toBe(3);
    expect(await raw(journal).table("timings").count()).toBe(0);
  });

  it("9: an owed segment blocks logout; the timing record does not, and goes with the database", async () => {
    const opened = open();
    await opened.startEvidence(DOC, chain.opened, UTC);
    await opened.destroyForLogout();
    const journal = await started();
    await save(journal, SEG[0]!);
    await expect(journal.destroyForLogout()).rejects.toMatchObject({ code: "unsynced_work" });
    await runnerFor(journal, server()).step(DOC);
    expect(await raw(journal).table("timings").get(SEG[0]!.sha256)).toEqual({
      segmentHash: SEG[0]!.sha256, documentId: DOC, sequenceFrom: 1, events: SEG[0]!.timing.events,
    });
    const scope = raw(journal).name.slice("ductus-journal-v1-".length);
    await journal.destroyForLogout();
    const after = open(scope);
    expect(await after.readEvidence(DOC)).toEqual({ snapshot: null, pending: [], meta: null });
    expect(await raw(after).table("timings").count()).toBe(0);
  });

  it("15: after the recorder stops, text is saved without evidence, earlier rows drain, no SYNCED, logout blocked", async () => {
    const journal = await started();
    for (const built of SEG.slice(0, 2)) await save(journal, built);
    const later = (await journal.readEvidence(DOC)).snapshot!.document;
    await journal.saveUncovered(DOC, later, "gap", UTC, 2);
    await refuses(journal, "evidence_stopped", () => journal.saveSegment(DOC, SEG[2]!, UTC, 3));
    expect((await journal.readEvidence(DOC)).meta).toMatchObject({ evidenceStopped: "gap", localSeq: 3, state: "LOCAL_DURABLE" });
    const net = server();
    const runner = runnerFor(journal, net);
    await runner.step(DOC);
    const last = await runner.step(DOC);
    expect(sentSequence(net)).toEqual([1, 2]);
    expect(last).toMatchObject({ kind: "sent", state: "LOCAL_DURABLE", ackedRevision: R0 + 2 });
    const { pending, meta } = await journal.readEvidence(DOC);
    expect(pending).toEqual([]);
    expect(meta?.evidenceHead).toEqual({ segmentHash: SEG[1]!.sha256, lastSequenceTo: 2 });
    await expect(journal.startEvidence(DOC, chain.opened, UTC)).rejects.toMatchObject({ code: "evidence_stopped" });
    await expect(journal.destroyForLogout()).rejects.toMatchObject({ code: "unsynced_work" });
  });
});
