// @vitest-environment node
import { createHash, generateKeyPairSync, sign as nodeSign } from "node:crypto";

import Dexie from "dexie";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";

import { emptyDocument, type DocumentTransaction } from "@/domain/document";
import { MAX_DOCUMENT_SNAPSHOT_BYTES } from "@/domain/document/snapshot";
import { MAX_EVIDENCE_SEGMENT_BYTES } from "@/domain/forensics/evidence-chain-v2";
import type { EvidenceReceiptPayloadV2, SignedEvidenceReceiptV2 } from "@/domain/forensics/evidence-receipt";
import type { EvidenceDomainKey } from "@/domain/forensics/evidence-receipt-verifier";
import { loadGoldenVectors } from "@/domain/forensics/golden-vectors/load";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import { AtomicDexieJournal } from "@/lib/journal/atomic-dexie-journal";
import { createDrainRunner } from "@/lib/sync/drain-runner";

import {
  commitEvidence,
  commitOutcomeFrom,
  createReceiptVerifier,
  decodeBase64,
  encodeBase64,
  openWork,
  openedWorkFrom,
  type FetchLike,
} from "./evidence-ingest";

/**
 * F-8 step 3c (DAN-37, plan #178): the client of the evidence routes. Every
 * key is made for the test and every id is invented.
 */

const { receiptV2 } = loadGoldenVectors();
const BASE = receiptV2.accepted[0]!.payload;
const DOC = BASE.documentId;
const DOMAIN = BASE.evidenceDomainId;
const SEGMENT = new TextEncoder().encode('{"izmisljeni":"odsjecak"}');
const SNAPSHOT = new TextEncoder().encode('{"izmisljeni":"dokument"}');
const SEGMENT_HASH = createHash("sha256").update(SEGMENT).digest("hex");

function receiptKey(keyId: string, scope: Partial<EvidenceDomainKey> = {}) {
  const pair = generateKeyPairSync("ed25519");
  const key: EvidenceDomainKey = {
    algorithm: "Ed25519",
    keyId,
    keyVersion: "1",
    encoding: "spki-der",
    keyBase64Url: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
    evidenceDomainId: DOMAIN,
    purpose: "receipt",
    validFrom: "2026-01-01T00:00:00.000Z",
    validTo: null,
    revokedAt: null,
    ...scope,
  };
  const sign = (over: Partial<EvidenceReceiptPayloadV2>): SignedEvidenceReceiptV2 => {
    const payload = { ...BASE, segmentHash: SEGMENT_HASH, ...over };
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

function openBody(over: Record<string, unknown> = {}) {
  return {
    status: "opened", documentId: DOC, evidenceProfileId: "profil-izmisljeni", currentRevision: 0,
    documentHash: "a".repeat(64), headSegmentHash: null, lastSequenceTo: 0,
    document: encodeBase64(SNAPSHOT), receiptKeys: [trusted.key], ...over,
  };
}

/** A fetch that answers each call with the next scripted response and records the requests. */
function scripted(...answers: (Response | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const next = answers.shift();
    if (next === undefined) throw new Error("unexpected request");
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetchImpl };
}

const json = (status: number, body: unknown) => Response.json(body, { status });
const committed = (status: "committed" | "duplicate", revision: number, signedReceipt: unknown) =>
  json(200, { status, revision, receipt: { status: "signed", signedReceipt } });

const INPUT = { documentId: DOC, clientTransactionId: BASE.clientTransactionId, baseRevision: 0, segment: SEGMENT, document: SNAPSHOT };

describe("F-8 3c: the commit envelope", () => {
  it("sends the exact bytes as padded base64 in a closed envelope with the protocol header", async () => {
    const { calls, fetchImpl } = scripted(committed("committed", BASE.revision, trusted.sign({})));
    await commitEvidence(INPUT, fetchImpl);
    const [{ url, init }] = calls as [{ url: string; init: RequestInit }];
    expect(url).toBe("/api/evidence/commit");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    expect(init.headers).toEqual({ "content-type": "application/json", "ductus-protocol": "1" });
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body).sort()).toEqual(["baseRevision", "clientTransactionId", "document", "documentId", "segments"]);
    expect(decodeBase64(body.segments[0])).toEqual(SEGMENT);
    expect(decodeBase64(body.document)).toEqual(SNAPSHOT);
    expect(body.segments).toHaveLength(1);
  });

  it("keeps a segment or snapshot over its limit and a malformed key on the device", async () => {
    const { calls, fetchImpl } = scripted();
    const big = (n: number) => new Uint8Array(n + 1);
    expect(await commitEvidence({ ...INPUT, segment: big(MAX_EVIDENCE_SEGMENT_BYTES) }, fetchImpl)).toEqual({ status: "too_large" });
    expect(await commitEvidence({ ...INPUT, document: big(MAX_DOCUMENT_SNAPSHOT_BYTES) }, fetchImpl)).toEqual({ status: "too_large" });
    expect(await commitEvidence({ ...INPUT, clientTransactionId: "" }, fetchImpl)).toEqual({ status: "invalid_client_transaction_id" });
    expect(calls).toEqual([]);
  });

  it("round-trips bytes of every value through base64 and refuses a second spelling", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
    expect(decodeBase64("QQ")).toBeNull();
    expect(decodeBase64("QR==")).toBeNull();
    expect(decodeBase64("QQ==\n")).toBeNull();
  });
});

