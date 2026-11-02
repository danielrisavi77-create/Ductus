import type {
  AttachReceiptSignatureOutcome,
  PendingReceiptRow,
  PendingReceiptStore,
} from "@/application/ports/pending-receipt-signing";
import type { SigningKeyProvider } from "@/application/ports/signing-key-provider";
import {
  digestEvidenceReceiptPayloadV2,
  EVIDENCE_RECEIPT_SCHEMA_V1,
  EVIDENCE_RECEIPT_V2_SIGNING_INPUT_BYTES,
  EvidenceHashUnavailableError,
  isEvidenceReceiptPayloadV2,
  type EvidenceReceiptPayloadV2,
  type SignedEvidenceReceiptV2,
} from "@/domain/forensics/evidence-receipt";
import {
  EVIDENCE_VERIFICATION_UNAVAILABLE,
  verifySignedEvidenceReceiptV2,
  type EvidenceDomainKey,
} from "@/domain/forensics/evidence-receipt-verifier";
import { canonicalizeJcs } from "@/domain/forensics/jcs";
import { isSignatureEnvelope, type SignatureEnvelope } from "@/domain/forensics/signature";
import { isPlainObject } from "@/domain/json";

/** Far above any v2 payload; asked before the text is parsed. */
export const MAX_PENDING_RECEIPT_TEXT_LENGTH = 16_384;
export const MAX_SIGN_TIMEOUT_MS = 60_000;

export type PendingReceiptRefusal =
  | "receipt_malformed"
  | "not_canonical"
  | "unsupported_schema"
  | "receipt_id_mismatch"
  | "invalid"
  | "not_found"
  | "digest_mismatch";

export type SignPendingReceiptOutcome =
  | { status: "signed"; signedReceipt: SignedEvidenceReceiptV2 }
  | { status: "already_signed"; signedReceipt: SignedEvidenceReceiptV2 }
  | { status: "refused"; reason: PendingReceiptRefusal }
  /** The signature did not pass the domain's key registry; nothing stored. */
  | { status: "signer_rejected"; reason: string }
  /** Nothing is known of the receipt; the worker may try it again later. */
  | {
      status: "unavailable";
      stage: "hash" | "keys" | "signing" | "verification" | "store";
      reason: string;
    };

export type SignPendingReceiptDeps = {
  signer: SigningKeyProvider;
  store: PendingReceiptStore;
  signTimeoutMs: number;
};

type Parsed =
  | { ok: true; payload: EvidenceReceiptPayloadV2 }
  | { ok: false; reason: PendingReceiptRefusal };

function parsePending(row: PendingReceiptRow): Parsed {
  const text: unknown = row.receiptPayloadText;
  if (typeof text !== "string" || text.length > MAX_PENDING_RECEIPT_TEXT_LENGTH) {
    return { ok: false, reason: "receipt_malformed" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "receipt_malformed" };
  }
  // D-215: no v1 receipt is signed here; the v2 signer never sees a v1 record.
  if (isPlainObject(parsed) && parsed.receiptSchema === EVIDENCE_RECEIPT_SCHEMA_V1) {
    return { ok: false, reason: "unsupported_schema" };
  }
  if (!isEvidenceReceiptPayloadV2(parsed)) {
    return { ok: false, reason: "receipt_malformed" };
  }
  // The database hashes the stored text, so only a text that is its own JCS
  // form has the digest that the signature is made over. A value JCS cannot
  // write (a lone surrogate) is malformed, not an exception.
  let canonical: string;
  try {
    canonical = canonicalizeJcs(parsed);
  } catch {
    return { ok: false, reason: "receipt_malformed" };
  }
  if (canonical !== text) {
    return { ok: false, reason: "not_canonical" };
  }
  if (parsed.receiptId !== row.receiptId) {
    return { ok: false, reason: "receipt_id_mismatch" };
  }
  return { ok: true, payload: parsed };
}

type Signed =
  | { ok: true; signature: SignatureEnvelope }
  | { ok: false; reason: "sign_failed" | "sign_timeout" | "signature_malformed" };

