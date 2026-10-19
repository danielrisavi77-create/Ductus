import { generateKeyPairSync, sign as nodeSign } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { EvidenceSegmentDescriptorV2 } from "@/application/ports/evidence-ingest";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import type { EvidenceReceiptPayloadV2 } from "@/domain/forensics/evidence-receipt";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import type { SignatureEnvelope } from "@/domain/forensics/signature";
import type { ActorTransaction, WithActor } from "@/server/db/with-actor";

import {
  commitEvidenceSegment,
  readEvidenceCommitContext,
  type EvidenceCommitContext,
  type EvidenceCommitInput,
} from "./evidence-commit";

// Invented ids, hashes and a key made for this test only.
const DOMAIN = "00000000-0000-4000-8000-0000000000d1";
const INSTITUTION = "00000000-0000-4000-8000-0000000000a1";
const RECEIPT = "00000000-0000-4000-8000-0000000000c1";
const HASH = "b".repeat(64);
const CONTEXT: EvidenceCommitContext = {
  evidencePackageId: "pkg-1",
  institutionId: INSTITUTION,
  evidenceDomainId: DOMAIN,
  evidenceProfileId: "standard-v1",
  maxPayloadBytes: 262144,
  transactionKnown: false,
};
const DESCRIPTOR: EvidenceSegmentDescriptorV2 = {
  evidencePackageId: "pkg-1",
  documentId: "doc-1",
  sessionId: "session-1",
  segmentId: "segment-1",
  evidenceSchema: "ductus-evidence-segment-v2",
  canonicalization: "RFC8785-JCS",
  hashAlgorithm: "sha256",
  evidenceProfileId: "standard-v1",
  sequenceFrom: 1,
  sequenceTo: 1,
  eventCount: 1,
  observedStartedAt: "2026-10-19T06:00:00.000Z",
  observedEndedAt: "2026-10-19T06:00:00.000Z",
  segmentHash: HASH,
  predecessorSegmentHash: null,
  payloadBytes: 123,
};
const INPUT: EvidenceCommitInput = {
  context: CONTEXT,
  documentId: "doc-1",
  clientTransactionId: "tx-1",
  baseRevision: 0,
  initialDocumentHash: "c".repeat(64),
  finalDocumentHash: "d".repeat(64),
  descriptor: DESCRIPTOR,
  storageRef: "local-demo:v2/x/pkg-1/b.json",
  snapshot: "{}",
};
const PAYLOAD: EvidenceReceiptPayloadV2 = {
  receiptSchema: "ductus-evidence-receipt-v2",
  receiptId: RECEIPT,
  evidenceDomainId: DOMAIN,
  evidencePackageId: "pkg-1",
  documentId: "doc-1",
  revision: 1,
  clientTransactionId: "tx-1",
  principalId: "00000000-0000-4000-8000-0000000000e1",
  sessionId: "session-1",
  segmentId: "segment-1",
  segmentHash: HASH,
  predecessorSegmentHash: null,
  previousReceiptId: null,
  evidenceSchema: "ductus-evidence-segment-v2",
  evidenceProfileId: "standard-v1",
  sequenceFrom: 1,
  sequenceTo: 1,
  eventCount: 1,
  payloadBytes: 123,
  acceptedAt: "2026-10-19T06:00:00.000Z",
};
const TEXT = canonicalizeJcs(PAYLOAD);

const pair = generateKeyPairSync("ed25519");
const KEY = { keyId: "test-key-1", keyVersion: "1" };
const KEY_ROW = {
  key_id: KEY.keyId,
  key_version: KEY.keyVersion,
  evidence_domain_id: DOMAIN,
  purpose: "receipt",
  algorithm: "Ed25519",
  key_base64url: pair.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
  valid_from: "2026-10-19T05:00:00.000Z",
  valid_to: null,
  revoked_at: null,
};

function sign(message: Uint8Array): SignatureEnvelope {
  return {
    algorithm: "Ed25519",
    ...KEY,
    signatureEncoding: "raw",
    signatureBase64Url: nodeSign(null, Buffer.from(message), pair.privateKey).toString("base64url"),
  };
}

function signer(behaviour: (message: Uint8Array) => Promise<SignatureEnvelope> = async (m) => sign(m)) {
  const calls: Uint8Array[] = [];
  const provider: SigningKeyProvider = {
    sign: (message) => {
      calls.push(message);
      return behaviour(message);
    },
    verify: async () => true,
    publicVerificationKey: () => Promise.reject(new Error("unused")),
  };
  return { provider, calls };
}

type Script = { commit: unknown[]; keys?: unknown[]; attach?: unknown[] };