describe("F-8 3c: every answer of 4.13 t. 4 as a drain outcome", () => {
  const state = { currentRevision: 4, documentHash: "b".repeat(64), headSegmentHash: null, lastSequenceTo: 3 };
  it.each([
    [409, { status: "stale_base", ...state }, { status: "stale_base", currentRevision: 4 }],
    [409, { status: "chain_conflict", ...state }, { status: "stale_base", currentRevision: 4 }],
    [409, { status: "not_continuous", ...state }, { status: "stale_base", currentRevision: 4 }],
    [409, { status: "stale_base" }, { status: "invalid" }],
    [409, { status: "txid_reused" }, { status: "txid_reused" }],
    [422, { status: "invalid" }, { status: "invalid_document" }],
    [422, { status: "document_mismatch" }, { status: "invalid_document" }],
    [413, { status: "too_large" }, { status: "too_large" }],
    [404, { status: "not_found" }, { status: "not_found" }],
    [409, { status: "not_accepting" }, { status: "not_found" }],
    [401, { status: "unauthenticated" }, { status: "unauthenticated" }],
    [503, { status: "unavailable", stage: "signing" }, { status: "transport_error" }],
    [502, null, { status: "transport_error" }],
    [408, { status: "timeout" }, { status: "transport_error" }],
    [408, { status: "committed" }, { status: "invalid" }],
    [426, { status: "upgrade_required" }, { status: "invalid" }],
    [404, { status: "unauthenticated" }, { status: "invalid" }],
    [200, { status: "stale_base", currentRevision: 1 }, { status: "invalid" }],
    [200, { status: "committed", revision: 1 }, { status: "invalid" }],
    [200, { status: "signed_by_proxy" }, { status: "invalid" }],
    [400, { status: "bad_request" }, { status: "invalid" }],
  ])("HTTP %i %j → %j", (http, body, expected) => {
    expect(commitOutcomeFrom(http, body)).toEqual(expected);
  });

  it("a lost answer is a transport error, never a refusal", async () => {
    const { fetchImpl } = scripted(new TypeError("Failed to fetch"));
    expect(await commitEvidence(INPUT, fetchImpl)).toEqual({ status: "transport_error" });
    const cut = scripted(new Response("<html>", { status: 504 }));
    expect(await commitEvidence(INPUT, cut.fetchImpl)).toEqual({ status: "transport_error" });
    const garbled = scripted(new Response("{", { status: 200 }));
    expect(await commitEvidence(INPUT, garbled.fetchImpl)).toEqual({ status: "invalid" });
  });
});

