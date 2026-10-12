import { hasOnlyKeys, isPlainObject } from "../json";

export type SignatureAlgorithm =
  | "Ed25519"
  | "ECDSA_P256_SHA256"
  | "RSA_PSS_SHA256";

export type SignatureEncoding = "raw" | "ieee-p1363" | "der";

export type SignatureEnvelope = {
  algorithm: SignatureAlgorithm;
  keyId: string;
  keyVersion: string;
  signatureEncoding: SignatureEncoding;
  signatureBase64Url: string;
};

export type PublicVerificationKey = {
  algorithm: SignatureAlgorithm;
  keyId: string;
  keyVersion: string;
  encoding: "spki-der";
  keyBase64Url: string;
};

const BASE64URL = /^[A-Za-z0-9_-]+$/;
// Above the text of any signature or SPKI key of the algorithms here (RSA of
// 16384 bits takes under 2800 characters). Asked before the pattern is run.
const MAX_BASE64URL_LENGTH = 4096;
// A field outside these sets is covered by no signature, so it is refused
// rather than carried along next to one.
const SIGNATURE_ENVELOPE_KEYS: ReadonlySet<string> = new Set<
  keyof SignatureEnvelope
>(["algorithm", "keyId", "keyVersion", "signatureEncoding", "signatureBase64Url"]);
const PUBLIC_VERIFICATION_KEY_KEYS: ReadonlySet<string> = new Set<
  keyof PublicVerificationKey
>(["algorithm", "keyId", "keyVersion", "encoding", "keyBase64Url"]);

function nonEmptyBounded(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.length <= max &&
    value.trim().length > 0
  );
}

function isBase64Url(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_BASE64URL_LENGTH &&
    BASE64URL.test(value)
  );
}

function isSignatureAlgorithm(value: unknown): value is SignatureAlgorithm {
  return (
    value === "Ed25519" ||
    value === "ECDSA_P256_SHA256" ||
    value === "RSA_PSS_SHA256"
  );
}

function encodingMatchesAlgorithm(
  algorithm: SignatureAlgorithm,
  encoding: unknown,
): encoding is SignatureEncoding {
  if (algorithm === "Ed25519") return encoding === "raw";
  if (algorithm === "ECDSA_P256_SHA256") {
    return encoding === "ieee-p1363" || encoding === "der";
  }
  // RSA signatures are fixed-length signature octets, not ASN.1 DER objects.
  return encoding === "raw";
}

export function isSignatureEnvelope(
  value: unknown,
): value is SignatureEnvelope {
  if (!isPlainObject(value) || !hasOnlyKeys(value, SIGNATURE_ENVELOPE_KEYS)) {
    return false;
  }
  const v = value;
  if (!isSignatureAlgorithm(v.algorithm)) return false;

  return (
    nonEmptyBounded(v.keyId, 2048) &&
    nonEmptyBounded(v.keyVersion, 256) &&
    encodingMatchesAlgorithm(v.algorithm, v.signatureEncoding) &&
    isBase64Url(v.signatureBase64Url)
  );
}

export function isPublicVerificationKey(
  value: unknown,
): value is PublicVerificationKey {
  if (
    !isPlainObject(value) ||
    !hasOnlyKeys(value, PUBLIC_VERIFICATION_KEY_KEYS)
  ) {
    return false;
  }
  const v = value;

  return (
    isSignatureAlgorithm(v.algorithm) &&
    nonEmptyBounded(v.keyId, 2048) &&
    nonEmptyBounded(v.keyVersion, 256) &&
    v.encoding === "spki-der" &&
    isBase64Url(v.keyBase64Url)
  );
}