/** A withActor whose transaction answers by statement and records what ran and how it ended. */
function database(script: Script, failAt?: "commit") {
  const ran: string[] = [];
  const ended: string[] = [];
  const withActor: WithActor = async (_token, fn) => {
    const tx: ActorTransaction = {
      async query(text) {
        const kind = text.includes("commit_evidence_segment")
          ? "commit"
          : text.includes("attach_receipt_signature")
            ? "attach"
            : text.includes("signing_key")
              ? "keys"
              : "context";
        ran.push(kind);
        if (failAt === kind) throw new Error("connection reset: secret detail");
        const rows = (kind === "context" ? script.commit : (script[kind as keyof Script] ?? [])) as never[];
        return { rows, rowCount: rows.length };
      },
    };
    try {
      const result = await fn(tx);
      ended.push("commit");
      return result;
    } catch (error) {
      ended.push("rollback");
      throw error;
    }
  };
  return { withActor, ran, ended };
}

const reserved = (extra: Record<string, unknown> = {}) => ({
  outcome: "reserved",
  committed_revision: "1",
  receipt_payload: TEXT,
  receipt_id: RECEIPT,
  signature: null,
  ...extra,
});

async function storedSignature() {
  const { digestEvidenceReceiptPayloadV2 } = await import("@/domain/forensics/evidence-receipt");
  const digest = await digestEvidenceReceiptPayloadV2(PAYLOAD);
  // jsonb gives the keys in its own order; the answer must not depend on it.
  const { keyId, algorithm, keyVersion, signatureBase64Url, signatureEncoding } = sign(digest.signingInput);
  return { keyId, algorithm, keyVersion, signatureBase64Url, signatureEncoding };
}

describe("readEvidenceCommitContext", () => {
  const row = {
    outcome: "ok",
    evidence_package_id: "pkg-1",
    institution_id: INSTITUTION,
    evidence_domain_id: DOMAIN,
    evidence_profile_id: "standard-v1",
    max_payload_bytes: 262144,
    transaction_known: false,
  };

  it("returns the context the database resolved", async () => {
    const db = database({ commit: [row] });
    expect(await readEvidenceCommitContext(db.withActor, "t", "doc-1", "tx-1")).toEqual({ status: "ok", context: CONTEXT });
  });

  it.each(["unauthenticated", "not_found", "invalid"])("passes %s through", async (outcome) => {
    const db = database({ commit: [{ outcome }] });
    expect(await readEvidenceCommitContext(db.withActor, null, "doc-1", "tx-1")).toEqual({ status: outcome });
  });

  it.each([
    ["no row", []],
    ["two rows", [row, row]],
    ["an unknown outcome", [{ ...row, outcome: "found" }]],
    ["a package id of another form", [{ ...row, evidence_package_id: "PKG/1" }]],
    ["a domain that is no v4 uuid", [{ ...row, evidence_domain_id: "local" }]],
    ["an institution that is no uuid", [{ ...row, institution_id: null }]],
    ["an empty profile", [{ ...row, evidence_profile_id: "" }]],
    ["a limit of 0", [{ ...row, max_payload_bytes: 0 }]],
    // review467a: a limit that is not a whole number never passes as one.
    ["a limit that is not whole", [{ ...row, max_payload_bytes: 1.5 }]],
    ["a limit given as text", [{ ...row, max_payload_bytes: "262144" }]],
    ["a known flag that is no boolean", [{ ...row, transaction_known: "f" }]],
  ])("is unavailable for %s", async (_, rows) => {
    const db = database({ commit: rows });
    expect(await readEvidenceCommitContext(db.withActor, "t", "doc-1", "tx-1")).toEqual({
      status: "unavailable",
      stage: "context",
      code: "context_malformed",
    });
  });

  it("is unavailable with a closed code when the database fails", async () => {
    const failing: WithActor = () => Promise.reject(new Error("secret detail"));
    expect(await readEvidenceCommitContext(failing, "t", "doc-1", "tx-1")).toEqual({
      status: "unavailable",
      stage: "context",
      code: "context_failed",
    });
  });
});

