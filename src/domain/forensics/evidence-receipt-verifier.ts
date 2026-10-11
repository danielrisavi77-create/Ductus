import {
  ed25519KeyFromSpki,
  isCanonicalEd25519Signature,
  isSoundEd25519Point,
} from "./ed25519-encoding";
import {
  canonicalInstant,
  digestEvidenceReceiptPayloadV2,
  isEvidenceDomainId,
  isReceiptClientTransactionId,
  isReceiptId,
  isReceiptRevision,
  isSignedEvidenceReceiptV2,
  type EvidenceReceiptPayloadV2,
} from "./evidence-receipt";
import { isPublicVerificationKey, type PublicVerificationKey } from "./signature";
import { hasOnlyKeys, isPlainObject } from "../json";

/**
 * Verifier of a signed receipt v2 (D-92, DAN-54), for the client and for
 * anyone holding the public keys. Pure: no clock, no storage, no network.
 * It never throws; whatever it cannot vouch for is a refusal.
 */

/** What a key of an evidence domain may sign. A receipt key signs nothing else. */
export type EvidenceKeyPurpose = "receipt" | "checkpoint";

/**
 * One public key from the trusted key list. A key belongs to exactly one
 * evidence domain and has one purpose; `keyId` is unique across all domains.
 */
export type EvidenceDomainKey = PublicVerificationKey & {
  evidenceDomainId: string;
  purpose: EvidenceKeyPurpose;
  /**
   * Start of validity. It bounds the moment of signing, which only the server
   * knows; the verifier never compares it with `acceptedAt`.
   */
  validFrom: string;
  /** End of validity, exclusive; null while the key is the active one. */
  validTo: string | null;
  /** When the key was revoked; null if it never was. A revoked key verifies nothing. */
  revokedAt: string | null;
};

/** The commit and the evidence domain a receipt has to be the receipt of. */
export type EvidenceReceiptExpectationV2 = {
  documentId: string;
  clientTransactionId: string;
  revision: number;
  evidenceDomainId: string;
};

export type EvidenceReceiptRefusal =
  | "expectation_invalid"
  | "receipt_malformed"
  | "domain_mismatch"
  | "commit_mismatch"
  | "digest_mismatch"
  | "key_unknown"
  | "key_scope"
  | "key_revoked"
  | "key_not_valid"
  | "signature_invalid";

export type EvidenceReceiptVerification =
  | { ok: true; payload: EvidenceReceiptPayloadV2 }
  | { ok: false; reason: EvidenceReceiptRefusal };

const EXPECTATION_KEYS: ReadonlySet<string> = new Set<
  keyof EvidenceReceiptExpectationV2
>(["documentId", "clientTransactionId", "revision", "evidenceDomainId"]);
const ED25519_SIGNATURE_BYTES = 64;
/** The span one `acceptedAt` of a receipt v2 stands for. */
const ACCEPTED_AT_MINUTE_MS = 60_000;

function refuse(reason: EvidenceReceiptRefusal): EvidenceReceiptVerification {
  return { ok: false, reason };
}

function isExpectation(value: unknown): value is EvidenceReceiptExpectationV2 {
  return (
    isPlainObject(value) &&
    hasOnlyKeys(value, EXPECTATION_KEYS) &&
    isReceiptId(value.documentId) &&
    isReceiptClientTransactionId(value.clientTransactionId) &&
    isReceiptRevision(value.revision) &&
    isEvidenceDomainId(value.evidenceDomainId)
  );
}

function isEvidenceDomainKey(value: unknown): value is EvidenceDomainKey {
  if (!isPlainObject(value)) {
    return false;
  }
  // Whatever else the entry holds stays in `publicKey`, whose validator
  // refuses every field it does not know.
  const { evidenceDomainId, purpose, validFrom, validTo, revokedAt, ...publicKey } =
    value;
  return (
    isPublicVerificationKey(publicKey) &&
    isEvidenceDomainId(evidenceDomainId) &&
    (purpose === "receipt" || purpose === "checkpoint") &&
    canonicalInstant(validFrom) &&
    (validTo === null || canonicalInstant(validTo)) &&
    (revokedAt === null || canonicalInstant(revokedAt))
  );
}

