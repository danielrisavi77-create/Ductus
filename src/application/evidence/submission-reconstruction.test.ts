import { createHash, generateKeyPairSync, sign as nodeSign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createEditStepsV1Replayer,
  removedRangeSha256,
} from "@/adapters/evidence/edit-steps-v1-replayer";
import type { EvidencePayloadReader } from "@/application/ports/evidence-reconstruction";
import { REVISION_ZERO_JCS, REVISION_ZERO_NODE_ID } from "@/domain/document/revision-zero";
import {
  digestEvidenceReceiptPayloadV2,
  type EvidenceReceiptPayloadV2,
} from "@/domain/forensics/evidence-receipt";
import type { EvidenceDomainKey } from "@/domain/forensics/evidence-receipt-verifier";
import { canonicalizeJcs, type JcsJsonValue } from "@/domain/forensics/jcs";

import { decideSubmission } from "./submission-decision";
import {
  reconstructSubmission,
  type StoredEvidenceReceiptV2,
  type SubmissionRecord,
} from "./submission-reconstruction";

// B-12 step 4b1: invented ids, synthetic text ("Odlomak A", "Odlomak B") and a
// key made for this test only. The steps are real ductus-edit-steps-v1 steps,
// replayed from the known-answer revision 0 by the server replayer.
const DOMAIN = "00000000-0000-4000-8000-0000000000d1";
const OTHER_DOMAIN = "00000000-0000-4000-8000-0000000000d2";
const AUTHOR = "00000000-0000-4000-8000-0000000000e1";
const replayer = createEditStepsV1Replayer();
const pair = generateKeyPairSync("ed25519");
const other = generateKeyPairSync("ed25519");
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

function key(overrides: Partial<EvidenceDomainKey> = {}, keyPair = pair): EvidenceDomainKey {
  return {
    algorithm: "Ed25519",
    keyId: "test-key-1",
    keyVersion: "1",
    encoding: "spki-der",
    keyBase64Url: keyPair.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
    evidenceDomainId: DOMAIN,
    purpose: "receipt",
    validFrom: "2026-10-19T05:00:00.000Z",
    validTo: null,
    revokedAt: null,
    ...overrides,
  };
}

const hashOf = (document: unknown) => sha256(canonicalizeJcs(replayer.toCanonical(document as never)));

/** One event per segment: its steps applied to the document after the segment before. */
type Edit = (document: ReturnType<typeof replayer.load>) => unknown[];

const EDITS: Edit[] = [
  () => [{ stepType: "replace", from: 1, to: 1, slice: { content: [{ type: "text", text: "Odlomak A" }] } }],
  // Replaces "A" with "B": the removed range carries its hash (C12, positive).
  (document) => [
    {
      stepType: "replace",
      from: 9,
      to: 10,
      removedSha256: removedRangeSha256(document as never, 9, 10),
      slice: { content: [{ type: "text", text: "B" }] },
    },
  ],
];

type Built = { bytes: Map<string, Uint8Array>; record: SubmissionRecord; payloads: EvidencePayloadReader };

async function build(options: { gapAt?: number; edits?: Edit[]; record?: (steps: unknown[]) => unknown[] } = {}): Promise<Built> {
  const bytes = new Map<string, Uint8Array>();
  const segments: SubmissionRecord["segments"] = [];
  let document = replayer.load(JSON.parse(REVISION_ZERO_JCS) as JcsJsonValue);
  let before = hashOf(document);
  let predecessor: string | null = null;
  let previousReceiptId: string | null = null;
  let sequence = 0;
  for (const [i, edit] of (options.edits ?? EDITS).entries()) {
    sequence += options.gapAt === i ? 2 : 1;
    const steps = edit(document);
    const event = { sequence, source: "editor", steps, touchedNodeIds: [REVISION_ZERO_NODE_ID] };
    document = replayer.apply(document, event as never);
    const after = hashOf(document);
    const segment = canonicalizeJcs({
      evidenceSchema: "ductus-evidence-segment-v2",
      canonicalization: "RFC8785-JCS",
      hashAlgorithm: "sha256",
      documentId: "doc-1",
      sessionId: "session-1",
      segmentId: `segment-${i + 1}`,
      sequenceFrom: sequence,
      sequenceTo: sequence,
      observedStartedAt: "2026-10-19T06:00:00.000Z",
      observedEndedAt: "2026-10-19T06:00:00.000Z",
      initialDocumentHash: before,
      finalDocumentHash: after,
      predecessorSegmentHash: predecessor,
      events: [{ ...event, steps: options.record?.(steps) ?? steps, beforeDocumentHash: before, afterDocumentHash: after }],
      captureContext: { editorModel: "prosemirror", transactionFormat: "ductus-edit-steps-v1" },
      evidenceProfileId: "standard-v1",
    });
    const segmentHash = sha256(segment);
    bytes.set(segmentHash, new TextEncoder().encode(segment));
    const payload: EvidenceReceiptPayloadV2 = {
      receiptSchema: "ductus-evidence-receipt-v2",
      receiptId: `00000000-0000-4000-8000-00000000000${i + 1}`,
      evidenceDomainId: DOMAIN,
      evidencePackageId: "pkg-1",
      documentId: "doc-1",
      revision: i + 1,
      clientTransactionId: `tx-${i + 1}`,
      principalId: AUTHOR,
      sessionId: "session-1",
      segmentId: `segment-${i + 1}`,
      segmentHash,
      predecessorSegmentHash: predecessor,
      previousReceiptId,
      evidenceSchema: "ductus-evidence-segment-v2",
      evidenceProfileId: "standard-v1",
      sequenceFrom: sequence,
      sequenceTo: sequence,
      eventCount: 1,
      payloadBytes: bytes.get(segmentHash)!.length,
      acceptedAt: "2026-10-19T06:00:00.000Z",
    };
    segments.push({ segmentHash, receipt: await stored(payload) });
    before = after;
    predecessor = segmentHash;
    previousReceiptId = payload.receiptId;
  }
  const record: SubmissionRecord = {
    institutionId: "00000000-0000-4000-8000-0000000000a1",
    evidencePackageId: "pkg-1",
    evidenceDomainId: DOMAIN,
    documentId: "doc-1",
    principalId: AUTHOR,
    revision: segments.length,
    contentHash: before,
    head: { segmentHash: predecessor!, segmentCount: segments.length },
    segments,
  };
  const payloads: EvidencePayloadReader = {
    readImmutable: async ({ segmentHash }) => {
      const found = bytes.get(segmentHash);
      return found ? { status: "found", bytes: found } : { status: "not_found" };
    },
  };
  return { bytes, record, payloads };
}