describe("F-8 3c: the open route", () => {
  it("reads the work, its snapshot bytes and the domain of its receipt keys", async () => {
    const { calls, fetchImpl } = scripted(json(200, openBody()));
    const opened = await openWork("11111111-1111-4111-8111-111111111111", fetchImpl);
    expect(opened).toMatchObject({ status: "opened", work: { documentId: DOC, evidenceDomainId: DOMAIN, document: SNAPSHOT } });
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ assignmentId: "11111111-1111-4111-8111-111111111111" });
  });

  it.each([
    ["an unknown key", openBody({ package: "x" })],
    ["a missing key", Object.fromEntries(Object.entries(openBody()).filter(([key]) => key !== "headSegmentHash"))],
    ["no receipt key", openBody({ receiptKeys: [] })],
    ["keys of two domains", openBody({ receiptKeys: [trusted.key, { ...trusted.key, keyId: "k2", evidenceDomainId: "druga" }] })],
    ["a checkpoint key", openBody({ receiptKeys: [{ ...trusted.key, purpose: "checkpoint" }] })],
    ["a snapshot in a second spelling", openBody({ document: "QR==" })],
    ["a fractional revision", openBody({ currentRevision: 1.5 })],
    ["a short hash", openBody({ documentHash: "a" })],
    // #733: the profile rule of the journal and segment v2.
    ["a profile of only spaces", openBody({ evidenceProfileId: "   " })],
    ["a profile of 121 UTF-16 units", openBody({ evidenceProfileId: "p".repeat(121) })],
    ["a profile with a lone surrogate", openBody({ evidenceProfileId: "profil-\uD83D" })],
  ])("refuses %s", (_name, body) => {
    expect(openedWorkFrom(body)).toBeNull();
  });

  it("a profile of 60 characters outside the BMP (120 units) is read (#733)", () => {
    expect(openedWorkFrom(openBody({ evidenceProfileId: "\u{1F4D6}".repeat(60) }))?.evidenceProfileId)
      .toBe("\u{1F4D6}".repeat(60));
  });

  it("an answer with a refused profile is unavailable at open (#733)", async () => {
    const { fetchImpl } = scripted(json(200, openBody({ evidenceProfileId: "   " })));
    expect(await openWork("11111111-1111-4111-8111-111111111111", fetchImpl)).toEqual({ status: "unavailable" });
  });

  it.each([
    [401, { status: "unauthenticated" }, "unauthenticated"],
    [404, { status: "not_found" }, "not_found"],
    [409, { status: "not_accepting" }, "not_accepting"],
    [426, { status: "upgrade_required" }, "upgrade_required"],
    [503, { status: "unavailable", stage: "context" }, "unavailable"],
    [200, { status: "opened" }, "unavailable"],
  ])("HTTP %i → %s", async (http, body, status) => {
    expect(await openWork("x", scripted(json(http, body)).fetchImpl)).toEqual({ status });
  });

  it("no network is unavailable", async () => {
    expect(await openWork("x", scripted(new TypeError("offline")).fetchImpl)).toEqual({ status: "unavailable" });
  });
});

describe("F-8 3c: the receipt verifier (plan #178 attack 1)", () => {
  const work = { evidenceDomainId: DOMAIN, receiptKeys: [trusted.key] };
  const verify = createReceiptVerifier(work, (txid) => (txid === BASE.clientTransactionId ? SEGMENT_HASH : null));
  const expected = { documentId: DOC, clientTransactionId: BASE.clientTransactionId, revision: BASE.revision };

  it("accepts a receipt of a key from the open route for the sent segment", async () => {
    expect(await verify(trusted.sign({}), expected)).toBe(true);
  });

  it.each([
    ["another document", { documentId: "dokument-drugi" }],
    ["another transaction", { clientTransactionId: "tx-drugi" }],
    ["another revision", { revision: BASE.revision + 1 }],
    ["another segment", { segmentHash: "c".repeat(64) }],
    ["another domain", { evidenceDomainId: "domena-druga" }],
  ])("refuses a validly signed receipt for %s", async (_name, over) => {
    expect(await verify(trusted.sign(over as Partial<EvidenceReceiptPayloadV2>), expected)).toBe(false);
  });

  it("refuses a key the receipt brings, a revoked key and an unknown transaction", async () => {
    const stranger = receiptKey("kljuc-izmisljeni-2");
    expect(await verify(stranger.sign({}), expected)).toBe(false);
    const revoked = receiptKey("kljuc-izmisljeni-3", { revokedAt: "2026-02-01T00:00:00.000Z" });
    const withRevoked = createReceiptVerifier({ evidenceDomainId: DOMAIN, receiptKeys: [revoked.key] }, () => SEGMENT_HASH);
    expect(await withRevoked(revoked.sign({}), expected)).toBe(false);
    const forgetful = createReceiptVerifier(work, () => null);
    expect(await forgetful(trusted.sign({}), expected)).toBe(false);
    const throwing = createReceiptVerifier(work, () => {
      throw new Error("x");
    });
    expect(await throwing(trusted.sign({}), expected)).toBe(false);
  });
});

