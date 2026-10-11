import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";

import type { EvidenceChainHeadV2 } from "../evidence-chain-v2";
import type {
  EvidenceReceiptPayloadV2,
  SignedEvidenceReceipt,
} from "../evidence-receipt";
import type { EvidenceSegmentV2 } from "../evidence-segment-v2";
import type { JcsJsonValue } from "../jcs";
import type { SignatureEnvelope } from "../signature";

/**
 * Test support for the golden vectors of evidence v2 (DAN-127). Tests only:
 * it reads a file with `node:fs`, so product code must never import it.
 *
 * Every test that pins canonical bytes or a hash, on the client side and on
 * the server side, reads the one file `evidence-v2.json` through this loader.
 * The expected values in that file were derived outside this repository; a
 * test that fails against them found a change of the evidence contract. Fix
 * the code or raise the contract change; never regenerate the file from the
 * code under test.
 */

export type GoldenSegmentVector = {
  clientRequestId: string;
  segment: EvidenceSegmentV2;
  canonicalUtf8Hex: string;
  byteLength: number;
  segmentHash: string;
  /** The ingest descriptor the client has to derive from `segment`. */
  descriptor: Record<string, string | number | null>;
  receipt: SignedEvidenceReceipt & { canonicalUtf8Hex: string };
};

/** One edit of the canonical bytes of `chain.segments[base]`. */
export type GoldenPayloadEdit = {
  name: string;
  /** Why the edit is refused, for example non-canonical bytes or an unknown field. */
  class: string;
  base: number;
  find?: string;
  replace?: string;
  findHex?: string;
  replaceHex?: string;
  reason: "invalid";
  /** The edited text parses to the same value as the base segment. */
  recanonicalizesToBase: boolean;
  /**
   * JCS writes the parsed edit as the base with `find` replaced by this: the
   * edited bytes differ from their own canonical form exactly there, and
   * the verifier accepts that canonical twin. Only with text `find`.
   */
  canonicalReplace?: string;
  /** The edited bytes are canonical JCS; only the validator rejects them. */
  canonicalJcs: boolean;
};

/**
 * The public key the stored signatures verify under: the hex of its SPKI DER,
 * like every other byte string of the file. Public half only.
 */
export type GoldenVerificationKey = {
  algorithm: "Ed25519";
  keyId: string;
  keyVersion: string;
  encoding: "spki-der";
  spkiDerHex: string;
  /** SHA-256 of the 32 private bytes, which are stored nowhere in these files. */
  signingSeedSha256: string;
};

/** A receipt v2 with every value the D-92 signature is built from. */
export type GoldenReceiptV2Vector = {
  name: string;
  payload: EvidenceReceiptPayloadV2;
  canonical: string;
  canonicalUtf8Hex: string;
  byteLength: number;
  payloadDigestSha256: string;
  /** `UTF-8("ductus-evidence-receipt-v2") || 0x0a || D`, 59 bytes. */
  signingInputHex: string;
  signatureHex: string;
  signature: SignatureEnvelope;
};