async function stored(payload: EvidenceReceiptPayloadV2, keyPair = pair): Promise<StoredEvidenceReceiptV2> {
  const digest = await digestEvidenceReceiptPayloadV2(payload);
  return {
    receiptPayload: canonicalizeJcs(payload),
    signature: {
      algorithm: "Ed25519",
      keyId: "test-key-1",
      keyVersion: "1",
      signatureEncoding: "raw",
      signatureBase64Url: nodeSign(null, Buffer.from(digest.signingInput), keyPair.privateKey).toString("base64url"),
    },
  };
}

const run = (built: Built, keys: EvidenceDomainKey[] = [key()]) =>
  reconstructSubmission({ payloads: built.payloads, replayer, keys }, built.record);

/** The last segment's receipt, rewritten and signed again under the test key. */
async function resign(built: Built, change: Partial<EvidenceReceiptPayloadV2>, index = built.record.segments.length - 1) {
  const receipt = built.record.segments[index].receipt!;
  const payload = { ...(JSON.parse(receipt.receiptPayload) as EvidenceReceiptPayloadV2), ...change };
  built.record.segments[index] = { ...built.record.segments[index], receipt: await stored(payload) };
}

describe("reconstruction of a submission over receipts v2 (B-12 step 4b1)", () => {
  it("matches the requested revision from revision 0, a removed range with its hash included (C1, C12)", async () => {
    const built = await build();
    const outcome = await run(built);
    expect(outcome).toEqual({
      status: "match",
      head: built.record.head,
      documentSha256: built.record.contentHash,
    });
    expect(decideSubmission(outcome)).toMatchObject({ decision: "submit", artifactSha256: built.record.contentHash });
  });

  it("matches a record cut at an earlier revision against that revision's hash (B4)", async () => {
    const whole = await build();
    const cut = await build({ edits: EDITS.slice(0, 1) });
    expect(cut.record.segments[0]).toEqual(whole.record.segments[0]);
    expect(await run(cut)).toMatchObject({ status: "match", documentSha256: cut.record.contentHash });
  });

  it("never matches a target other than the requested revision's hash (C14, B2)", async () => {
    const built = await build();
    built.record.contentHash = sha256("Odlomak X");
    const outcome = await run(built);
    expect(outcome).toEqual({ status: "mismatch", reason: "target_mismatch", index: null });
    expect(decideSubmission(outcome)).toEqual({ decision: "blocked", reason: "record_mismatch" });
  });

  it("never matches a target hash of another form, even of the same value", async () => {
    const built = await build();
    built.record.contentHash = built.record.contentHash.toUpperCase();
    expect(await run(built)).toEqual({ status: "mismatch", reason: "invalid_target", index: null });
  });

  it("blocks a removed range recorded with a wrong hash (C12, negative)", async () => {
    // The document hashes are those of the real edit; only the recorded hash is wrong.
    const built = await build({
      record: (steps) => steps.map((step) => ("removedSha256" in (step as object) ? { ...(step as object), removedSha256: "0".repeat(64) } : step)),
    });
    const outcome = await run(built);
    expect(outcome).toEqual({ status: "mismatch", reason: "step_failed", index: 1 });
    expect(decideSubmission(outcome)).toEqual({ decision: "blocked", reason: "record_mismatch" });
  });
  it("blocks a break the server did not record (C5)", async () => {
    const built = await build({ gapAt: 1 });
    const outcome = await run(built);
    expect(outcome).toMatchObject({ status: "discontinuity" });
    expect(decideSubmission(outcome)).toEqual({ decision: "blocked", reason: "record_discontinuous" });
  });

  it("blocks a segment whose acceptance has no signature and says so (P3, C9)", async () => {
    const built = await build();
    built.record.segments[1] = { ...built.record.segments[1], receipt: null };
    const outcome = await run(built);
    expect(outcome).toEqual({ status: "mismatch", reason: "receipt_missing", index: 1 });
    expect(decideSubmission(outcome)).toEqual({ decision: "blocked", reason: "segment_unsigned" });
  });

  it("blocks a signature changed by one character (C9)", async () => {
    const built = await build();
    const receipt = built.record.segments[0].receipt!;
    const signature = receipt.signature as { signatureBase64Url: string };
    // A character in the low bytes of S: still a well-formed signature, of other bytes.
    const at = 50;
    const s = signature.signatureBase64Url;
    const flipped = s.slice(0, at) + (s[at] === "A" ? "B" : "A") + s.slice(at + 1);
    built.record.segments[0] = {
      ...built.record.segments[0],
      receipt: { ...receipt, signature: { ...signature, signatureBase64Url: flipped } },
    };
    expect(await run(built)).toEqual({ status: "mismatch", reason: "receipt_signature_invalid", index: 0 });
  });

  it("blocks changed stored bytes (C8)", async () => {
    const built = await build();
    const [first] = built.record.segments;
    const text = new TextDecoder().decode(built.bytes.get(first.segmentHash)).replace("Odlomak A", "Odlomak C");
    built.bytes.set(first.segmentHash, new TextEncoder().encode(text));
    const outcome = await run(built);
    expect(outcome.status).toBe("mismatch");
    expect(decideSubmission(outcome)).toEqual({ decision: "blocked", reason: "record_mismatch" });
  });

  it.each<[string, (built: Built) => Promise<void> | void]>([
    ["another author", (built) => resign(built, { principalId: "00000000-0000-4000-8000-0000000000e2" })],
    ["another package", (built) => resign(built, { evidencePackageId: "pkg-2" })],
    ["another document", (built) => resign(built, { documentId: "doc-2" })],
    ["another domain", (built) => resign(built, { evidenceDomainId: OTHER_DOMAIN })],
    ["a broken receipt chain", (built) => resign(built, { previousReceiptId: null })],
    ["a revision above the request's", (built) => resign(built, { revision: 3 })],
    ["a last revision below the request's", (built) => resign(built, { revision: 1 })],
    ["revisions going back", (built) => resign(built, { revision: 3 }, 0)],
    [
      "receipt text that is not its own JCS form",
      (built) => {
        const receipt = built.record.segments[0].receipt!;
        built.record.segments[0] = {
          ...built.record.segments[0],
          receipt: { ...receipt, receiptPayload: ` ${receipt.receiptPayload}` },
        };
      },
    ],
    [
      "a receipt of another form",
      (built) => {
        built.record.segments[0] = { ...built.record.segments[0], receipt: { payload: {} } as never };
      },
    ],
  ])("blocks a receipt with %s (C10, C11, F1)", async (_name, change) => {
    const built = await build();
    await change(built);
    const outcome = await run(built);
    expect(outcome).toMatchObject({ status: "mismatch", reason: "receipt_mismatch" });
    expect(decideSubmission(outcome)).toEqual({ decision: "blocked", reason: "record_mismatch" });
  });

  it.each<[string, EvidenceDomainKey[]]>([
    ["no key in the registry", []],
    ["a revoked key", [key({ revokedAt: "2026-10-19T07:00:00.123Z" })]],
    ["a retired key past the acceptance", [key({ validTo: "2026-10-19T06:00:00.000Z" })]],
    ["a key of another domain", [key({ evidenceDomainId: OTHER_DOMAIN })]],
    ["a key of another purpose", [key({ purpose: "checkpoint" })]],
  ])("asks for a retry, never a verdict, with %s", async (_name, keys) => {
    const outcome = await run(await build(), keys);
    expect(outcome).toMatchObject({ status: "unavailable", stage: "verification" });
    expect(decideSubmission(outcome)).toEqual({ decision: "retry", stage: "verification" });
  });

  it("blocks a receipt signed by a key other than the registered one", async () => {
    const built = await build();
    const receipt = built.record.segments[1].receipt!;
    built.record.segments[1] = {
      ...built.record.segments[1],
      receipt: await stored(JSON.parse(receipt.receiptPayload) as EvidenceReceiptPayloadV2, other),
    };
    expect(await run(built)).toEqual({ status: "mismatch", reason: "receipt_signature_invalid", index: 1 });
  });

  it("asks for a retry when the storage does not answer (C18)", async () => {
    const built = await build();
    built.payloads = { readImmutable: async () => ({ status: "unavailable", reason: "timeout" }) };
    expect(decideSubmission(await run(built))).toEqual({ decision: "retry", stage: "storage" });
  });
});