async function signWithin(
  signer: SigningKeyProvider,
  input: Uint8Array,
  timeoutMs: number,
): Promise<Signed> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Signed>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "sign_timeout" }), timeoutMs);
  });
  // The signer gets a copy; a reply after the timeout is dropped unread.
  const signing = Promise.resolve()
    .then(() => signer.sign(input.slice()))
    .then((raw): Signed => {
      const copy: unknown = structuredClone(raw);
      return isSignatureEnvelope(copy) && copy.algorithm === "Ed25519"
        ? { ok: true, signature: copy }
        : { ok: false, reason: "signature_malformed" };
    })
    .catch((): Signed => ({ ok: false, reason: "sign_failed" }));
  try {
    return await Promise.race([signing, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function sameSignature(stored: unknown, sent: SignatureEnvelope): boolean {
  try {
    return isSignatureEnvelope(stored) && canonicalizeJcs(stored) === canonicalizeJcs(sent);
  } catch {
    return false;
  }
}

/**
 * Signs one pending receipt v2 through the signing port (D-92) and stores
 * the signature through the worker's store. The signature is stored only
 * after it passes the verifier with a receipt key of the payload's own
 * domain from the registry, never with the signer's word for its key.
 * Of two concurrent calls the store keeps one signature, and the other call
 * answers with that stored signature, never with its own.
 */
export function createSignPendingReceipt(deps: SignPendingReceiptDeps) {
  const { signer, store, signTimeoutMs } = deps;
  if (
    !Number.isSafeInteger(signTimeoutMs) ||
    signTimeoutMs <= 0 ||
    signTimeoutMs > MAX_SIGN_TIMEOUT_MS
  ) {
    throw new RangeError("signPendingReceipt: invalid signTimeoutMs");
  }

  async function verified(
    receipt: SignedEvidenceReceiptV2,
    keys: readonly EvidenceDomainKey[],
  ) {
    const { payload } = receipt;
    return verifySignedEvidenceReceiptV2(
      receipt,
      {
        documentId: payload.documentId,
        clientTransactionId: payload.clientTransactionId,
        revision: payload.revision,
        evidenceDomainId: payload.evidenceDomainId,
      },
      keys,
    );
  }

  async function settle(
    attached: AttachReceiptSignatureOutcome,
    own: SignedEvidenceReceiptV2,
    keys: readonly EvidenceDomainKey[],
  ): Promise<SignPendingReceiptOutcome> {
    // The store is an outside port: a reply that is not an object with a
    // string outcome is answered as unknown, never read further.
    if (!isPlainObject(attached) || typeof attached.outcome !== "string") {
      return { status: "unavailable", stage: "store", reason: "unknown_outcome" };
    }
    switch (attached.outcome) {
      case "signed":
        // `signed` must carry the signature this call sent; anything else is
        // not known to be what was stored.
        return sameSignature(attached.signature, own.signature)
          ? { status: "signed", signedReceipt: own }
          : { status: "unavailable", stage: "store", reason: "stored_signature_mismatch" };
      case "already_signed": {
        // The stored signature is answered only once it verifies as well.
        const stored = {
          payload: own.payload,
          payloadDigestSha256: own.payloadDigestSha256,
          signature: attached.signature,
        } as SignedEvidenceReceiptV2;
        const check = await verified(stored, keys);
        if (check.ok) return { status: "already_signed", signedReceipt: stored };
        return check.reason === EVIDENCE_VERIFICATION_UNAVAILABLE
          ? { status: "unavailable", stage: "verification", reason: check.reason }
          : { status: "unavailable", stage: "store", reason: "stored_signature_unverified" };
      }
      case "invalid":
      case "not_found":
      case "unsupported_schema":
      case "digest_mismatch":
        return { status: "refused", reason: attached.outcome };
      case "key_unknown":
      case "key_scope":
      case "key_revoked":
      case "key_not_valid":
        return { status: "signer_rejected", reason: attached.outcome };
      case "unavailable":
        return { status: "unavailable", stage: "store", reason: "store_unavailable" };
      default:
        return { status: "unavailable", stage: "store", reason: "unknown_outcome" };
    }
  }

  return async function signPendingReceipt(
    row: PendingReceiptRow,
  ): Promise<SignPendingReceiptOutcome> {
    const parsed = parsePending(row);
    if (!parsed.ok) return { status: "refused", reason: parsed.reason };
    const { payload } = parsed;

    let digest: Awaited<ReturnType<typeof digestEvidenceReceiptPayloadV2>>;
    try {
      digest = await digestEvidenceReceiptPayloadV2(payload);
    } catch (error) {
      return error instanceof EvidenceHashUnavailableError
        ? { status: "unavailable", stage: "hash", reason: "hash_unavailable" }
        : { status: "refused", reason: "receipt_malformed" };
    }
    if (digest.signingInput.byteLength !== EVIDENCE_RECEIPT_V2_SIGNING_INPUT_BYTES) {
      return { status: "unavailable", stage: "hash", reason: "signing_input_length" };
    }

    let keys: readonly EvidenceDomainKey[];
    try {
      const read = await store.receiptKeys(payload.evidenceDomainId);
      if (read.status !== "ok" || !Array.isArray(read.keys)) {
        return { status: "unavailable", stage: "keys", reason: "keys_unavailable" };
      }
      keys = read.keys;
    } catch {
      return { status: "unavailable", stage: "keys", reason: "keys_unavailable" };
    }

    const signed = await signWithin(signer, digest.signingInput, signTimeoutMs);
    if (!signed.ok) return { status: "unavailable", stage: "signing", reason: signed.reason };

    const own: SignedEvidenceReceiptV2 = {
      payload,
      payloadDigestSha256: digest.sha256,
      signature: signed.signature,
    };
    const check = await verified(own, keys);
    if (!check.ok) {
      return check.reason === EVIDENCE_VERIFICATION_UNAVAILABLE
        ? { status: "unavailable", stage: "verification", reason: check.reason }
        : { status: "signer_rejected", reason: check.reason };
    }

    let attached: AttachReceiptSignatureOutcome;
    try {
      attached = await store.attachSignature({
        receiptId: payload.receiptId,
        payloadDigestSha256: digest.sha256,
        signature: signed.signature,
      });
    } catch {
      return { status: "unavailable", stage: "store", reason: "store_unavailable" };
    }
    return settle(attached, own, keys);
  };
}