describe("commitEvidenceSegment", () => {
  it("signs the reserved receipt, verifies it under the registry key and attaches it in the same transaction", async () => {
    const db = database({ commit: [reserved()], keys: [KEY_ROW], attach: [{ outcome: "signed" }] });
    const s = signer();
    const outcome = await commitEvidenceSegment({ withActor: db.withActor, signer: s.provider }, "t", INPUT);
    expect(outcome).toMatchObject({ status: "committed", revision: 1, signedReceipt: { payload: PAYLOAD } });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].byteLength).toBe(59);
    expect(db.ran).toEqual(["commit", "keys", "attach"]);
    expect(db.ended).toEqual(["commit"]);
  });

  it("answers a signed retry with the stored receipt, byte for byte, without signing or attaching", async () => {
    const first = await commitEvidenceSegment(
      { withActor: database({ commit: [reserved()], keys: [KEY_ROW], attach: [{ outcome: "signed" }] }).withActor, signer: signer().provider },
      "t",
      INPUT,
    );
    const db = database({
      commit: [{ ...reserved(), outcome: "duplicate_signed", signature: await storedSignature() }],
      keys: [KEY_ROW],
    });
    const s = signer();
    const again = await commitEvidenceSegment({ withActor: db.withActor, signer: s.provider }, "t", INPUT);
    expect(again.status).toBe("duplicate");
    expect(JSON.stringify(again.status === "duplicate" && again.signedReceipt)).toBe(
      JSON.stringify(first.status === "committed" && first.signedReceipt),
    );
    expect(s.calls).toHaveLength(0);
    expect(db.ran).toEqual(["commit", "keys"]);
  });

  it.each([
    ["a changed signature", { signatureBase64Url: "A".repeat(85) + "A" }, [KEY_ROW]],
    ["a key that is not in the registry", {}, []],
    ["a revoked key", {}, [{ ...KEY_ROW, revoked_at: "2026-10-19T05:30:00.000Z" }]],
    ["a checkpoint key of the domain", {}, [{ ...KEY_ROW, purpose: "checkpoint" }]],
  ])("never trusts a stored receipt with %s, and never signs it again", async (_, change, keys) => {
    const db = database({
      commit: [{ ...reserved(), outcome: "duplicate_signed", signature: { ...(await storedSignature()), ...change } }],
      keys,
    });
    const s = signer();
    expect(await commitEvidenceSegment({ withActor: db.withActor, signer: s.provider }, "t", INPUT)).toEqual({
      status: "unavailable",
      stage: "repository",
      code: "stored_receipt_unverified",
    });
    expect(s.calls).toHaveLength(0);
    expect(db.ran).not.toContain("attach");
  });

  it("never signs a pending acceptance (T6, T8)", async () => {
    const db = database({ commit: [{ ...reserved(), outcome: "duplicate_pending" }] });
    const s = signer();
    expect(await commitEvidenceSegment({ withActor: db.withActor, signer: s.provider }, "t", INPUT)).toEqual({
      status: "unavailable",
      stage: "repository",
      code: "duplicate_pending",
    });
    expect(s.calls).toHaveLength(0);
    expect(db.ran).toEqual(["commit"]);
  });

  const state = { current_revision: "3", document_hash: "e".repeat(64), head_segment_hash: null, last_sequence_to: "9" };
  it.each([
    ["unauthorized", {}, { status: "not_found" }],
    ["context_mismatch", {}, { status: "invalid" }],
    ["invalid", {}, { status: "invalid" }],
    ["idempotency_conflict", {}, { status: "txid_reused" }],
    ["not_accepting", {}, { status: "not_accepting" }],
    ["too_large", {}, { status: "too_large" }],
    ...(["stale_base", "chain_conflict", "not_continuous"] as const).map((outcome) => [
      outcome,
      state,
      { status: outcome, state: { currentRevision: 3, documentHash: "e".repeat(64), headSegmentHash: null, lastSequenceTo: 9 } },
    ]),
    ["stale_base", { ...state, document_hash: null }, { status: "unavailable", stage: "repository", code: "state_malformed" }],
    ["chain_conflict", { ...state, current_revision: "-1" }, { status: "unavailable", stage: "repository", code: "state_malformed" }],
    ["not_continuous", { ...state, head_segment_hash: "B".repeat(64) }, { status: "unavailable", stage: "repository", code: "state_malformed" }],
    ["concurrent_conflict", {}, { status: "unavailable", stage: "repository", code: "outcome_unknown" }],
    ["committed", {}, { status: "unavailable", stage: "repository", code: "outcome_unknown" }],
  ] as [string, Record<string, unknown>, unknown][])("maps %s to its closed outcome without signing", async (outcome, extra, expected) => {
    const db = database({ commit: [{ outcome, ...extra }] });
    const s = signer();
    expect(await commitEvidenceSegment({ withActor: db.withActor, signer: s.provider }, "t", INPUT)).toEqual(expected);
    expect(s.calls).toHaveLength(0);
  });

  it.each([
    ["no row", [], "commit_rows"],
    ["two rows", [reserved(), reserved()], "commit_rows"],
  ])("is unavailable for %s", async (_, rows, code) => {
    const db = database({ commit: rows });
    expect(await commitEvidenceSegment({ withActor: db.withActor, signer: signer().provider }, "t", INPUT)).toEqual({
      status: "unavailable",
      stage: "repository",
      code,
    });
  });

  const otherText = (change: Partial<EvidenceReceiptPayloadV2>) => canonicalizeJcs({ ...PAYLOAD, ...change });
  it.each([
    ["a text that is not JCS", { receipt_payload: JSON.stringify(PAYLOAD) }, "receipt_malformed"],
    ["no v2 payload", { receipt_payload: canonicalizeJcs({ ...PAYLOAD, extra: 1 }) }, "receipt_malformed"],
    ["another document", { receipt_payload: otherText({ documentId: "doc-2" }) }, "receipt_mismatch"],
    ["another transaction", { receipt_payload: otherText({ clientTransactionId: "tx-2" }) }, "receipt_mismatch"],
    ["another segment hash", { receipt_payload: otherText({ segmentHash: "f".repeat(64) }) }, "receipt_mismatch"],
    ["another segment", { receipt_payload: otherText({ segmentId: "segment-2" }) }, "receipt_mismatch"],
    ["another package", { receipt_payload: otherText({ evidencePackageId: "pkg-2" }) }, "receipt_mismatch"],
    ["another domain", { receipt_payload: otherText({ evidenceDomainId: "00000000-0000-4000-8000-0000000000d2" }) }, "receipt_mismatch"],
    ["a revision other than base + 1", { receipt_payload: otherText({ revision: 2 }) }, "receipt_mismatch"],
    ["both revisions other than base + 1", { receipt_payload: otherText({ revision: 2 }), committed_revision: "2" }, "receipt_mismatch"],
    ["a committed revision other than the receipt's", { committed_revision: "2" }, "receipt_mismatch"],
    ["another receipt id", { receipt_id: "00000000-0000-4000-8000-0000000000c2" }, "receipt_mismatch"],
  ])("rolls back and signs nothing for a reserved receipt with %s", async (_, extra, code) => {
    const db = database({ commit: [reserved(extra)], keys: [KEY_ROW], attach: [{ outcome: "signed" }] });
    const s = signer();
    expect(await commitEvidenceSegment({ withActor: db.withActor, signer: s.provider }, "t", INPUT)).toEqual({
      status: "unavailable",
      stage: "repository",
      code,
    });
    expect(s.calls).toHaveLength(0);
    expect(db.ended).toEqual(["rollback"]);
  });

  it.each([
    ["a signer that throws", () => Promise.reject(new Error("seed path /secret")), [KEY_ROW], "signing_failed"],
    ["a malformed signature", async () => ({ algorithm: "Ed25519" }) as SignatureEnvelope, [KEY_ROW], "signing_failed"],
    ["a key that is not in the registry", async (m: Uint8Array) => sign(m), [], "signature_unverified"],
    ["a signature over other bytes", async () => sign(new Uint8Array(59)), [KEY_ROW], "signature_unverified"],
  ])("rolls back with stage signing for %s, before any attach (T1, T2, T5)", async (_, behaviour, keys, code) => {
    const db = database({ commit: [reserved()], keys, attach: [{ outcome: "signed" }] });
    const outcome = await commitEvidenceSegment({ withActor: db.withActor, signer: signer(behaviour).provider }, "t", INPUT);
    // Nothing of the receipt, the signature or the error text leaves (T2, P11).
    expect(outcome).toEqual({ status: "unavailable", stage: "signing", code });
    expect(db.ran).not.toContain("attach");
    expect(db.ended).toEqual(["rollback"]);
  });

  it.each(["already_signed", "other_transaction", "digest_mismatch", "key_revoked", "unexpected"])(
    "rolls back when the attach RPC answers %s",
    async (answer) => {
      const db = database({ commit: [reserved()], keys: [KEY_ROW], attach: [{ outcome: answer }] });
      expect(await commitEvidenceSegment({ withActor: db.withActor, signer: signer().provider }, "t", INPUT)).toEqual({
        status: "unavailable",
        stage: "repository",
        code: "attach_refused",
      });
      expect(db.ended).toEqual(["rollback"]);
    },
  );

  it("is unavailable when the registry rows are malformed", async () => {
    const db = database({ commit: [reserved()], keys: [{ ...KEY_ROW, purpose: "other" }], attach: [{ outcome: "signed" }] });
    expect(await commitEvidenceSegment({ withActor: db.withActor, signer: signer().provider }, "t", INPUT)).toEqual({
      status: "unavailable",
      stage: "repository",
      code: "domain_keys_unavailable",
    });
    expect(db.ended).toEqual(["rollback"]);
  });

  it("gives a closed code, never the database's message, when a query fails", async () => {
    const db = database({ commit: [] }, "commit");
    expect(await commitEvidenceSegment({ withActor: db.withActor, signer: signer().provider }, "t", INPUT)).toEqual({
      status: "unavailable",
      stage: "repository",
      code: "commit_failed",
    });
  });
});
