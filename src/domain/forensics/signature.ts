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

function nonEmptyBounded(value: unknown, max: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= max
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (!isSignatureAlgorithm(v.algorithm)) return false;

  return (
    nonEmptyBounded(v.keyId, 2048) &&
    nonEmptyBounded(v.keyVersion, 256) &&
    encodingMatchesAlgorithm(v.algorithm, v.signatureEncoding) &&
    typeof v.signatureBase64Url === "string" &&
    BASE64URL.test(v.signatureBase64Url)
  );
}

export function isPublicVerificationKey(
  value: unknown,
): value is PublicVerificationKey {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const v = value as Record<string, unknown>;

  return (
    isSignatureAlgorithm(v.algorithm) &&
    nonEmptyBounded(v.keyId, 2048) &&
    nonEmptyBounded(v.keyVersion, 256) &&
    v.encoding === "spki-der" &&
    typeof v.keyBase64Url === "string" &&
    BASE64URL.test(v.keyBase64Url)
  );
}