describe("F-8 3c: state transitions through the drain runner and the real journal", () => {
  const deps = { indexedDB, IDBKeyRange };
  const journals: AtomicDexieJournal[] = [];
  const scopes: string[] = [];
  let serial = 0;
  afterEach(async () => {
    for (const journal of journals.splice(0)) journal.close();
    for (const scope of scopes.splice(0)) await new Dexie(`ductus-journal-v1-${scope}`, deps).delete();
  });

  async function setup(...answers: (Response | Error)[]) {
    serial += 1;
    // A prefix no other journal test file uses.
    const scope = `7${serial.toString(16).padStart(63, "0")}`;
    scopes.push(scope);
    const journal = new AtomicDexieJournal(scope, deps);
    journals.push(journal);
    const tx: DocumentTransaction = {
      kind: "REPLACE_DOCUMENT", clientTransactionId: BASE.clientTransactionId, baseRevision: BASE.revision - 1,
      document: emptyDocument(() => "aaaaaaaa-0000-4000-8000-000000000001"), createdAt: "2026-10-09T12:00:00.000Z",
    };
    await journal.saveLocal(DOC, tx, "2026-10-09T12:00:00.000Z", 0);
    const net = scripted(...answers);
    let clock = 0;
    const runner = createDrainRunner({
      journal,
      // The segment bytes are fixed here: capture into the journal is step 3d.
      transport: (documentId, row) => commitEvidence({ ...INPUT, documentId, clientTransactionId: row.clientTransactionId, baseRevision: row.baseRevision }, net.fetchImpl),
      verify: createReceiptVerifier({ evidenceDomainId: DOMAIN, receiptKeys: [trusted.key] }, () => SEGMENT_HASH),
      now: () => (clock += 60_000),
      jitter: () => 0.5,
    });
    return { journal, runner, net };
  }

  it("reaches SYNCED only with a verified receipt", async () => {
    const { journal, runner } = await setup(committed("committed", BASE.revision, trusted.sign({ segmentHash: "d".repeat(64) })), committed("duplicate", BASE.revision, trusted.sign({})));
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", state: "ERROR" });
    expect((await journal.read(DOC)).pending).toHaveLength(1);
    expect(await runner.step(DOC, { manual: true })).toMatchObject({ kind: "sent", state: "SYNCED", ackedRevision: BASE.revision });
    expect((await journal.read(DOC)).pending).toEqual([]);
  });

  it("after a lost answer replays the same key and takes the duplicate without a second row", async () => {
    const { journal, runner, net } = await setup(new TypeError("offline"), json(503, { status: "unavailable", stage: "storage" }), committed("duplicate", BASE.revision, trusted.sign({})));
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", state: "ERROR" });
    expect((await journal.read(DOC)).pending).toHaveLength(1);
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", state: "ERROR" });
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", state: "SYNCED" });
    const keys = net.calls.map(({ init }) => JSON.parse(init.body as string).clientTransactionId);
    expect(keys).toEqual([BASE.clientTransactionId, BASE.clientTransactionId, BASE.clientTransactionId]);
    expect(await runner.step(DOC)).toEqual({ kind: "idle" });
  });

  it("a conflict of the chain is CONFLICT, never an overwrite or a retry", async () => {
    const { runner, net } = await setup(json(409, { status: "chain_conflict", currentRevision: 9, documentHash: "b".repeat(64), headSegmentHash: null, lastSequenceTo: 3 }));
    expect(await runner.step(DOC)).toMatchObject({ kind: "sent", state: "CONFLICT" });
    expect(await runner.step(DOC)).toMatchObject({ kind: "stalled" });
    expect(net.calls).toHaveLength(1);
  });
});
