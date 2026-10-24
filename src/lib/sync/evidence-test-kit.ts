/**
 * Test kit for the evidence journal and drain (F-8 3d-2a): segments the real
 * recorder captures from the editor schema, receipts signed with an Ed25519
 * key made for the test, a fake commit route that does the server's
 * compare-and-set, and journals on fake-indexeddb. Imported by tests only;
 * every key, id and text is invented.
 */

import { createHash, generateKeyPairSync, sign as nodeSign } from "node:crypto";

import { Editor } from "@tiptap/core";
import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";

import { commitOutcomeFrom, createReceiptVerifier, decodeBase64, type FetchLike } from "@/client/evidence-ingest";
import type { EvidenceReceiptPayloadV2, SignedEvidenceReceiptV2 } from "@/domain/forensics/evidence-receipt";
import type { EvidenceDomainKey } from "@/domain/forensics/evidence-receipt-verifier";
import { loadGoldenVectors } from "@/domain/forensics/golden-vectors/load";
import { canonicalizeJcs, jcsUtf8Bytes } from "@/domain/forensics/jcs";
import { outcomeToEvents, type DrainOutcome, type QueuedRow } from "@/domain/sync/drain";
import type {
  EvidenceOpening, EvidenceSegmentTransaction, PendingTransaction, QueuedTransaction,
} from "@/domain/sync/journal-types";
import { syncReducer } from "@/domain/sync/states";
import { changeOf, EvidenceRecorder, type BuiltSegment } from "@/editor/capture";
import { tiptapToCanonical } from "@/editor/interop";
import { createEditorExtensions } from "@/editor/schema";
import { AtomicDexieJournal } from "@/lib/journal/atomic-dexie-journal";

import { createDrainRunner } from "./drain-runner";
import { createEvidenceTransport, evidenceVerifierFor } from "./evidence-transport";

const { receiptV2 } = loadGoldenVectors();
export const BASE = receiptV2.accepted[0]!.payload;
export const DOC = BASE.documentId;
export const DOMAIN = BASE.evidenceDomainId;
export const UTC = "2026-10-24T12:00:00.000Z";
export const R0 = 4;
export const deps = { indexedDB, IDBKeyRange };
export const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const T0 = Date.parse("2026-10-24T09:00:00.000Z");

export type Chain = { opened: EvidenceOpening; segments: BuiltSegment[] };

/**
 * `n` segments of one event each, typed into a fresh editor holding `text`,
 * chained from `sequenceFrom` and `predecessor`. `opened` is that editor's
 * starting document as the open route would report it at `revision`.
 */