export type GoldenVectors = {
  vectorSchema: "ductus-golden-vectors-v1";
  jcs: {
    accepted: { name: string; input: JcsJsonValue; canonical: string; utf8Hex: string; sha256: string }[];
    numbers: { ieee754: string; canonical?: string; rejects?: string }[];
    rejected: { name: string; input: JcsJsonValue; rejects: string }[];
  };
  documents: { name: string; value: JcsJsonValue; utf8Hex: string; sha256: string }[];
  chain: {
    evidencePackageId: string;
    principalId: string;
    documentStates: { afterSequence: number; value: JcsJsonValue; sha256: string }[];
    expectedDocumentReordered: JcsJsonValue;
    segments: GoldenSegmentVector[];
    head: EvidenceChainHeadV2;
    verificationKey: GoldenVerificationKey;
  };
  segmentPayloads: { rejected: GoldenPayloadEdit[] };
  /** Owner decision of 10 October 2026 (D-24, D-56): no time per event, none finer than a minute. */
  eventTime: {
    /** The chain segments of the first revision of the file, byte for byte. Valid then, refused now. */
    formerSegments: {
      name: string;
      formerSegmentHash: string;
      byteLength: number;
      canonicalUtf8Hex: string;
      reason: "invalid";
    }[];
  };
  /** DAN-183 (Z10): only steps of the closed format ductus-edit-steps-v1. */
  stepFormat: {
    /** The chain segments of this file before DAN-183, byte for byte, with the test insert format. */
    formerSegments: {
      name: string;
      formerSegmentHash: string;
      byteLength: number;
      canonicalUtf8Hex: string;
      reason: "invalid";
    }[];
  };
  sizeLimit: {
    maxSegmentBytes: number;
    segmentWithoutPadding: EvidenceSegmentV2;
    padding: { unit: string; count: number };
    atLimit: { byteLength: number; sha256: string };
    overLimit: { extraText: string; byteLength: number; reason: "too_large" };
  };
  /** Receipt v2 (D-92, DAN-54): `accepted[0]` is the contract vector of docs/BACKEND.md section 4.1. */
  receiptV2: {
    signingPrefix: string;
    evidenceDomainId: string;
    otherEvidenceDomainId: string;
    /** The author of both accepted receipts, and another one. Invented. */
    principalId: string;
    otherPrincipalId: string;
    accepted: GoldenReceiptV2Vector[];
    /** The contract vector before DAN-54, without the four fields. Refused now. */
    former: Omit<GoldenReceiptV2Vector, "name" | "payload" | "byteLength">;
    /** Changes of `accepted[0].payload` that no validator may accept. */
    rejectedPayloads: {
      name: string;
      class: string;
      set?: Record<string, JcsJsonValue>;
      remove?: string[];
    }[];
    /** Valid signatures of the same key over `messageHex`, which is not the signing input. */
    rejectedSignatures: { name: string; messageHex: string; signatureBase64Url: string }[];
    /** Changes of the trusted key entry under which `accepted[0]` is refused with `reason`. */
    rejectedKeys: {
      name: string;
      set?: Record<string, JcsJsonValue>;
      remove?: string[];
      reason: "key_scope" | "key_unknown" | "key_not_valid";
    }[];
    /** What the unchanged entry of the trusted key list holds next to the key itself. */
    keyEntry: {
      evidenceDomainId: string;
      purpose: "receipt";
      validFrom: string;
      validTo: null;
      revokedAt: null;
    };
    /** Changes of that entry under which `accepted[0]` still verifies. */
    acceptedKeys: { name: string; set: Record<string, JcsJsonValue> }[];
  };
  /** Encodings of points a verifier takes or refuses as a key and as the R of a signature. */
  ed25519Points: {
    accepted: { name: string; pointHex: string }[];
    rejected: {
      name: string;
      class: "small-order" | "mixed-order" | "not-on-curve" | "non-canonical";
      pointHex: string;
    }[];
    /**
     * Satisfies the RFC 8032 equation over `receiptV2.accepted[0].signingInputHex`
     * under the public point `pointHex`, which is of mixed order.
     */
    mixedOrderSignature: { pointHex: string; signatureHex: string; signatureBase64Url: string };
  };
  /** Ranges of sequence numbers with a count of events, for the descriptor, the segment and the receipts. */
  sequenceRanges: {
    accepted: GoldenSequenceRange[];
    rejected: GoldenSequenceRange[];
  };
};

export type GoldenSequenceRange = {
  name: string;
  sequenceFrom: number;
  sequenceTo: number;
  eventCount: number;
};

/**
 * Parses the file bytes with `JSON.parse`. Not a module import: a bundler may
 * rewrite keys such as `__proto__`, and the vectors have to reach the code
 * under test exactly as they are stored.
 */
export function loadGoldenVectors(): GoldenVectors {
  const bytes = readFileSync(new URL("./evidence-v2.json", import.meta.url));
  if (bytes.some((byte) => byte > 0x7e || byte === 0x0d)) {
    throw new Error("golden vectors: the file must be ASCII with LF line ends");
  }
  const parsed = JSON.parse(bytes.toString("latin1")) as GoldenVectors;
  if (parsed.vectorSchema !== "ductus-golden-vectors-v1") {
    throw new Error("golden vectors: unknown vectorSchema");
  }
  return parsed;
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) throw new Error("golden vectors: not lowercase hex");
  return new Uint8Array(Buffer.from(hex, "hex"));
}

/** Replaces the one occurrence of `find` in `base`; throws unless it is exactly one. */
export function applyPayloadEdit(base: Uint8Array, edit: GoldenPayloadEdit): Uint8Array<ArrayBuffer> {
  const source = Buffer.from(base);
  const find = edit.findHex === undefined ? Buffer.from(edit.find ?? "", "utf8") : Buffer.from(edit.findHex, "hex");
  const replace =
    edit.replaceHex === undefined ? Buffer.from(edit.replace ?? "", "utf8") : Buffer.from(edit.replaceHex, "hex");
  const at = source.indexOf(find);
  if (find.length === 0 || at < 0 || source.indexOf(find, at + 1) >= 0) {
    throw new Error(`golden vectors: ${edit.name} must match the base exactly once`);
  }
  return new Uint8Array(Buffer.concat([source.subarray(0, at), replace, source.subarray(at + find.length)]));
}

/**
 * Verifier for the stored signatures. It holds only the public key from the
 * file, so it shows that a stored signature is valid for given bytes without
 * any signing key in the repository.
 */
export function goldenKeyVerifier(key: GoldenVerificationKey): {
  verify(message: Uint8Array, signature: SignatureEnvelope): Promise<boolean>;
} {
  const publicKey = createPublicKey({
    key: Buffer.from(fromHex(key.spkiDerHex)),
    format: "der",
    type: "spki",
  });
  return {
    verify: async (message, signature) =>
      signature.algorithm === key.algorithm &&
      signature.keyId === key.keyId &&
      signature.keyVersion === key.keyVersion &&
      signature.signatureEncoding === "raw" &&
      verify(null, message, publicKey, Buffer.from(signature.signatureBase64Url, "base64url")),
  };
}