/** Strict base64url without padding; null unless it is exactly `length` bytes. */
function decodeBase64Url(
  text: string,
  length: number,
): Uint8Array<ArrayBuffer> | null {
  // Unpadded base64url of n bytes is ceil(4n/3) characters. Asked first, so
  // a value of any other size is refused before it is decoded or copied.
  if (text.length !== Math.ceil((length * 4) / 3)) {
    return null;
  }
  try {
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const again = btoa(binary).replaceAll("+", "-").replaceAll("/", "_");
    // One spelling per byte string: no padding, no stray bits, no other alphabet.
    return bytes.byteLength === length && again.replace(/=+$/, "") === text
      ? bytes
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether `signedReceipt` is a receipt v2 for exactly the expected commit in
 * the expected evidence domain, signed by a receipt key of that domain.
 *
 * - The signature is checked over the 59 bytes of D-92 and over nothing else:
 *   never over the JCS text and never over the bare digest.
 * - The key is found by the `keyId` of the signature and must belong to the
 *   domain named in the signed payload, with the purpose `receipt`. A key of
 *   another domain or a checkpoint key of the same domain is refused.
 * - `expected` and `trustedKeys` are the caller's own knowledge. They have to
 *   come from a source other than the response that carries the receipt; this
 *   function cannot tell where they came from.
 * - The key and the signature are judged by their bytes before the runtime
 *   is asked (`ed25519-encoding.ts`): the key and `R` have to be points of
 *   the prime-order subgroup in their one spelling, and `S` below the group
 *   order. A point of small or mixed order, a second spelling of a number or
 *   a larger `S` is refused, in every runtime alike.
 * - What counts for a key is the moment of signing, and that moment is not in
 *   the signed payload. The server holds a key to it when it attaches the
 *   signature; here only `acceptedAt` is known (plan answer 6105652638 on
 *   issue 202).
 * - `acceptedAt` is a whole minute, so the segment was accepted anywhere from
 *   its start up to its end. A retired key, one past `validTo` and never
 *   revoked, still vouches for a receipt whose whole minute is before
 *   `validTo`: `acceptedAt + 1 min <= validTo`. For a `validTo` on a whole
 *   minute that is `acceptedAt < validTo`; for one inside a minute the
 *   receipts of that minute are refused, since nothing in them says on which
 *   side of `validTo` they were accepted.
 * - The author is not bound here either: `payload.principalId` is the author
 *   the server took from the session, and a caller that knows whose receipt
 *   it expects compares it.
 * - A revoked key vouches for nothing, whatever `acceptedAt` says: that field
 *   is signed by the key itself, so its holder writes any earlier time. Owner
 *   decision of 11 October 2026, option A (issue 87, comment 6105677746): all
 *   receipts of a revoked key are invalid and the server issues them again
 *   under the active key of the domain, with the same payload. Accepting a
 *   receipt from before the revocation needs a time anchor the key does not
 *   control and comes with the domain log (wave 2).
 * - `validFrom` is never compared with `acceptedAt`: a receipt reserved
 *   before a rotation is signed afterwards by the new key of the same domain.
 * - Not told apart here: a retired key used after its retirement for a
 *   payload with an earlier `acceptedAt`. The server rule closes that; from
 *   outside only anchoring in the log does.
 * - A receipt of another revision, also an earlier one of the same
 *   transaction, is refused: a duplicate never passes for a newer commit.
 * - The segment is not bound here. A commit may have more than one receipt,
 *   so `ok: true` does not say that the caller's own segment was accepted:
 *   the caller compares `payload.segmentHash` (and `segmentId` where it has
 *   one) with the segment it sent.
 */
export async function verifySignedEvidenceReceiptV2(
  signedReceipt: unknown,
  expected: EvidenceReceiptExpectationV2,
  trustedKeys: readonly EvidenceDomainKey[],
): Promise<EvidenceReceiptVerification> {
  try {
    if (!isExpectation(expected) || !Array.isArray(trustedKeys)) {
      return refuse("expectation_invalid");
    }
    if (!isSignedEvidenceReceiptV2(signedReceipt)) {
      return refuse("receipt_malformed");
    }
    // Everything below reads an inert copy: a value that answers differently
    // on a second read (a getter, a proxy) is either copied once or refused.
    const receipt: unknown = structuredClone(signedReceipt);
    if (!isSignedEvidenceReceiptV2(receipt)) {
      return refuse("receipt_malformed");
    }
    const { payload, signature } = receipt;

    if (payload.evidenceDomainId !== expected.evidenceDomainId) {
      return refuse("domain_mismatch");
    }
    if (
      payload.documentId !== expected.documentId ||
      payload.clientTransactionId !== expected.clientTransactionId ||
      payload.revision !== expected.revision
    ) {
      return refuse("commit_mismatch");
    }

    const digest = await digestEvidenceReceiptPayloadV2(payload);
    if (receipt.payloadDigestSha256 !== digest.sha256) {
      return refuse("digest_mismatch");
    }
    const signatureBytes = decodeBase64Url(
      signature.signatureBase64Url,
      ED25519_SIGNATURE_BYTES,
    );
    // An R outside the prime-order subgroup or in a second spelling, or S at
    // or above the group order, is refused here: runtimes do not agree on
    // such a signature.
    if (signatureBytes === null || !isCanonicalEd25519Signature(signatureBytes)) {
      return refuse("receipt_malformed");
    }

    // A key id that the list holds twice names no key (it is unique by rule).
    const named = trustedKeys.filter(
      (key: unknown) => isPlainObject(key) && key.keyId === signature.keyId,
    );
    // Checked before it is copied too, so a key of any size costs no copy.
    const key: unknown =
      named.length === 1 && isEvidenceDomainKey(named[0])
        ? structuredClone(named[0])
        : null;
    if (!isEvidenceDomainKey(key) || key.keyVersion !== signature.keyVersion) {
      return refuse("key_unknown");
    }
    if (
      key.algorithm !== "Ed25519" ||
      key.purpose !== "receipt" ||
      key.evidenceDomainId !== payload.evidenceDomainId
    ) {
      return refuse("key_scope");
    }
    // `acceptedAt` is signed by the key under judgement, so it says nothing
    // about a revoked key: whoever holds that key writes any earlier time.
    if (key.revokedAt !== null) {
      return refuse("key_revoked");
    }
    // `acceptedAt` names a whole minute, and the segment was accepted
    // somewhere in it: the key has to have been valid to the end of it.
    if (
      key.validTo !== null &&
      Date.parse(payload.acceptedAt) + ACCEPTED_AT_MINUTE_MS >
        Date.parse(key.validTo)
    ) {
      return refuse("key_not_valid");
    }

    // An Ed25519 public key in SPKI DER is 44 bytes (RFC 8410). A point of
    // small order as the key verifies a signature made with no private key
    // in some runtimes, and one of mixed order verifies in some runtimes and
    // not in others, so the key is judged here and not by the runtime.
    const keyBytes = decodeBase64Url(key.keyBase64Url, 44);
    const point = keyBytes === null ? null : ed25519KeyFromSpki(keyBytes);
    const publicKey =
      keyBytes === null || point === null || !isSoundEd25519Point(point)
        ? null
        : await globalThis.crypto.subtle
            .importKey("spki", keyBytes, { name: "Ed25519" }, false, ["verify"])
            .catch(() => null);
    if (publicKey === null) {
      return refuse("key_unknown");
    }
    const valid = await globalThis.crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      signatureBytes,
      digest.signingInput,
    );
    return valid === true ? { ok: true, payload } : refuse("signature_invalid");
  } catch {
    return refuse("receipt_malformed");
  }
}