export async function capture(
  n: number, sequenceFrom = 1, predecessor: string | null = null, text = "Uvod", revision = R0,
): Promise<Chain> {
  const editor = new Editor({
    element: null,
    extensions: createEditorExtensions(),
    content: { type: "doc", content: [{ type: "paragraph", attrs: { nodeId: "aaaaaaaa-0000-4000-8000-00000000000a" }, content: [{ type: "text", text }] }] },
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
  const head = predecessor;
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
    opened: {
      documentId: DOC, currentRevision: revision, documentHash: sha256(document),
      headSegmentHash: head, lastSequenceTo: sequenceFrom - 1, document,
    },
    segments,
  };
}

/** What the open route reports once `segment` is the server's head at `revision`. */
export function openedAfter(segment: BuiltSegment, revision: number): EvidenceOpening {
  return {
    documentId: DOC, currentRevision: revision, documentHash: sha256(segment.document),
    headSegmentHash: segment.sha256, lastSequenceTo: segment.segment.sequenceTo, document: segment.document,
  };
}

/** Journals on fake-indexeddb under scopes starting with `prefix`, deleted by `cleanup`. */
export function journalKit(prefix: string) {
  let serial = 0;
  const journals: AtomicDexieJournal[] = [];
  const scopes: string[] = [];
  const nextScope = () => {
    serial += 1;
    const scope = `${prefix}${serial.toString(16).padStart(63, "0")}`;
    scopes.push(scope);
    return scope;
  };
  const open = (scope = nextScope()) => {
    const journal = new AtomicDexieJournal(scope, deps);
    journals.push(journal);
    return journal;
  };
  const cleanup = async () => {
    for (const journal of journals.splice(0)) journal.close();
    for (const scope of new Set(scopes.splice(0))) await new Dexie(`ductus-journal-v1-${scope}`, deps).delete();
  };
  return { open, nextScope, cleanup };
}

export const raw = (journal: AtomicDexieJournal) => (journal as unknown as { db: Dexie }).db;

export async function save(journal: AtomicDexieJournal, built: BuiltSegment) {
  const seq = (await journal.readEvidence(DOC)).meta?.localSeq ?? 0;
  return journal.saveSegment(DOC, built, UTC, seq);
}

export function receiptKey(keyId: string, scope: Partial<EvidenceDomainKey> = {}) {
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

export const trusted = receiptKey("kljuc-izmisljeni-1");

/** The commit route's answer for the oldest owed row: committed at `revision`, signed over its segment. */
export function committed(revision: number, over: Partial<EvidenceReceiptPayloadV2> = {}, signer = trusted) {
  return (sent: PendingTransaction<EvidenceSegmentTransaction>): DrainOutcome => commitOutcomeFrom(200, {
    status: "committed", revision,
    receipt: { status: "signed", signedReceipt: signer.sign({ documentId: DOC, clientTransactionId: sent.tx.clientTransactionId, revision, segmentHash: sent.tx.segmentHash, ...over }) },
  });
}

/**
 * One answer for the oldest owed row, recorded as a drain step records it:
 * `beginSend`, the receipt checked against the row's own segment hash with
 * the trusted key, the state from the events, then `recordAnswer`.
 */
export async function answer(
  journal: AtomicDexieJournal, outcomeFor: (sent: PendingTransaction<EvidenceSegmentTransaction>) => DrainOutcome,
) {
  const sent = (await journal.readEvidence(DOC)).pending[0]!;
  await journal.beginSend(DOC, sent);
  const outcome = outcomeFor(sent);
  const after = await journal.readEvidence(DOC);
  const revision = (outcome as { revision?: unknown }).revision;
  const verify = createReceiptVerifier({ evidenceDomainId: DOMAIN, receiptKeys: [trusted.key] },
    (id) => (id === sent.tx.clientTransactionId ? sent.tx.segmentHash : null));
  const events = await outcomeToEvents(outcome, {
    expected: { documentId: DOC, clientTransactionId: sent.tx.clientTransactionId, revision: typeof revision === "number" ? revision : 0 },
    verify,
  }, { sent: sent as QueuedRow, pending: after.pending as QueuedRow[] });
  const state = events.reduce(syncReducer, syncReducer(after.meta!.state, { type: "SYNC_STARTED" }));
  return journal.recordAnswer(DOC, sent, outcome, state);
}

export const json = (status: number, body: unknown) => Response.json(body, { status });

export type Body = { documentId: string; clientTransactionId: string; baseRevision: number; segments: string[]; document: string };
type Accept = (body: Body, over?: Partial<EvidenceReceiptPayloadV2>) => Response;
export type Answer = (body: Body, accept: Accept) => Promise<Response | Error> | Response | Error;

/**
 * The commit route as far as the client can tell: a compare-and-set on the
 * revision from `revision`, one stored commit per key (a replay is
 * `duplicate`), and a receipt over the hash of the received segment.
 * `answers` replace the next answers.
 */
export function server(revision = R0, ...answers: Answer[]) {
  const calls: { body: Body; text: string }[] = [];
  const keys = new Map<string, number>();
  let inFlight = 0;
  let maxInFlight = 0;
  const accept: Accept = (body, over = {}) => {
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

export function runnerFor(journal: AtomicDexieJournal, net: ReturnType<typeof server>, keys = [trusted.key]) {
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
